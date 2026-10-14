'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {resolveEngines}=require('./qa/lib/engines');
const {startStaticServer}=require('./qa/lib/server');
async function main(){

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
   console.log(`system clipboard: ${entry.id} passed; types=${visual.paste[0].types.join(',')}`);
  } finally {await engine.close();}
 }} finally {await server.stop();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
