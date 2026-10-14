'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {resolveEngines}=require('./qa/lib/engines');
const {startStaticServer}=require('./qa/lib/server');
async function main(){
 const previousHeadful=process.env.AMORIST_QA_CHROMIUM_HEADFUL;
 process.env.AMORIST_QA_CHROMIUM_HEADFUL="1";

 const entries=resolveEngines().filter(entry=>entry.applicable);assert.ok(entries.length);
 const server=await startStaticServer(path.resolve(__dirname,'..'));
 try {for(const entry of entries){
  assert.ok(entry.available,entry.reason);const engine=entry.create();
  try {
   await engine.start();await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
   await engine.evaluate(`(() => {
    const host=document.getElementById('host'),second=document.createElement('div');host.after(second);
    window.__copyEditor=window.AmoristEditor.create(host,{value:'before **bold** after'});
    window.__pasteEditor=window.AmoristEditor.create(second,{value:'target: '});
    window.__nativePaste=[];
    for(const pane of [window.__pasteEditor.surface,window.__pasteEditor.source]) pane.addEventListener('paste',event=>{
      window.__nativePaste.push({trusted:event.isTrusted,types:Array.from(event.clipboardData.types),plain:event.clipboardData.getData('text/plain')});
    },true);
    window.__copyEditor.focus();window.__copyEditor.setSurfaceSelection(9,13);return true;
   })()`);
   const send=async sequence=>{await engine.sendKeys(sequence);await new Promise(resolve=>setTimeout(resolve,100));};
   await send([{key:'c',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   await engine.evaluate(`(() => {window.__pasteEditor.focus();window.__pasteEditor.setSurfaceSelection(8,8);return true;})()`);
   await send([{key:'v',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   const visual=await engine.evaluate(`({source:window.__pasteEditor.getMarkdown(),original:window.__copyEditor.getMarkdown(),paste:window.__nativePaste})`);
   assert.equal(visual.source,'target: **bold**',JSON.stringify(visual));assert.equal(visual.original,'before **bold** after');
   assert.equal(visual.paste.length,1);assert.equal(visual.paste[0].trusted,true);assert.equal(visual.paste[0].plain,'**bold**');
   await engine.evaluate(`(() => {const editor=window.__pasteEditor;editor.setMarkdown('');editor.showSourceMode();editor.focus();editor.source.setSelectionRange(0,0);return true;})()`);
   await send([{key:'v',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   assert.equal(await engine.evaluate('window.__pasteEditor.getMarkdown()'),'**bold**');
   const secondEngine=entry.create();
   try {
    await secondEngine.start();await secondEngine.navigate(`${server.origin}/tests/qa/page/harness.html`);
    await secondEngine.evaluate(`(() => {
      const editor=window.__secondWindow=window.AmoristEditor.create(document.getElementById('host'),{value:'window: '});
      window.__windowPaste=[];editor.surface.addEventListener('paste',event=>window.__windowPaste.push({trusted:event.isTrusted,types:Array.from(event.clipboardData.types)}),true);
      editor.focus();editor.setSurfaceSelection(8,8);return true;
    })()`);
    await secondEngine.sendKeys([{key:'v',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
    await new Promise(resolve=>setTimeout(resolve,100));
    const transferred=await secondEngine.evaluate('({source:window.__secondWindow.getMarkdown(),events:window.__windowPaste})');
    assert.equal(transferred.source,'window: **bold**',JSON.stringify(transferred));assert.equal(transferred.events[0].trusted,true);
   } finally {await secondEngine.close();}
   await engine.evaluate(`(() => {window.__copyEditor.focus();window.__copyEditor.setSurfaceSelection(9,13);return true;})()`);
   await send([{key:'x',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   assert.equal(await engine.evaluate('window.__copyEditor.getMarkdown()'),'before  after');
   await send([{key:'z',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   assert.equal(await engine.evaluate('window.__copyEditor.getMarkdown()'),'before **bold** after');
   assert.deepEqual(await engine.evaluate('window.__copyEditor.selectionRaw()'),{start:9,end:13});
   await engine.evaluate(`(() => {const editor=window.__pasteEditor;editor.setMarkdown('');editor.focus();editor.source.setSelectionRange(0,0);return true;})()`);
   if(process.platform==='win32' && entry.id==='webview2') {
    // Edge WebDriver emits two trusted paste events for this chord. Windows
    // SendKeys emits one, as a real keyboard does; retain the same assertions.
    const script=`Add-Type -AssemblyName System.Windows.Forms
      $session=(Get-Process -Id $PID).SessionId
      $owned=@(Get-Process amorist | Where-Object { $_.Path -eq $env:AMORIST_QA_APPLICATION -and $_.SessionId -eq $session })
      if($owned.Count -ne 1){throw 'Expected exactly one owned application in this session'}
      $shell=New-Object -ComObject WScript.Shell
      if(!$shell.AppActivate($owned[0].Id)){throw 'Owned application activation failed'}
      Start-Sleep -Milliseconds 200
      [System.Windows.Forms.SendKeys]::SendWait('^+v')`;
    const result=require('node:child_process').spawnSync('powershell.exe',['-NoProfile','-Command',script],
      {encoding:'utf8',timeout:10000,env:{...process.env,AMORIST_QA_APPLICATION:engine.application}});
    assert.equal(result.status,0,result.stderr);
    await new Promise(resolve=>setTimeout(resolve,100));
   } else await send([{key:'v',shift:true,ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   assert.equal(await engine.evaluate('window.__pasteEditor.getMarkdown()'),'**bold**');
   console.log(`system clipboard: ${entry.id} passed; types=${visual.paste[0].types.join(',')}`);
  } finally {await engine.close();}
 }} finally {await server.stop();if(previousHeadful===undefined) delete process.env.AMORIST_QA_CHROMIUM_HEADFUL;else process.env.AMORIST_QA_CHROMIUM_HEADFUL=previousHeadful;}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
