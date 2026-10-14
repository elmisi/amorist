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
 const build=cp.spawnSync('cargo',['build','--manifest-path',manifest],{encoding:'utf8'});
 assert.equal(build.status,0,build.stderr);
 const driver=discoverDriver();assert.ok(driver,'tauri-driver is required');
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-local-image-'));
 fs.mkdirSync(path.join(scratch,'docs'));fs.mkdirSync(path.join(scratch,'images'));fs.mkdirSync(path.join(scratch,'data'));
 fs.copyFileSync(path.join(root,'tests/qa/assets/image.svg'),path.join(scratch,'images','photo λ.svg'));
 const file=path.join(scratch,'docs','note.md');
 const source='before\r\n![Alt](<../images/photo%20%CE%BB.svg> "Title")\r\nafter';fs.writeFileSync(file,source);
 const engine=new TauriEngine(driver,path.join(root,'src-tauri/target/debug/amorist'),[file],{...process.env,XDG_DATA_HOME:path.join(scratch,'data')});
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
  assert.deepEqual(lifecycle,{active:{loaded:true,width:200},expired:{loaded:false},staleRejected:true,nextUntitled:true});
  assert.equal(fs.readFileSync(file,'utf8'),source);
  console.log(JSON.stringify({status:'pass',image:actual,lifecycle,sourceUnchanged:true}));
 }finally {await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
