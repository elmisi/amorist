'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WindowsAttachEngine}=require('./qa/lib/engine-windows-attach');
async function waitFor(probe,message){const start=Date.now();while(!await probe()){assert.ok(Date.now()-start<8000,message);await new Promise(resolve=>setTimeout(resolve,50));}}
async function main(){
 assert.equal(process.platform,'win32');const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-recovery-windows-')),file=path.join(scratch,'recovery λ.md'),base='# Recovery\r\nOriginal λ',edited=base+' unsaved';fs.writeFileSync(file,base);
 const other=path.join(scratch,'other Ω.md'),otherBase='# Other\r\nIndependent Ω',otherEdited=otherBase+' separate';fs.writeFileSync(other,otherBase);
 const recovery=path.join(process.env.APPDATA,'dev.elmisi.amorist','amorist','recovery-sessions');
 const normalized=value=>value.replace(/^\\\\\?\\/,'').toLowerCase();
 const records=(document=file)=>fs.existsSync(recovery)?fs.readdirSync(recovery).flatMap(id=>{try{const record=JSON.parse(fs.readFileSync(path.join(recovery,id,'record.json'),'utf8'));return record.path&&normalized(record.path)===normalized(document)?[record]:[];}catch(error){return [];}}):[];
 const create=(document=file)=>new WindowsAttachEngine(process.env.AMORIST_QA_EDGE_DRIVER,process.env.AMORIST_QA_APPLICATION,['--',document]);let engine=create();
 try{
  await engine.start();await waitFor(()=>engine.evaluate(`!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert&&document.getElementById('file-path').textContent.endsWith('recovery λ.md')`),'original document ready');
  await engine.evaluate(`(()=>{document.querySelector('[data-action="source"]').click();const source=document.querySelector('.amorist-editor-source');source.focus();source.setSelectionRange(source.value.length,source.value.length);return true;})()`);
  const changed=Date.now();await engine.sendKeys([' unsaved']);await waitFor(()=>Promise.resolve(records().some(record=>record.savedSource===base&&record.unsavedSource===edited)),'unsaved recovery checkpoint');const recoveryMs=Date.now()-changed;assert.ok(recoveryMs<=2750,`Recovery exceeded 2000ms + 750ms tolerance: ${recoveryMs}`);assert.equal(fs.readFileSync(file,'utf8'),base);
  await engine.crashApplication();engine=create(other);await engine.start();
  await waitFor(()=>engine.evaluate(`!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert&&document.getElementById('file-path').textContent.endsWith('other Ω.md')`),'second document ready');
  await engine.evaluate(`(()=>{document.querySelector('[data-action="source"]').click();const source=document.querySelector('.amorist-editor-source');source.focus();source.setSelectionRange(source.value.length,source.value.length);return true;})()`);
  await engine.sendKeys([' separate']);await waitFor(()=>Promise.resolve(records(other).some(record=>record.savedSource===otherBase&&record.unsavedSource===otherEdited)),'second document recovery checkpoint');
  assert.equal(fs.readFileSync(file,'utf8'),base);assert.equal(fs.readFileSync(other,'utf8'),otherBase);
  await engine.crashApplication();engine=create();await engine.start();
  await waitFor(()=>engine.evaluate(`document.getElementById('notice')?.textContent.includes('Recovered unsaved work')&&!document.getElementById('editor').inert`),'recovery after process interruption');
  await engine.evaluate(`(()=>{document.querySelector('[data-action="source"]').click();return true;})()`);
  assert.equal(await engine.evaluate(`document.querySelector('.amorist-editor-source').value`),edited.replace(/\r\n/g,'\n'));assert.equal(fs.readFileSync(file,'utf8'),base);
  await engine.evaluate(`(()=>{document.getElementById('save-button').click();return true;})()`);await waitFor(()=>Promise.resolve(fs.readFileSync(file,'utf8')===edited),'recovered source explicitly saved');
  assert.equal(fs.readFileSync(other,'utf8'),otherBase);await engine.close();engine=create(other);await engine.start();
  await waitFor(()=>engine.evaluate(`document.getElementById('notice')?.textContent.includes('Recovered unsaved work')&&!document.getElementById('editor').inert`),'second document independently recovered');
  await engine.evaluate(`(()=>{document.querySelector('[data-action="source"]').click();return true;})()`);
  assert.equal(await engine.evaluate(`document.querySelector('.amorist-editor-source').value`),otherEdited.replace(/\r\n/g,'\n'));assert.equal(fs.readFileSync(file,'utf8'),edited);
  await engine.evaluate(`(()=>{document.getElementById('save-button').click();return true;})()`);await waitFor(()=>Promise.resolve(fs.readFileSync(other,'utf8')===otherEdited),'second recovered source explicitly saved');
  console.log(JSON.stringify({status:'pass',recoveryMs,originalUntouchedBeforeSave:true,ownedProcessInterrupted:true,recoveredExactSource:true,twoDocumentIsolation:true,explicitSavePreservesCRLF:true}));
 }catch(error){console.error(error.stack||error);throw error;}finally{await engine.close();fs.rmSync(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
