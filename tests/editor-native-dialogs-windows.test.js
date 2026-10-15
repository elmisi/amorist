'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {WindowsAttachEngine}=require('./qa/lib/engine-windows-attach');
async function waitFor(probe,label){const end=Date.now()+10000;while(!await probe()){assert.ok(Date.now()<end,label);await new Promise(r=>setTimeout(r,50));}}
async function main(){
  assert.equal(process.platform,'win32');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'amorist-native-dialogs-'));
  const original=path.join(root,'original λ.md'),destination=path.join(root,'saved Ω.md'),source='# Native dialog\r\nOriginal λ';fs.writeFileSync(original,source);
  const engine=new WindowsAttachEngine(process.env.AMORIST_QA_EDGE_DRIVER,process.env.AMORIST_QA_APPLICATION,['--new-document']);
  const dialogs=[];
  async function action(name){await engine.evaluate(`(()=>{const menu=document.getElementById('file-menu');if(!menu.open)menu.querySelector('summary').click();document.querySelector('[data-file-action="${name}"]').click();return true;})()`);}
  function nativeDialog(operation,file){
    assert.ok(engine.applicationProcess?.pid&&engine.applicationProcess.exitCode===null,'Owned application must be live');
    const result=cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'qa/lib/windows-file-dialog.ps1')],{encoding:'utf8',timeout:15000,env:{...process.env,
      AMORIST_QA_APPLICATION:engine.application,AMORIST_QA_DIALOG_PID:String(engine.applicationProcess.pid),AMORIST_QA_DIALOG_ROOT:root,
      AMORIST_QA_DIALOG_ACTION:operation,AMORIST_QA_DIALOG_PATH:file||''}});
    if(result.status!==0){const diagnostic=cp.spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'qa/lib/windows-file-dialog.ps1')],{encoding:'utf8',timeout:10000,env:{...process.env,AMORIST_QA_APPLICATION:engine.application,AMORIST_QA_DIALOG_PID:String(engine.applicationProcess.pid),AMORIST_QA_DIALOG_ACTION:'inspect'}});console.error('Owned dialog structure',diagnostic.stdout,diagnostic.stderr);}
    assert.equal(result.status,0,result.stderr);dialogs.push(JSON.parse(result.stdout.trim()));console.log('Native dialog action',result.stdout.trim());
  }
  try {
    await engine.start();await waitFor(()=>engine.evaluate("!!document.querySelector('.amorist-editor-source')&&!document.getElementById('editor').inert"),'Untitled editor');
    assert.equal(await engine.evaluate('document.getElementById("file-path").textContent'),'');
    await action('open');nativeDialog('cancel');await waitFor(()=>engine.evaluate('!document.getElementById("editor").inert&&!document.querySelector("[data-file-action=open]").disabled'),'Open cancelled');
    assert.equal(await engine.evaluate('document.getElementById("file-path").textContent'),'');
    await action('open');nativeDialog('accept',original);
    await waitFor(()=>engine.evaluate('document.getElementById("file-path").textContent.endsWith("original λ.md")&&!document.getElementById("editor").inert&&!document.querySelector("[data-file-action=open]").disabled'),'Native Open accepted');
    await engine.evaluate(`(()=>{const source=document.querySelector('.amorist-editor-source');if(source.hidden)document.querySelector('[data-action="source"]').click();source.focus();source.setSelectionRange(source.value.length,source.value.length);return true;})()`);
    await engine.sendKeys([' edited']);
    await action('save-as');nativeDialog('cancel');await waitFor(()=>engine.evaluate('!document.getElementById("editor").inert&&!document.querySelector("[data-file-action=open]").disabled'),'Save As cancelled');
    assert.equal(fs.readFileSync(original,'utf8'),source);assert.equal(fs.existsSync(destination),false);
    assert.equal(await engine.evaluate('document.querySelector(".amorist-editor-source").value'),source.replace(/\r\n/g,'\n')+' edited');
    await action('save-as');nativeDialog('accept',destination);
    await waitFor(()=>fs.existsSync(destination)&&fs.readFileSync(destination,'utf8')===source+' edited','Native Save As accepted');
    assert.equal(fs.readFileSync(original,'utf8'),source);
    assert.ok(await engine.evaluate('document.getElementById("file-path").textContent.endsWith("saved Ω.md")'));
    console.log(JSON.stringify({status:'pass',dialogs,originalUnchanged:true,cancellationPreservesDraft:true,savedSourceExact:true}));
  }catch(error){
    console.error('Private fixture diagnostic',JSON.stringify({files:fs.readdirSync(root),saved:fs.existsSync(destination)?fs.readFileSync(destination,'utf8'):null,ui:await engine.evaluate('({path:document.getElementById("file-path").textContent,status:document.getElementById("status").textContent,source:document.querySelector(".amorist-editor-source").value})').catch(()=>null)}));
    throw error;
  }finally{await engine.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
