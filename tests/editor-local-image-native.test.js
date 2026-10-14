'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
async function main(){
 assert.equal(process.platform,'linux','This directed native probe requires Linux');
 const root=path.resolve(__dirname,'..'),manifest=path.join(root,'src-tauri/Cargo.toml');
 const application=process.env.AMORIST_QA_APPLICATION||path.join(root,'src-tauri/target/debug/amorist');
 if(!process.env.AMORIST_QA_APPLICATION){
  const build=cp.spawnSync('cargo',['build','--manifest-path',manifest],{encoding:'utf8'});
  assert.equal(build.status,0,build.stderr);
 }
 assert.ok(fs.existsSync(application),'The specified native application must exist');
 const driver=discoverDriver();assert.ok(driver,'tauri-driver is required');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-local-image-'));
 fs.mkdirSync(path.join(scratch,'docs'));fs.mkdirSync(path.join(scratch,'images'));fs.mkdirSync(path.join(scratch,'data'));
 fs.copyFileSync(path.join(root,'tests/qa/assets/image.svg'),path.join(scratch,'images','photo λ.svg'));
 const file=path.join(scratch,'docs','note.md');
 const source='before\r\n![Alt](<../images/photo%20%CE%BB.svg> "Title")\r\nafter';fs.writeFileSync(file,source);
 const engine=new TauriEngine(driver,application,[file],{...process.env,XDG_DATA_HOME:path.join(scratch,'data')});
 try {
  await engine.start();
  let actual;
  const started=Date.now();
  do {
   actual=await engine.evaluate(`(() => {const atom=document.querySelector('.amorist-image-atom'),image=atom?.querySelector('img');return {state:atom?.dataset.imageState,src:image?.src,width:image?.naturalWidth,alt:image?.alt,title:image?.title,error:document.getElementById('notice').textContent};})()`);
   if(actual.state==='loaded'||actual.state==='failed') break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()-started<8000);
  assert.equal(actual.state,'loaded',JSON.stringify(actual));assert.equal(actual.width,200);assert.equal(actual.alt,'Alt');assert.equal(actual.title,'Title');
  assert.match(actual.src,/^amorist-image:\/\/localhost\/[a-f0-9]{32}$/);
  assert.equal(fs.readFileSync(file,'utf8'),source);
  const destination=path.join(scratch,'other','docs','note.md');
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.mkdirSync(path.join(scratch,'other','images'));
  fs.writeFileSync(path.join(scratch,'other','images','photo λ.svg'),fs.readFileSync(path.join(root,'tests/qa/assets/image.svg'),'utf8').replace('width="200"','width="320"'));
  await engine.evaluate(`(() => {
    window.__imageRoot=document.querySelector('.amorist-editor');window.__imageAtom=document.querySelector('.amorist-image-atom');
    window.__TAURI__.dialog.save=()=>Promise.resolve(${JSON.stringify(destination)});
    document.querySelector('[data-file-action="save-as"]').click();return true;
  })()`);
  let rebased;const rebaseStarted=Date.now();
  do {
    rebased=await engine.evaluate(`(() => {
      const atom=document.querySelector('.amorist-image-atom'),image=atom?.querySelector('img');
      return {state:atom?.dataset.imageState,width:image?.naturalWidth,src:image?.src,path:document.getElementById('file-path').textContent,
        rootSame:document.querySelector('.amorist-editor')===window.__imageRoot,atomSame:atom===window.__imageAtom};
    })()`);
    if(rebased.state==='loaded' && rebased.width===320 && rebased.path===destination) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()-rebaseStarted<8000);
  assert.equal(rebased.state,'loaded',JSON.stringify(rebased));assert.equal(rebased.width,320);assert.equal(rebased.path,destination);
  assert.equal(rebased.rootSame,true);assert.equal(rebased.atomSame,true);assert.notEqual(rebased.src,actual.src);
  assert.equal(fs.readFileSync(destination,'utf8'),source);assert.equal(fs.readFileSync(file,'utf8'),source);
  const saveAsExpired=await engine.evaluate(`new Promise(resolve=> {
    const image=new Image();let done=false;const finish=value=>{if(!done){done=true;resolve(value);}};
    image.onload=()=>finish({loaded:true});image.onerror=()=>finish({loaded:false});
    image.src=${JSON.stringify(actual.src)}+'?save-as-expired=1';setTimeout(()=>finish({timeout:true}),3000);
  })`);
  assert.deepEqual(saveAsExpired,{loaded:false});
  const formatFiles=['png','jpg','gif','webp','bmp','avif','utf16-le.svg','utf16-be.svg'].map(extension=> {
    const filename=extension.startsWith('utf16')?'image-format-'+extension:'image-format.'+extension;
    const target=path.join(scratch,'images',filename);
    fs.copyFileSync(path.join(root,'tests/qa/assets',filename),target);
    return {extension,path:target,...(extension==='avif'?{dataUri:'data:image/avif;base64,'+fs.readFileSync(target).toString('base64')}:{})};
  });
  const formats=await engine.evaluate(`(async () => {
    const invoke=window.__TAURI__.core.invoke,doc=await invoke('read_document'),results=[];
    for(const file of ${JSON.stringify(formatFiles)}) {
      const id=await invoke('register_image',{reference:file.path,contextId:doc.contextId});
      const uri=window.__TAURI__.core.convertFileSrc(id,'amorist-image');
      const decoded=await new Promise(resolve=> {
        const image=new Image();let done=false;const finish=value=>{if(!done){done=true;resolve(value);}};
        image.onload=()=>finish({loaded:true,width:image.naturalWidth,height:image.naturalHeight});
        image.onerror=()=>finish({loaded:false});image.src=uri;
        setTimeout(()=>finish({timeout:true}),3000);
      });
      if(file.dataUri) {
        const dataDecoded=await new Promise(resolve=> {
          const image=new Image();image.onload=()=>resolve({loaded:true,width:image.naturalWidth,height:image.naturalHeight});
          image.onerror=()=>resolve({loaded:false});image.src=file.dataUri;
          setTimeout(()=>resolve({timeout:true}),3000);
        });
        console.log('AVIF data URI decoding: '+JSON.stringify(dataDecoded));
        window.__avifDataDecoded=dataDecoded;
      }
      results.push({extension:file.extension,...decoded});
    }
    return results;
  })()`);
  console.log(JSON.stringify({formats,avifDataDecoded:await engine.evaluate("window.__avifDataDecoded")}));
  const missingAvifLoader=process.argv.includes('--expect-no-avif-loader');
  assert.deepEqual(formats,formatFiles.map(file=>file.extension==='avif'&&missingAvifLoader
    ? {extension:file.extension,loaded:false,width:0,height:0}
    : {extension:file.extension,loaded:true,width:32,height:24}));
  const lifecycle=await engine.evaluate(`(async () => {
    const invoke=window.__TAURI__.core.invoke,doc=await invoke('read_document');
    const id=await invoke('register_image',{reference:'../images/photo%20%CE%BB.svg',contextId:doc.contextId});
    const uri=window.__TAURI__.core.convertFileSrc(id,'amorist-image');
    const request=uri=>new Promise(resolve=> {
      const image=new Image();let done=false;
      const finish=value=>{if(!done){done=true;resolve(value);}};
      image.onload=()=>finish({loaded:true,width:image.naturalWidth});image.onerror=()=>finish({loaded:false});
      image.src=uri;setTimeout(()=>finish({timeout:true}),3000);
    });
    const active=await request(uri+'?active=1');
    const next=await invoke('create_document',{contextId:doc.contextId,discard:true});
    const expired=await request(uri+'?expired=1');
    let staleRejected=false;
    try {await invoke('register_image',{reference:'../images/photo%20%CE%BB.svg',contextId:doc.contextId});} catch(error) {staleRejected=true;}
    return {active,expired,staleRejected,nextUntitled:next.path===''};
  })()`);
  assert.deepEqual(lifecycle,{active:{loaded:true,width:320},expired:{loaded:false},staleRejected:true,nextUntitled:true});
  assert.equal(fs.readFileSync(file,'utf8'),source);
  console.log(JSON.stringify({status:'pass',image:actual,rebased,saveAsExpired,formats,lifecycle,sourceUnchanged:true}));
 }finally {await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
