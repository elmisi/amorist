'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WindowsAttachEngine}=require('./qa/lib/engine-windows-attach');
async function main(){
 assert.equal(process.platform,'win32');const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-cli-windows-')),file=path.join(scratch,'--note λ.md'),source='# Start\r\n'+Array(40).fill('Paragraph\r\n').join('')+'# Target λ\r\n';fs.writeFileSync(file,source);
 const engine=new WindowsAttachEngine(process.env.AMORIST_QA_EDGE_DRIVER,process.env.AMORIST_QA_APPLICATION,['--debug','--heading-anchor','target-λ','--',file]);
 try{await engine.start();let actual;const start=Date.now();
  do{actual=await engine.evaluate(`(()=>{const selection=window.getSelection();return {path:document.getElementById('file-path')?.textContent||'',heading:selection?.focusNode?.parentElement?.closest('.amorist-wysiwyg-h1')?.textContent.trimEnd(),debug:!!document.getElementById('report-button')&&!document.getElementById('report-button').hidden};})()`);if(actual.path.endsWith('--note λ.md')&&actual.heading==='Target λ'&&actual.debug)break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()-start<8000);
  assert.ok(actual.path.endsWith('--note λ.md'),JSON.stringify(actual));assert.equal(actual.heading,'Target λ');assert.equal(actual.debug,true);
  const loaded=await engine.evaluate(`window.__TAURI__.core.invoke('read_document')`);assert.equal(loaded.markdown,source);assert.equal(fs.readFileSync(file,'utf8'),source);
  console.log(JSON.stringify({status:'pass',directCli:true,unicodePath:true,leadingDashBasename:true,headingAnchor:true,debugFlag:true,rawSourceUnchanged:true}));
 }catch(error){console.error('CLI probe failed: '+(error.stack||error));throw error;}finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
