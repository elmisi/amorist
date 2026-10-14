'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {resolveEngines}=require('./qa/lib/engines');
const {startStaticServer}=require('./qa/lib/server');
async function main(options={}){
 const exercised=[];
 const entries=resolveEngines(options.engineIds).filter(entry=>entry.applicable);assert.ok(entries.length,"No applicable engine declared for clipboard probes");
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
   for(const quote of ['> ', '> > ']) {
    const codeSource=[quote+'~~~~js',quote+'# literal ``` λ',quote+'> literal **bold**',quote+'~~~~'].join('\r\n');
    const start=codeSource.indexOf('# literal'),end=codeSource.indexOf('> literal **bold**')+'> literal **bold**'.length;
    const copiedCode=await engine.evaluate(`(() => {
      const editor=window.__clip,data=new Map();editor.setMarkdown(${JSON.stringify(codeSource)});editor.showWysiwygMode();editor.setSurfaceSelection(${start},${end});
      const event={clipboardData:{setData:(type,value)=>data.set(type,value),getData:type=>data.get(type)||''},preventDefault(){}};
      editor.handleCopy(event,false);const before=editor.getMarkdown(),fragment=data.get('text/plain');
      editor.setMarkdown('\\r\\noutside\\r\\n');editor.setSurfaceSelection(0,0);editor.handlePaste(event);
      const result={before,fragment,pasted:editor.getMarkdown(),code:Array.from(editor.surface.querySelectorAll('.amorist-wysiwyg-code')).map(row=>row.textContent.replace(/\\n$/,''))};editor.undo();result.undo=editor.getMarkdown();return result;
    })()`);
    const fragment=[quote+'````js',quote+'# literal ``` λ',quote+'> literal **bold**',quote+'````'].join('\r\n');
    assert.equal(copiedCode.before,codeSource);assert.equal(copiedCode.fragment,fragment,`${entry.id}: quoted code copy preserves context and literal inner quote marker`);
    assert.equal(copiedCode.pasted,fragment+'\r\noutside\r\n');assert.equal(copiedCode.undo,'\r\noutside\r\n');assert.deepEqual(copiedCode.code,['# literal ``` λ','> literal **bold**']);
   }
   const reference=await engine.evaluate(`(() => {
    const editor=window.__clip,source=${JSON.stringify('[Read][name]\r\n\r\n[name]: notes.md "Title"')};
    editor.setMarkdown(source);const fragment=editor.clipboardFragment({start:1,end:5});
    editor.setMarkdown(fragment);return {fragment,links:Array.from(editor.surface.querySelectorAll('a')).map(a=>a.dataset.linkDestination)};
   })()`);
   assert.equal(reference.fragment,'[Read][name]\r\n\r\n[name]: notes.md "Title"');assert.deepEqual(reference.links,['notes.md']);
   const collision=await engine.evaluate(`(() => {
    const editor=window.__clip,destination=${JSON.stringify('[Existing][name]\n\n[name]: old.md\n\n')},fragment=${JSON.stringify('[Read][name]\n\n[name]: notes.md "Title"')};
    editor.setMarkdown(destination);editor.setSurfaceSelection(destination.length,destination.length);
    editor.handlePaste({clipboardData:{getData:type=>type==='application/x-amorist-markdown+json'?JSON.stringify({schemaVersion:1,markdown:fragment}):''},preventDefault(){}});
    const source=editor.getMarkdown(),links=Array.from(editor.surface.querySelectorAll('a')).map(a=>a.dataset.linkDestination);
    editor.undo();return {source,links,undo:editor.getMarkdown(),destination};
   })()`);
   assert.ok(collision.source.startsWith(collision.destination));assert.deepEqual(collision.links,['old.md','notes.md']);assert.equal(collision.undo,collision.destination);
   const tableReferences=await engine.evaluate(`(() => {
    const editor=window.__clip,source=${JSON.stringify('| Link |\n| --- |\n| [Read][name] |\n\n[name]: notes.md')};
    editor.setMarkdown(source);const fragment=editor.clipboardFragment({start:0,end:source.indexOf('\\n\\n')});
    const destination=${JSON.stringify('[Existing][name]\n\n[name]: old.md\n\n')};editor.setMarkdown(destination);editor.setSurfaceSelection(destination.length,destination.length);
    editor.handlePaste({clipboardData:{getData:type=>type==='application/x-amorist-markdown+json'?JSON.stringify({schemaVersion:1,markdown:fragment}):''},preventDefault(){}});
    return Array.from(editor.surface.querySelectorAll('a')).map(a=>a.dataset.linkDestination);
   })()`);
   assert.deepEqual(tableReferences,['old.md','notes.md']);
   const fallback=await engine.evaluate(`(() => {
    const editor=window.__clip,source=${JSON.stringify('[Read][name]\n\n[name]: notes.md "Title"')},data=new Map();
    editor.setMarkdown(source);editor.setSurfaceSelection(1,5);
    editor.handleCopy({clipboardData:{setData:(type,value)=>data.set(type,value)},preventDefault(){}},false);
    const html=data.get('text/html');data.delete('application/x-amorist-markdown+json');editor.setMarkdown('');editor.setSurfaceSelection(0,0);
    editor.handlePaste({clipboardData:{getData:type=>data.get(type)||''},preventDefault(){}});
    return {html,links:Array.from(editor.surface.querySelectorAll('a')).map(a=>a.dataset.linkDestination),titles:Array.from(editor.surface.querySelectorAll('a')).map(a=>a.getAttribute('title'))};
   })()`);
   assert.match(fallback.html,/href="notes.md"/);assert.doesNotMatch(fallback.html,/name.*notes/);assert.deepEqual(fallback.links,['notes.md']);assert.deepEqual(fallback.titles,['Title']);
   const semanticTable=await engine.evaluate(`(() => {
    const editor=window.__clip,source=${JSON.stringify('| A | B |\n| --- | --- |\n| one | two |')},data=new Map();
    editor.setMarkdown(source);editor.selectSurfaceContents();editor.handleCopy({clipboardData:{setData:(type,value)=>data.set(type,value)},preventDefault(){}},false);
    const html=data.get('text/html');data.delete('application/x-amorist-markdown+json');editor.setMarkdown('');editor.setSurfaceSelection(0,0);
    editor.handlePaste({clipboardData:{getData:type=>data.get(type)||''},preventDefault(){}});
    const table=editor.getMarkdown(),numbered=window.AmoristInternals.HtmlToMarkdown.convert('<ol start="5"><li>first</li><li value="12">second</li></ol>');
    return {html,table,numbered};
   })()`);
   assert.match(semanticTable.html,/<table>/);assert.equal(semanticTable.table,'| A | B |\n| --- | --- |\n| one | two |');assert.equal(semanticTable.numbered,'5. first\n12. second');
   const taskFallback=await engine.evaluate(`(() => {
    const editor=window.__clip,source=${JSON.stringify('- [x] Done\n- [ ] Todo')},data=new Map();
    editor.setMarkdown(source);editor.selectSurfaceContents();editor.handleCopy({clipboardData:{setData:(type,value)=>data.set(type,value)},preventDefault(){}},false);
    data.delete('application/x-amorist-markdown+json');editor.setMarkdown('');editor.setSurfaceSelection(0,0);
    editor.handlePaste({clipboardData:{getData:type=>data.get(type)||''},preventDefault(){}});return editor.getMarkdown();
   })()`);
   assert.equal(taskFallback,'- [x] Done\n- [ ] Todo');
   const orderedFallback=await engine.evaluate(`(() => {
    const editor=window.__clip,source=${JSON.stringify('5. First\n12. Second\n13. Third')},data=new Map();
    editor.setMarkdown(source);editor.selectSurfaceContents();editor.handleCopy({clipboardData:{setData:(type,value)=>data.set(type,value)},preventDefault(){}},false);
    data.delete('application/x-amorist-markdown+json');editor.setMarkdown('');editor.setSurfaceSelection(0,0);
    editor.handlePaste({clipboardData:{getData:type=>data.get(type)||''},preventDefault(){}});return editor.getMarkdown();
   })()`);
   assert.equal(orderedFallback,'5. First\n12. Second\n13. Third');
   exercised.push(entry.id);
   const partialCuts=await engine.evaluate(`(() => {
    const editor=window.__clip,event={clipboardData:{setData(){}},preventDefault(){}};
    const source='before **bold** after',out=[];
    for(const [start,end] of [[10,source.length],[0,11]]) {
      editor.setMarkdown(source);editor.setSurfaceSelection(start,end);editor.handleCopy(event,true);
      out.push({source:editor.getMarkdown(),strong:editor.surface.querySelector('strong')?.textContent});editor.undo();
      out.push({undo:editor.getMarkdown(),selection:editor.selectionRaw()});
    }return out;
   })()`);
   assert.deepEqual(partialCuts,[{source:'before **b**',strong:'b'},{undo:'before **bold** after',selection:{start:10,end:21}},
    {source:'**ld** after',strong:'ld'},{undo:'before **bold** after',selection:{start:0,end:11}}]);
   const formattedHtml=await engine.evaluate(`(() => {
    const editor=window.__clip;editor.setMarkdown('');editor.setSurfaceSelection(0,0);
    editor.handlePaste({clipboardData:{getData:type=>type==='text/html'?'<h2>Title<em> styled</em></h2><p><s>gone</s></p>':''},preventDefault(){}});
    return {source:editor.getMarkdown(),em:editor.surface.querySelector('em')?.textContent,del:editor.surface.querySelector('del')?.textContent};
   })()`);
   assert.deepEqual(formattedHtml,{source:'## Title *styled*\n\n~~gone~~',em:'styled',del:'gone'});
   const imageAtom=await engine.evaluate(`(() => {
    const editor=window.__clip,source=${JSON.stringify('before ![Alt](image.png) after\r\n')};
    editor.setMarkdown(source);editor.setSurfaceSelection(23,23);
    const atom=editor.surface.querySelector('.amorist-image-atom');
    const result={source:editor.getMarkdown(),editable:atom.contentEditable,caret:editor.selectionRaw(),text:atom.textContent};
    editor.handleKeyDown({key:'Backspace',ctrlKey:false,metaKey:false,altKey:false,preventDefault(){}});
    result.deleted=editor.getMarkdown();editor.undo();result.undo=editor.getMarkdown();editor.showSourceMode();editor.showWysiwygMode();result.roundtrip=editor.getMarkdown();return result;
   })()`);
   assert.deepEqual(imageAtom,{source:'before ![Alt](image.png) after\r\n',editable:'false',caret:{start:24,end:24},text:'Alt — image.png',deleted:'before  after\r\n',undo:'before ![Alt](image.png) after\r\n',roundtrip:'before ![Alt](image.png) after\r\n'});
   await engine.evaluate(`(() => {const editor=window.__clip;editor.setMarkdown(${JSON.stringify('before ![Alt](image.png) after\r\n')});editor.focus();editor.setSurfaceSelection(7,7);return true;})()`);
   await engine.sendKeys([{key:'Delete'}]);await new Promise(resolve=>setTimeout(resolve,100));
   assert.equal(await engine.evaluate('window.__clip.getMarkdown()'),'before  after\r\n');
   await engine.sendKeys([{key:'z',ctrl:true}]);await new Promise(resolve=>setTimeout(resolve,100));
   assert.equal(await engine.evaluate('window.__clip.getMarkdown()'),'before ![Alt](image.png) after\r\n');
   const remoteSource=`before ![Alt](${server.origin}/tests/qa/assets/image.svg "Title") after\r\n`;
   await engine.evaluate(`(() => {window.__clip.setMarkdown(${JSON.stringify(remoteSource)});return true;})()`);
   const loaded=await engine.evaluate(`new Promise(resolve=> {
    const started=Date.now();const poll=()=> {
      const atom=window.__clip.surface.querySelector('.amorist-image-atom'),image=atom.querySelector('img');
      if(atom.dataset.imageState==='loaded' || Date.now()-started>3000) resolve({state:atom.dataset.imageState,width:image.naturalWidth,hidden:image.hidden,alt:image.alt,title:image.title,source:window.__clip.getMarkdown()});
      else setTimeout(poll,20);
    };poll();
   })`);
   assert.deepEqual(loaded,{state:'loaded',width:200,hidden:false,alt:'Alt',title:'Title',source:remoteSource});
   await engine.evaluate(`(() => {window.__clip.setMarkdown(${JSON.stringify(`![Broken](${server.origin}/missing-image.svg)`)});return true;})()`);
   const failed=await engine.evaluate(`new Promise(resolve=> {
    const started=Date.now();const poll=()=> {
      const atom=window.__clip.surface.querySelector('.amorist-image-atom');
      if(atom.dataset.imageState==='failed' || Date.now()-started>3000) resolve({state:atom.dataset.imageState,fallbackHidden:atom.querySelector('.amorist-image-fallback').hidden,text:atom.textContent});
      else setTimeout(poll,20);
    };poll();
   })`);
   assert.equal(failed.state,'failed');assert.equal(failed.fallbackHidden,false);assert.match(failed.text,/Broken/);
   const navigationSource='before ![Alt](image.png) after';
   await engine.evaluate(`(() => {const editor=window.__clip;editor.setMarkdown(${JSON.stringify(navigationSource)});editor.focus();editor.setSurfaceSelection(7,7);return true;})()`);
   await engine.sendKeys([{key:'ArrowRight'}]);await new Promise(resolve=>setTimeout(resolve,80));
   assert.deepEqual(await engine.evaluate('window.__clip.selectionRaw()'),{start:24,end:24});
   await engine.sendKeys([{key:'ArrowLeft',shift:true}]);await new Promise(resolve=>setTimeout(resolve,80));
   assert.deepEqual(await engine.evaluate('window.__clip.selectionRaw()'),{start:7,end:24});
   assert.equal(await engine.evaluate('window.__clip.selectionDirection()'),'backward');
   assert.equal(await engine.evaluate('window.__clip.getMarkdown()'),navigationSource);
   const lateSource=`![Late](${server.origin}/tests/qa/assets/image.svg?qaDelay=500)\n`+Array.from({length:100},(_,index)=>'line '+index).join('\n');
   const lateBefore=await engine.evaluate(`(() => {
    const editor=window.__clip;editor.setMarkdown(${JSON.stringify(lateSource)});editor.focus();
    const at=editor.getMarkdown().indexOf('line 15');editor.setSurfaceSelection(at,at);window.scrollTo(0,0);
    const selection=window.getSelection(),range=document.createRange();range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);
    return {top:range.getBoundingClientRect().top,selection:editor.selectionRaw(),state:editor.surface.querySelector('.amorist-image-atom').dataset.imageState};
   })()`);
   assert.equal(lateBefore.state,'loading');
   const lateAfter=await engine.evaluate(`new Promise(resolve=> {
    const started=Date.now();const poll=()=> {
      const editor=window.__clip,atom=editor.surface.querySelector('.amorist-image-atom');
      if(atom.dataset.imageState==='loaded' || Date.now()-started>3000) {
        const selection=window.getSelection(),range=document.createRange();range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);
        resolve({top:range.getBoundingClientRect().top,selection:editor.selectionRaw(),source:editor.getMarkdown(),state:atom.dataset.imageState});
      }else setTimeout(poll,20);
    };poll();
   })`);
   assert.equal(lateAfter.state,'loaded');assert.deepEqual(lateAfter.selection,lateBefore.selection);assert.equal(lateAfter.source,lateSource);
   assert.ok(Math.abs(lateAfter.top-lateBefore.top)<=1,`${entry.id}: late image caret moved from ${lateBefore.top} to ${lateAfter.top}`);
   const tableImageSource=`| Image | Note |\n| --- | --- |\n| ![Picture](${server.origin}/tests/qa/assets/image.svg?qaDelay=500) | ${'wide note '.repeat(35)} |\n| plain | short |`;
   const tableBefore=await engine.evaluate(`(() => {
    window.__imageError=null;window.addEventListener("error",event=>{window.__imageError={message:event.message,stack:event.error?.stack};});
    const editor=window.__clip;editor.setMarkdown(${JSON.stringify(tableImageSource)});editor.root.style.width='400px';
    const block=editor.surface.querySelector('.amorist-wysiwyg-table-block');block.scrollLeft=40;
    return {left:block.scrollLeft,state:block.querySelector('.amorist-image-atom').dataset.imageState};
   })()`);
   assert.equal(tableBefore.state,'loading');assert.equal(tableBefore.left,40);
   const tableAfter=await engine.evaluate(`new Promise(resolve=> {
    const started=Date.now();const poll=()=> {
      const editor=window.__clip,block=editor.surface.querySelector('.amorist-wysiwyg-table-block'),atom=block.querySelector('.amorist-image-atom');
      if(atom.dataset.imageState==='loaded' || Date.now()-started>3000) resolve({state:atom.dataset.imageState,error:window.__imageError,image:{complete:atom.querySelector('img').complete,width:atom.querySelector('img').naturalWidth,src:atom.querySelector('img').src,connected:atom.isConnected},left:block.scrollLeft,
        columns:Array.from(block.querySelectorAll('.amorist-source-line')).map(row=>Array.from(row.querySelectorAll('.amorist-wysiwyg-table-cell')).map(cell=>cell.getBoundingClientRect().left)),source:editor.getMarkdown()});
      else setTimeout(poll,20);
    };poll();
   })`);
   assert.equal(tableAfter.state,'loaded',JSON.stringify(tableAfter));assert.equal(tableAfter.error,null);assert.ok(Math.abs(tableAfter.left-tableBefore.left)<=1);assert.equal(tableAfter.source,tableImageSource);
   for(const columns of tableAfter.columns) for(let index=0;index<columns.length;index++) assert.ok(Math.abs(columns[index]-tableAfter.columns[0][index])<=1,`${entry.id}: image-loaded table column ${index} aligned`);
   const unsupported=await engine.evaluate(`(() => {
    const editor=window.__clip,warnings=[];editor.options.onWarning=message=>warnings.push(message);
    const html='<p>Before <sup>2</sup></p><custom-panel>raw *literal* λ</custom-panel><input value="field value"><script>discard executable</script>';
    const clipboard={getData:type=>type==='text/html'?html:type==='text/plain'?'plain fallback':''};
    editor.setMarkdown('outside\\r\\n');editor.showWysiwygMode();editor.setSurfaceSelection(0,0);
    editor.handlePaste({clipboardData:clipboard,preventDefault(){}});
    const source=editor.getMarkdown(),rendered=editor.surface.textContent;editor.undo();const undo=editor.getMarkdown();
    const count=warnings.length;editor.setMarkdown('');editor.showSourceMode();editor.source.setSelectionRange(0,0);
    editor.handlePaste({clipboardData:clipboard,preventDefault(){}});const plain=editor.getMarkdown();
    const afterPlain=warnings.length;editor.showWysiwygMode();editor.setMarkdown('');editor.setSurfaceSelection(0,0);
    editor.handlePaste({clipboardData:{getData:type=>type==='text/html'?'<p><strong>Supported</strong></p>':''},preventDefault(){}});
    return {source,rendered,undo,plain,warnings,count,afterPlain,supported:editor.getMarkdown()};
   })()`);
   assert.ok(unsupported.source.endsWith('outside\r\n'));assert.match(unsupported.source,/Before 2\r\n\r\nraw \\\*literal\\\* λfield value/);
   assert.doesNotMatch(unsupported.source,/discard executable|custom-panel|<sup/);assert.match(unsupported.rendered,/raw \*literal\* λfield value/);
   assert.equal(unsupported.undo,'outside\r\n');assert.equal(unsupported.plain,'plain fallback');assert.equal(unsupported.count,1);assert.equal(unsupported.afterPlain,1);assert.equal(unsupported.warnings.length,1);assert.match(unsupported.warnings[0],/unsupported/);assert.equal(unsupported.supported,'**Supported**');
   console.log(`clipboard: ${entry.id} passed`);
  } finally {await engine.close();}
 }} finally {await server.stop();}
 return {engines:exercised};
}
module.exports={run:main};
if(require.main===module) main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
