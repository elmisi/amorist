'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const cp=require('node:child_process');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
async function main(){
 assert.equal(process.platform,'linux');const root=path.resolve(__dirname,'..');const build=cp.spawnSync('cargo',['build','--manifest-path',path.join(root,'src-tauri/Cargo.toml')],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-link-native-'));const file=path.join(scratch,'note.md');const source='# Start\r\n\r\n[Go](#target-λ)\r\n'+Array(50).fill('Paragraph\r\n').join('')+'\r\n# Target λ\r\n';fs.writeFileSync(file,source);
 const engine=new TauriEngine(discoverDriver(),path.join(root,'src-tauri/target/debug/amorist'),['--heading-anchor','target-λ','--',file],{...process.env,XDG_DATA_HOME:path.join(scratch,'data')});
 try {await engine.start();let actual;const started=Date.now();
  do {actual=await engine.evaluate(`(()=>{const selection=window.getSelection(),node=selection?.focusNode,heading=node?.parentElement?.closest('.amorist-wysiwyg-h1');return {heading:heading?.textContent.trimEnd(),notice:document.getElementById('notice').textContent};})()`);if(actual.heading==='Target λ')break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()-started<8000);
  assert.equal(actual.heading,'Target λ',JSON.stringify(actual));assert.equal(fs.readFileSync(file,'utf8'),source);
  const result=await engine.evaluate(`(async()=>{const invoke=window.__TAURI__.core.invoke;return {anchorConsumed:await invoke('take_startup_anchor')};})()`);assert.equal(result.anchorConsumed,null);
  console.log(JSON.stringify({status:'pass',startupAnchor:actual,oneUse:true,sourceUnchanged:true}));
 }finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
