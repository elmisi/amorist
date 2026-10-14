'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {TauriEngine,discoverDriver}=require('./qa/lib/engine-tauri');
async function main(){
 assert.equal(process.platform,'linux');const root=path.resolve(__dirname,'..');const build=cp.spawnSync('cargo',['build','--manifest-path',path.join(root,'src-tauri/Cargo.toml')],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-bug-native-')),file=path.join(scratch,'note.md');
 const source=Array.from({length:100},(_,index)=>'Line '+String(index).padStart(3,'0')).join('\r\n');fs.writeFileSync(file,source);
 const engine=new TauriEngine(discoverDriver(),path.join(root,'src-tauri/target/debug/amorist'),['--debug','--',file],{...process.env,XDG_DATA_HOME:path.join(scratch,'data')});
 try{
  await engine.start();const started=Date.now();
  while(!await engine.evaluate(`!document.getElementById('report-button').hidden && !document.getElementById('editor').inert && !!document.querySelector('.amorist-source-line')`)){assert.ok(Date.now()-started<8000);await new Promise(resolve=>setTimeout(resolve,50));}
  await engine.evaluate(`(()=>{const surface=document.querySelector('.amorist-editor-surface'),row=surface.querySelector('[data-line="45"]');row.scrollIntoView({block:'center'});surface.focus();const node=row.querySelector('span')?.firstChild||row.firstChild;const selection=window.getSelection();selection.setBaseAndExtent(node,0,node,0);return true;})()`);
  await engine.sendKeys(['X']);await new Promise(resolve=>setTimeout(resolve,100));
  const before=await engine.evaluate(`(()=>{
   const surface=document.querySelector('.amorist-editor-surface'),row=surface.querySelector('[data-line="45"]');surface.focus();row.scrollIntoView({block:'center'});
   const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(node.textContent.includes('Line 045'))break;}
   const selection=window.getSelection();selection.setBaseAndExtent(node,5,node,1);
   const text=selection.toString();return {text};
  })()`);
  await new Promise(resolve=>setTimeout(resolve,100));
  await engine.evaluate(`(()=>{document.getElementById('report-button').focus();return true;})()`);
  await engine.sendKeys([{key:'Enter'}]);await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(await engine.evaluate(`document.getElementById('report-dialog').open`),true);
  assert.match(await engine.evaluate(`document.getElementById('report-log-path').textContent`),/problem-reports\.jsonl$/);
  await engine.sendKeys(['Example bug',{key:'s',ctrl:true}]);await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(fs.readFileSync(file,'utf8'),source,'Save shortcut behind Bug modal must not save unsaved edits');
  const reportFile=path.join(scratch,'data','dev.elmisi.amorist','problem-reports.jsonl');
  fs.mkdirSync(reportFile,{recursive:true});
  await engine.evaluate(`(()=>{document.getElementById('report-submit').click();return true;})()`);
  let failed;const failing=Date.now();
  do {failed=await engine.evaluate(`(()=>({open:document.getElementById('report-dialog').open,note:document.getElementById('report-note').value,error:document.getElementById('report-error').textContent,button:document.getElementById('report-submit').textContent,disabled:document.getElementById('report-submit').disabled}))()`);if(failed.error&&!failed.disabled)break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()-failing<7000);
  assert.equal(failed.open,true);assert.equal(failed.note,'Example bug');assert.equal(failed.button,'Retry');assert.ok(failed.error);assert.equal(fs.readFileSync(file,'utf8'),source);
  fs.rmdirSync(reportFile);
  await engine.evaluate(`(()=>{document.getElementById('report-submit').click();return true;})()`);
  const saving=Date.now();
  while(!fs.existsSync(reportFile)){assert.ok(Date.now()-saving<5000);await new Promise(resolve=>setTimeout(resolve,50));}
  const report=JSON.parse(fs.readFileSync(reportFile,'utf8').trim());assert.equal(report.schemaVersion,2);assert.equal(report.note,'Example bug');assert.equal(report.filePath,file);
  assert.equal(report.savedMarkdown,source);assert.equal(report.markdown,source.replace('Line 045','XLine 045'));assert.equal(report.selectedMarkdown,before.text);assert.equal(report.selection.direction,'backward');
  assert.equal(report.appVersion,'0.10.10');assert.equal(report.buildId,report.buildInfo.buildId);assert.ok(report.viewport.scrollTop>0);assert.ok(report.visibleBlocks.length<100);
  assert.ok(report.visibleBlocks.every(block=>Number.isInteger(block.rawStart)&&Number.isInteger(block.rawEnd)));assert.equal(fs.readFileSync(file,'utf8'),source);
  console.log(JSON.stringify({status:'pass',retryPreservedNote:true,keyboardSnapshot:true,backwardSelection:true,visibleBlocks:report.visibleBlocks.length,scrollTop:report.viewport.scrollTop,buildId:report.buildId,sourceUnchanged:true}));
 }finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
