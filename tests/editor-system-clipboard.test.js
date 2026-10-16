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
   if(process.platform==='win32' && entry.id==='webview2') await send([],engine,true);
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
   async function send(sequence,target=engine,focusOnly=false){
    if(process.platform==='win32' && entry.id==='webview2') {
     assert.equal(sequence.length,focusOnly?0:1);const key=focusOnly?{key:''}:sequence[0];if(!focusOnly)assert.match(key.key,/^[cvxz]$/);
     const script=`Add-Type -AssemblyName System.Windows.Forms
       $owned=Get-Process -Id $env:AMORIST_QA_APP_PID -ErrorAction Stop
       if($owned.Path -ne $env:AMORIST_QA_APPLICATION -or $owned.SessionId -ne (Get-Process -Id $PID).SessionId){throw 'Owned application identity mismatch'}
       $shell=New-Object -ComObject WScript.Shell
       if(!$shell.AppActivate($owned.Id)){throw 'Owned application activation failed'}
       Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class AmoristClipboardFocus{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}'
       $end=[DateTime]::UtcNow.AddSeconds(3);[uint32]$foreground=0
       do{[void][AmoristClipboardFocus]::GetWindowThreadProcessId([AmoristClipboardFocus]::GetForegroundWindow(),[ref]$foreground);if($foreground -ne $owned.Id){Start-Sleep -Milliseconds 50}}while($foreground -ne $owned.Id -and [DateTime]::UtcNow -lt $end)
       if($foreground -ne $owned.Id){throw 'Owned application not foreground; keyboard input refused'}
       if($env:AMORIST_QA_CHORD){[System.Windows.Forms.SendKeys]::SendWait($env:AMORIST_QA_CHORD)}`;
     const result=require('node:child_process').spawnSync('powershell.exe',['-NoProfile','-Command',script],
       {encoding:'utf8',timeout:30000,env:{...process.env,AMORIST_QA_APPLICATION:target.application,
        AMORIST_QA_APP_PID:String(target.applicationProcess.pid),AMORIST_QA_CHORD:(key.ctrl?'^':'')+(key.shift?'+':'')+key.key}});
     assert.equal(result.status,0,result.error?.message||result.stderr);
    } else await target.sendKeys(sequence);
    await new Promise(resolve=>setTimeout(resolve,100));
   };
   await send([{key:'c',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   await engine.evaluate(`(() => {window.__pasteEditor.focus();window.__pasteEditor.setSurfaceSelection(8,8);return true;})()`);
   await send([{key:'v',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   const visual=await engine.evaluate(`({source:window.__pasteEditor.getMarkdown(),original:window.__copyEditor.getMarkdown(),paste:window.__nativePaste})`);
   assert.equal(visual.source,'target: **bold**',JSON.stringify(visual));assert.equal(visual.original,'before **bold** after');
   assert.equal(visual.paste.length,1);assert.equal(visual.paste[0].trusted,true);assert.equal(visual.paste[0].plain,'**bold**');
   await engine.evaluate(`(() => {const editor=window.__pasteEditor;editor.setMarkdown('');editor.showSourceMode();editor.focus();editor.source.setSelectionRange(0,0);return true;})()`);
   await send([{key:'v',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   assert.equal(await engine.evaluate('window.__pasteEditor.getMarkdown()'),'**bold**');
   const secondEngine=engine.openWindow ? await engine.openWindow() : entry.create();
   try {
    await secondEngine.start();await secondEngine.navigate(`${server.origin}/tests/qa/page/harness.html`);
    if(process.platform==='win32' && entry.id==='webview2') await send([],secondEngine,true);
    await secondEngine.evaluate(`(() => {
      const editor=window.__secondWindow=window.AmoristEditor.create(document.getElementById('host'),{value:'window: '});
      window.__windowPaste=[];editor.surface.addEventListener('paste',event=>window.__windowPaste.push({trusted:event.isTrusted,types:Array.from(event.clipboardData.types),plain:event.clipboardData.getData('text/plain')}),true);
      editor.focus();editor.setSurfaceSelection(8,8);return true;
    })()`);
    await send([{key:'v',ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}],secondEngine);
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
   await engine.evaluate(`(() => {const editor=window.__pasteEditor;editor.setMarkdown('');editor.showWysiwygMode();editor.focus();editor.setSurfaceSelection(0,0);window.__plainKeys=[];editor.surface.addEventListener('keydown',event=>window.__plainKeys.push({key:event.key,code:event.code,shift:event.shiftKey,meta:event.metaKey,alt:event.altKey}));return true;})()`);
   await send([{key:'v',shift:true,ctrl:process.platform!=='darwin',meta:process.platform==='darwin'}]);
   const plainDeadline=Date.now()+3000;
   while(await engine.evaluate('window.__pasteEditor.getMarkdown()')!== '**bold**' && Date.now()<plainDeadline) await new Promise(resolve=>setTimeout(resolve,25));
   assert.equal(await engine.evaluate('window.__pasteEditor.getMarkdown()'),'**bold**',JSON.stringify(await engine.evaluate('({keys:window.__plainKeys,paste:window.__nativePaste})')));
   console.log(`system clipboard: ${entry.id} passed; types=${visual.paste[0].types.join(',')}`);
  } finally {await engine.close();}
 }} finally {await server.stop();if(previousHeadful===undefined) delete process.env.AMORIST_QA_CHROMIUM_HEADFUL;else process.env.AMORIST_QA_CHROMIUM_HEADFUL=previousHeadful;}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
