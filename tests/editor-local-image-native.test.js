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
  console.log(JSON.stringify({status:'pass',image:actual,sourceUnchanged:true}));
 }finally {await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
