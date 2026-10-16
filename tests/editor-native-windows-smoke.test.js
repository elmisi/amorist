'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {WindowsAttachEngine}=require('./qa/lib/engine-windows-attach');
async function waitFor(probe,label){const end=Date.now()+8000;while(!await probe()){assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,50));}}
async function main(){
 assert.equal(process.platform,'win32');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-native-win-smoke-')),file=path.join(root,'native λ.md'),other=path.join(root,'other Ω.md');
 const identityFile=path.join(root,'build-info.json');const identityResult=cp.spawnSync(process.env.AMORIST_QA_APPLICATION,['--build-info',identityFile]);assert.equal(identityResult.status,0);const identity=JSON.parse(fs.readFileSync(identityFile,'utf8'));
 const source='# Native Windows\r\nOriginal λ';fs.writeFileSync(file,source);fs.writeFileSync(other,'# Independent Ω');
 const create=document=>new WindowsAttachEngine(process.env.AMORIST_QA_EDGE_DRIVER,process.env.AMORIST_QA_APPLICATION,['--debug','--',document]);
 let engine=create(file),second=null,settingsPath=null,originalSettings=null,expectedSettings=null,success=false;
 async function ui(expression){return engine.evaluate(expression);}
 async function ready(){await waitFor(()=>ui("!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert&&!document.getElementById('report-button').hidden"),'Native app ready');}
 async function settings(){await ui("document.getElementById('settings-button').click()");await waitFor(()=>ui("document.getElementById('settings-dialog').open"),'Settings open');}
 async function size(value){await ui("document.getElementById('settings-form').elements.baseFontSize.focus()");await engine.sendKeys([{key:'a',ctrl:true},String(value)]);await waitFor(()=>ui(`document.getElementById('settings-form').elements.baseFontSize.value==='${value}'`),'Text size typed');}
 try{
  await engine.start();await ready();
  const reportPath=await ui("window.__TAURI__.core.invoke('get_report_path')");
  assert.ok(path.resolve(reportPath).toLowerCase().startsWith(path.resolve(process.env.LOCALAPPDATA,'dev.elmisi.amorist').toLowerCase()+path.sep),'Expected own application local-data path');
  settingsPath=path.join(path.dirname(reportPath),'settings.json');originalSettings=fs.existsSync(settingsPath)?fs.readFileSync(settingsPath):null;
  fs.writeFileSync(path.join(root,'settings-before.json'),JSON.stringify({path:settingsPath,bytesHex:originalSettings?.toString('hex')??null}));
  await ui("document.querySelector('[data-action=source]').click()");
  const fontBefore=await ui("getComputedStyle(document.querySelector('.amorist-editor-source')).fontSize"),savedSize=fontBefore==='19px'?21:19;
  await settings();await size(savedSize);await engine.sendKeys([{key:'Escape'}]);await waitFor(()=>ui("!document.getElementById('settings-dialog').open"),'Settings cancelled');
  assert.equal(await ui("getComputedStyle(document.querySelector('.amorist-editor-source')).fontSize"),fontBefore);
  assert.deepEqual(fs.existsSync(settingsPath)?fs.readFileSync(settingsPath):null,originalSettings);
  await settings();await size(savedSize);await engine.sendKeys([{key:'Enter'}]);await waitFor(()=>ui("!document.getElementById('settings-dialog').open"),'Settings saved');
  assert.equal(await ui("getComputedStyle(document.querySelector('.amorist-editor-source')).fontSize"),savedSize+'px');
  expectedSettings=fs.readFileSync(settingsPath);assert.equal(JSON.parse(expectedSettings).baseFontSize,savedSize);assert.equal(fs.readFileSync(file,'utf8'),source);
  second=create(other);await second.start();await waitFor(()=>second.evaluate(`!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert&&getComputedStyle(document.querySelector('.amorist-editor-source')).fontSize==='${savedSize}px'`),'Settings persisted to independent process');await second.close();second=null;
  await ui("(()=>{const s=document.querySelector('.amorist-editor-source');s.focus();s.setSelectionRange(s.value.length,s.value.length);return true;})()");
  await engine.sendKeys([' unsaved QA']);await waitFor(()=>ui("document.querySelector('.amorist-editor-source').value.endsWith(' unsaved QA')"),'Private draft typed');
  const edited=source+' unsaved QA',note='QA native Windows smoke';
  await ui("document.getElementById('report-button').click()");await waitFor(()=>ui("document.getElementById('report-dialog').open"),'Bug open');
  await engine.sendKeys([note,{key:'s',ctrl:true}]);await waitFor(()=>ui(`document.getElementById('report-note').value===${JSON.stringify(note)}`),'Complete Bug note');assert.equal(fs.readFileSync(file,'utf8'),source,'Save shortcut behind modal must preserve original');
  const reportsBefore=fs.existsSync(reportPath)?fs.readFileSync(reportPath):Buffer.alloc(0);
  await ui("document.getElementById('report-submit').click()");await waitFor(()=>Promise.resolve(fs.existsSync(reportPath)&&fs.statSync(reportPath).size>reportsBefore.length),'Report appended');
  const after=fs.readFileSync(reportPath);assert.ok(after.subarray(0,reportsBefore.length).equals(reportsBefore));const report=JSON.parse(after.subarray(reportsBefore.length).toString().trim());assert.equal(report.note,note);assert.equal(report.savedMarkdown,source);assert.equal(report.markdown,edited);assert.equal(report.mode,'source');assert.equal(report.settings.baseFontSize,savedSize);assert.equal(report.buildInfo.commit,identity.commit);assert.equal(report.buildInfo.buildId,identity.buildId);assert.equal(fs.readFileSync(file,'utf8'),source);
  await waitFor(()=>ui("!document.getElementById('report-dialog').open"),'Bug closed');
  await ui("document.querySelector('[data-file-action=new]').click()");await waitFor(()=>ui("!!document.querySelector('#file-decision-dialog[open]')"),'New asks about unsaved draft');await ui("document.getElementById('file-decision-cancel').click()");
  assert.equal(await ui("document.querySelector('.amorist-editor-source').value"),edited.replace(/\r\n/g,'\n'));
  await ui("document.querySelector('[data-file-action=new]').click()");await waitFor(()=>ui("!!document.querySelector('#file-decision-dialog[open]')"),'New asks again');await ui("document.getElementById('file-decision-discard').click()");await waitFor(()=>ui("document.getElementById('file-path').textContent===''&&document.querySelector('.amorist-editor-source').value===''&&!document.getElementById('editor').inert"),'Discard creates blank document');assert.equal(fs.readFileSync(file,'utf8'),source);
  console.log(JSON.stringify({status:'pass',settingsCancel:true,settingsSave:true,independentLaunchPersistence:true,bugCompleteNote:true,bugModalBlocksSave:true,previousReportsPreserved:true,newCancelPreservesDraft:true,newDiscardKeepsOriginal:true,buildId:report.buildId}));success=true;
 }finally{
  if(second)await second.close();await engine.close();
  if(settingsPath&&expectedSettings){assert.ok(fs.existsSync(settingsPath)&&fs.readFileSync(settingsPath).equals(expectedSettings),'Settings changed outside QA; original backup retained in '+root);if(originalSettings===null)fs.unlinkSync(settingsPath);else fs.writeFileSync(settingsPath,originalSettings);}
  if(success)fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});else console.error('Private diagnostic fixtures retained:',root);
 }
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
