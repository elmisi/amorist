'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {resolveEngines}=require('./qa/lib/engines');
const {startStaticServer}=require('./qa/lib/server');
async function main(){
 const server=await startStaticServer(path.resolve(__dirname,'..'));
 try {for(const entry of resolveEngines().filter(entry=>entry.applicable)){
  assert.ok(entry.available,entry.reason);const engine=entry.create();
  try {await engine.start();await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
   const result=await engine.evaluate(`(async()=>{
    const calls=[],warnings=[];const editor=window.AmoristEditor.create(document.getElementById('host'),{value:'[Label](../other.md#Heading)',onActivateLink:async href=>{calls.push(href);if(calls.length===3)throw new Error('Missing file');},onWarning:message=>warnings.push(message)});
    const link=editor.surface.querySelector('a');const prevented=[];
    for(const modifiers of [{},{ctrlKey:true},{metaKey:true},{ctrlKey:true}]){
     const event=new MouseEvent('click',{bubbles:true,cancelable:true,...modifiers});link.dispatchEvent(event);prevented.push(event.defaultPrevented);await new Promise(resolve=>setTimeout(resolve,0));
    }
    return {calls,warnings,prevented,source:editor.getMarkdown(),history:editor.history.undoStack?.length};
   })()`);
   assert.deepEqual(result.calls,Array(3).fill('../other.md#Heading'));assert.deepEqual(result.warnings,['Missing file']);assert.deepEqual(result.prevented,[true,true,true,true]);assert.equal(result.source,'[Label](../other.md#Heading)');
   const headings=await engine.evaluate(`(() => {
    const editor=window.AmoristEditor.create(document.getElementById('host'),{value:'# **Hello** λ\\r\\n\\r\\nHello λ\\r\\n---\\r\\n'});
    const before=editor.getMarkdown();const first=editor.navigateHeading('hello-λ'),one=editor.selectionRaw();
    const second=editor.navigateHeading('hello-λ-1'),two=editor.selectionRaw();
    const missing=editor.navigateHeading('absent');editor.showSourceMode();const source=editor.navigateHeading('hello-λ-1');
    return {first,second,missing,source,one:one.start,two:two.start,unchanged:editor.getMarkdown()===before};
   })()`);
   assert.deepEqual(headings,{first:true,second:true,missing:false,source:true,one:2,two:17,unchanged:true});
   console.log(`link activation: ${entry.id} passed`);
  }finally{await engine.close();}
 }}finally{await server.stop();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
