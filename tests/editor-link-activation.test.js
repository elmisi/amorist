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
    const link=editor.surface.querySelector('a');const prevented=[];let clickedDestination=null;
    for(const modifiers of [{},{ctrlKey:true},{metaKey:true},{ctrlKey:true}]){
     const event=new MouseEvent('click',{bubbles:true,cancelable:true,...modifiers});link.dispatchEvent(event);prevented.push(event.defaultPrevented);await new Promise(resolve=>setTimeout(resolve,0));
     if(!modifiers.ctrlKey&&!modifiers.metaKey){const dialog=document.querySelector('.amorist-link-dialog');clickedDestination=dialog.querySelector('input').value;dialog.dispatchEvent(new Event('cancel',{cancelable:true}));await new Promise(resolve=>setTimeout(resolve,0));}
    }
    return {calls,warnings,prevented,clickedDestination,source:editor.getMarkdown(),history:editor.history.undoStack?.length};
   })()`);
   assert.deepEqual(result.calls,Array(3).fill('../other.md#Heading'));assert.deepEqual(result.warnings,['Missing file']);assert.deepEqual(result.prevented,[true,true,true,true]);assert.equal(result.clickedDestination,'../other.md#Heading');assert.equal(result.source,'[Label](../other.md#Heading)');
   const headings=await engine.evaluate(`(() => {
    const editor=window.AmoristEditor.create(document.getElementById('host'),{value:'# **Hello** λ\\r\\n\\r\\nHello λ\\r\\n---\\r\\n'});
    const before=editor.getMarkdown();const first=editor.navigateHeading('hello-λ'),one=editor.selectionRaw();
    const second=editor.navigateHeading('hello-λ-1'),two=editor.selectionRaw();
    const missing=editor.navigateHeading('absent');editor.showSourceMode();const source=editor.navigateHeading('hello-λ-1');
    return {first,second,missing,source,one:one.start,two:two.start,unchanged:editor.getMarkdown()===before};
   })()`);
   assert.deepEqual(headings,{first:true,second:true,missing:false,source:true,one:2,two:17,unchanged:true});
   const top=await engine.evaluate(`(() => {
    const editor=window.AmoristEditor.create(document.getElementById('host'),{value:'First\\r\\n\\r\\n# Heading\\r\\n'});
    const before=editor.getMarkdown();editor.setSurfaceSelection(12,12);
    const visual=editor.navigateHeading(''),visualAt=editor.selectionRaw().start;
    editor.showSourceMode();editor.source.setSelectionRange(10,10);editor.source.scrollTop=100;
    const source=editor.navigateHeading('');
    return {visual,visualAt,source,sourceAt:editor.source.selectionStart,scroll:editor.source.scrollTop,unchanged:editor.getMarkdown()===before};
   })()`);
   assert.deepEqual(top,{visual:true,visualAt:0,source:true,sourceAt:0,scroll:0,unchanged:true});
   const dialog=await engine.evaluate(`(async()=>{
    const editor=window.AmoristEditor.create(document.getElementById('host'),{value:'Label'});editor.setSurfaceSelection(0,5);
    const cancelled=editor.runAction('link');const modal=document.querySelector('.amorist-link-dialog');const focused=document.activeElement===modal.querySelector('input');
    modal.dispatchEvent(new Event('cancel',{cancelable:true}));await cancelled;const unchanged=editor.getMarkdown();
    editor.setSurfaceSelection(0,5);const saved=editor.runAction('link');const form=document.querySelector('.amorist-link-dialog form');form.querySelector('input').value='../note.md#title';form.dispatchEvent(new Event('submit',{cancelable:true}));await saved;
    const result=editor.getMarkdown();editor.undo();return {focused,unchanged,result,undo:editor.getMarkdown(),removed:!document.querySelector('.amorist-link-dialog')};
   })()`);
   assert.deepEqual(dialog,{focused:true,unchanged:'Label',result:'[Label](../note.md#title)',undo:'Label',removed:true});
   await engine.evaluate(`(() => {
    const host=document.getElementById('host');host.replaceChildren();const editor=window.__linkKeyboard=window.AmoristEditor.create(host,{value:'Label λ\\r\\nuntouched'});
    editor.restoreRawSelection({start:0,end:5,direction:'backward'});editor.toolbar.querySelector('[data-action="link"]').focus();return true;
   })()`);
   await engine.sendKeys([{key:'Enter'}]);
   async function waitKeyboard(expression){const deadline=Date.now()+4000;while(!await engine.evaluate(expression)){assert.ok(Date.now()<deadline,'Keyboard dialog transition: '+expression+' '+JSON.stringify(await engine.evaluate(`({active:document.activeElement.outerHTML.slice(0,400),source:window.__linkKeyboard.getMarkdown(),selection:window.__linkKeyboard.selectionRaw()})`)));await new Promise(resolve=>setTimeout(resolve,20));}}
   await waitKeyboard(`!!document.querySelector('.amorist-link-dialog[open]')`);
   const accessible=await engine.evaluate(`(() => {const dialog=document.querySelector('.amorist-link-dialog');return {name:document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent,focus:document.activeElement===dialog.querySelector('input')};})()`);
   assert.deepEqual(accessible,{name:'Link',focus:true});
   await engine.sendKeys([{key:'Escape'}]);await waitKeyboard(`!document.querySelector('.amorist-link-dialog')`);
   assert.deepEqual(await engine.evaluate(`({source:window.__linkKeyboard.getMarkdown(),selection:window.__linkKeyboard.selectionRaw(),direction:window.__linkKeyboard.selectionDirection(),focus:document.activeElement===window.__linkKeyboard.toolbar.querySelector('[data-action="link"]')})`),{source:'Label λ\r\nuntouched',selection:{start:0,end:5},direction:'backward',focus:true});
   await engine.sendKeys([{key:'Enter'}]);await waitKeyboard(`!!document.querySelector('.amorist-link-dialog[open]')`);
   await engine.sendKeys(['../keyboard.md',{key:'Enter'}]);await waitKeyboard(`!document.querySelector('.amorist-link-dialog')&&window.__linkKeyboard.getMarkdown()==='[Label](../keyboard.md) λ\\r\\nuntouched'`);
   await engine.evaluate('(() => {window.__linkKeyboard.undo();return true;})()');assert.equal(await engine.evaluate('window.__linkKeyboard.getMarkdown()'),'Label λ\r\nuntouched');
   const edited=await engine.evaluate(`(async()=>{
    const raw='Before [**Label**](<old path.md> "Title") after\\r\\n';
    const editor=window.AmoristEditor.create(document.getElementById('host'),{value:raw});editor.setSurfaceSelection(12,12);
    const pending=editor.runAction('link');const form=document.querySelector('.amorist-link-dialog form'),initial=form.querySelector('input').value;
    form.querySelector('input').value='../new.md#heading';form.dispatchEvent(new Event('submit',{cancelable:true}));await pending;
    const source=editor.getMarkdown();editor.undo();return {initial,source,undo:editor.getMarkdown()};
   })()`);
   assert.deepEqual(edited,{initial:'old path.md',source:'Before [**Label**](<../new.md#heading> "Title") after\r\n',undo:'Before [**Label**](<old path.md> "Title") after\r\n'});
   const reference=await engine.evaluate(`(async()=>{
    const raw='[One][shared] and [Two][shared]\\r\\n\\r\\n[shared]: <old path.md> "Title"\\r\\n';
    const editor=window.AmoristEditor.create(document.getElementById('host'),{value:raw});editor.setSurfaceSelection(2,2);
    const pending=editor.runAction('link');const form=document.querySelector('.amorist-link-dialog form');form.querySelector('input').value='../changed.md';form.dispatchEvent(new Event('submit',{cancelable:true}));await pending;
    const source=editor.getMarkdown(),destinations=Array.from(editor.surface.querySelectorAll('a')).map(link=>link.dataset.linkDestination);editor.undo();
    return {source,destinations,undo:editor.getMarkdown()};
   })()`);
   assert.deepEqual(reference,{source:'[One][shared] and [Two][shared]\r\n\r\n[shared]: <../changed.md> "Title"\r\n',destinations:['../changed.md','../changed.md'],undo:'[One][shared] and [Two][shared]\r\n\r\n[shared]: <old path.md> "Title"\r\n'});
   for(const action of ['toolbar','click'])for(const raw of ['[first\r\nsecond](<old path.md> "Title")\r\nuntouched','> [first\r\n> second](<old path.md> "Title")\r\nuntouched','> - [first\r\n>   second](<old path.md> "Title")\r\nuntouched','[first\r\nsecond][shared]\r\n\r\n[shared]: <old path.md> "Title"\r\n']){
    const multiline=await engine.evaluate(`(async()=>{const raw=${JSON.stringify(raw)},host=document.getElementById('host');host.replaceChildren();const editor=window.AmoristEditor.create(host,{value:raw});editor.setSurfaceSelection(raw.indexOf('second')+2,raw.indexOf('second')+2);let pending;if(${JSON.stringify(action)}==='click'){editor.surface.querySelectorAll('a')[1].dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));pending=Promise.resolve();}else pending=editor.runAction('link');const form=document.querySelector('.amorist-link-dialog form'),initial=form.querySelector('input').value;form.querySelector('input').value='../multiline.md#λ';form.dispatchEvent(new Event('submit',{cancelable:true}));await pending;await new Promise(resolve=>setTimeout(resolve,0));const source=editor.getMarkdown(),labels=Array.from(editor.surface.querySelectorAll('a')).map(node=>node.textContent);editor.undo();return {initial,source,labels,undo:editor.getMarkdown()};})()`);
    assert.deepEqual(multiline,{initial:'old path.md',source:raw.replace('old path.md','../multiline.md#λ'),labels:['first','second'],undo:raw},entry.id+'/'+action+': editing cross-row link changes only complete destination');
   }
   for(const [automatic,label,href,escapedLabel] of [['https://example.test/path','https://example.test/path','https://example.test/path'],['<https://example.test/path>','https://example.test/path','https://example.test/path'],['<alice@example.test>','alice@example.test','mailto:alice@example.test'],['https://example.test/?q=&copy;value','https://example.test/?q=&copy;value','https://example.test/?q=&copy;value']]) {
    const source='before '+automatic+' after\r\n';
    const edited=await engine.evaluate(`(async()=>{
      const host=document.getElementById('host');host.replaceChildren();const editor=window.AmoristEditor.create(host,{value:${JSON.stringify(source)}});
      const at=${source.indexOf(label)+2};editor.setSurfaceSelection(at,at);const pending=editor.runAction('link');const form=document.querySelector('.amorist-link-dialog form');
      const initial=form?.querySelector('input').value;if(!form)return {initial};form.querySelector('input').value='../changed.md#λ';form.dispatchEvent(new Event('submit',{cancelable:true}));await pending;
      const result=editor.getMarkdown(),visible=editor.surface.querySelector('a').textContent;editor.undo();return {initial,result,visible,undo:editor.getMarkdown()};
    })()`);
    assert.equal(edited.initial,href,`${entry.id}: automatic link dialog starts with existing destination`);assert.equal(edited.result,'before ['+(escapedLabel||label)+'](../changed.md#λ) after\r\n');assert.equal(edited.undo,source);
    assert.equal(edited.visible,label,`${entry.id}: converting an automatic link retains its visible label`);
   }
   console.log(`link activation: ${entry.id} passed`);
  }finally{await engine.close();}
 }}finally{await server.stop();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
