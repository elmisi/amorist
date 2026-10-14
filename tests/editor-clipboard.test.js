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
   const result=await engine.evaluate(`(() => {
    const host=document.getElementById('host');
    const editor=window.__clip=window.AmoristEditor.create(host,{value:'before **bold** after\\r\\n'});
    const data=new Map();const clipboard={setData:(type,value)=>data.set(type,value),getData:type=>data.get(type)||''};
    const event={clipboardData:clipboard,preventDefault(){this.prevented=true;}};
    editor.setSurfaceSelection(10,12);editor.handleCopy(event,false);
    const copied={plain:data.get('text/plain'),html:data.get('text/html'),internal:JSON.parse(data.get('application/x-amorist-markdown+json')),source:editor.getMarkdown()};
    editor.setMarkdown('target: ');editor.setSurfaceSelection(8,8);editor.handlePaste(event);
    const pasted=editor.getMarkdown();editor.undo();const undone=editor.getMarkdown();
    editor.setMarkdown('left **bold** right');editor.setSurfaceSelection(9,11);editor.handleCopy(event,true);
    const cut=editor.getMarkdown();editor.undo();const cutUndo=editor.getMarkdown();
    editor.showSourceMode();editor.source.setSelectionRange(0,4);editor.handleCopy(event,false);
    const sourcePlain=data.get('text/plain');editor.source.setSelectionRange(0,4);editor.handleCopy(event,true);
    const sourceCut={raw:editor.getMarkdown(),display:editor.source.value};editor.undo();
    data.set('text/plain','raw *text*\\r\\nnext');data.set('text/html','<strong>wrong HTML</strong>');
    editor.source.setSelectionRange(0,0);editor.handlePaste(event);
    const sourcePaste={raw:editor.getMarkdown(),display:editor.source.value};
    editor.setMarkdown(${JSON.stringify("plain `code` after")});editor.showWysiwygMode();editor.setSurfaceSelection(editor.getMarkdown().length,editor.getMarkdown().length);
    data.set('application/x-amorist-markdown+json','malformed');data.set('text/html','<strong>HTML</strong>');data.set('text/plain','plain');editor.handlePaste(event);
    const outsideCode=editor.getMarkdown();
    editor.setMarkdown(${JSON.stringify("plain `code` after")});editor.setSurfaceSelection(9,9);editor.handlePaste(event);
    const insideCode=editor.getMarkdown();
    editor.setMarkdown('');editor.setSurfaceSelection(0,0);editor.handlePaste({...event,shiftKey:true});
    const plainPaste=editor.getMarkdown();
    editor.setMarkdown('keep');editor.setSurfaceSelection(0,4);editor.handleCopy({clipboardData:{setData(){throw new Error('denied');}},preventDefault(){}},true);
    return {copied,pasted,undone,cut,cutUndo,sourcePlain,sourceCut,sourcePaste,outsideCode,insideCode,plainPaste,failedCut:editor.getMarkdown()};
   })()`);
   assert.equal(result.copied.plain,'**ol**');assert.deepEqual(result.copied.internal,{schemaVersion:1,markdown:'**ol**'});
   assert.match(result.copied.html,/<strong>ol<\/strong>/);assert.equal(result.copied.source,'before **bold** after\r\n');
   assert.equal(result.pasted,'target: **ol**');assert.equal(result.undone,'target: ');
   assert.equal(result.cut,'left **bo** right');assert.equal(result.cutUndo,'left **bold** right');
   assert.equal(result.sourcePlain,'left');assert.deepEqual(result.sourceCut,{raw:' **bold** right',display:' **bold** right'});
   assert.equal(result.sourcePaste.raw,'raw *text*\r\nnextleft **bold** right');assert.equal(result.sourcePaste.display,'raw *text*\nnextleft **bold** right');
   assert.equal(result.outsideCode,'plain `code` after**HTML**');assert.equal(result.insideCode,'plain `coplainde` after');
   assert.equal(result.plainPaste,'plain');assert.equal(result.failedCut,'keep');
   const emptyCases=await engine.evaluate(`(() => {
    const editor=window.__clip, clipboard={getData:()=>''};
    editor.setMarkdown('keep selection');editor.setSurfaceSelection(0,4);
    editor.handlePaste({clipboardData:clipboard,preventDefault(){}});
    const empty=editor.getMarkdown();editor.showSourceMode();editor.source.setSelectionRange(0,4);
    editor.handlePaste({clipboardData:{getData:type=>type==='text/html'?'<strong>HTML only</strong>':''},preventDefault(){}});
    return {empty,htmlOnly:editor.getMarkdown()};
   })()`);
   assert.deepEqual(emptyCases,{empty:'keep selection',htmlOnly:'<strong>HTML only</strong> selection'});
   const structured=await engine.evaluate(`(() => {
    const editor=window.__clip;editor.showWysiwygMode();const values=[];
    for(const [source,start,end] of ${JSON.stringify([['# Heading',4,7],['- [x] Task',7,10],['> Quote',3,6],['~~~js\r\ncode body\r\n~~~',8,12]])}) {
      editor.setMarkdown(source);values.push({fragment:editor.clipboardFragment({start,end}),source:editor.getMarkdown()});
    }return values;
   })()`);
   assert.equal(structured[0].fragment,'# adi');assert.equal(structured[1].fragment,'- [x] ask');assert.equal(structured[2].fragment,'> uot');
   assert.match(structured[3].fragment,/^`{3,}js\r\node \r\n`{3,}$/);
   console.log(`clipboard: ${entry.id} passed`);
  } finally {await engine.close();}
 }} finally {await server.stop();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
