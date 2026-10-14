'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {resolveEngines}=require('./qa/lib/engines');const {startStaticServer}=require('./qa/lib/server');
async function main(){const server=await startStaticServer(path.resolve(__dirname,'..'));try{for(const entry of resolveEngines().filter(item=>item.applicable)){assert.ok(entry.available,entry.reason);const engine=entry.create();try{await engine.start();await engine.navigate(server.origin+'/tests/qa/page/harness.html');
 for(const [source,tag,parts] of [['**first λ\r\nsecond**\r\n\r\noutside','strong',['first λ','second']],['*first\rsecond*\r\routside','em',['first','second']],['~~first\nsecond~~\n\noutside','del',['first','second']],['``first ` λ\r\nsecond``\r\n\r\noutside','code',['first ` λ','second']]]){
  const view=await engine.evaluate(`(()=>{const host=document.getElementById('host');if(window.__multi)window.__multi.destroy();host.replaceChildren();const editor=window.__multi=window.AmoristEditor.create(host,{value:${JSON.stringify(source)}});return {source:editor.getMarkdown(),styled:Array.from(editor.surface.querySelectorAll(${JSON.stringify(tag)})).map(node=>node.textContent),rows:editor.surface.querySelectorAll('.amorist-source-line').length};})()`);
  assert.equal(view.source,source);assert.deepEqual(view.styled,parts,entry.id+': multiline '+tag);assert.equal(view.rows,4);
  const at=source.indexOf('second')+3;await engine.evaluate(`(()=>{window.__multi.focus();window.__multi.setSurfaceSelection(${at},${at});return true;})()`);await engine.sendKeys(['X']);await engine.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(await engine.evaluate('window.__multi.getMarkdown()'),source.slice(0,at)+'X'+source.slice(at));
  await engine.evaluate('(()=>{window.__multi.undo();window.__multi.showSourceMode();window.__multi.showWysiwygMode();return true;})()');assert.equal(await engine.evaluate('window.__multi.getMarkdown()'),source);
  if(tag==='code'){
   await engine.evaluate(`(()=>{window.__multi.focus();window.__multi.setSurfaceSelection(${at},${at});return true;})()`);await engine.sendKeys([{key:'Enter'}]);await engine.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(await engine.evaluate('window.__multi.getMarkdown()'),source.slice(0,at)+'\r\n'+source.slice(at));
   await engine.evaluate('(()=>{window.__multi.undo();return true;})()');assert.equal(await engine.evaluate('window.__multi.getMarkdown()'),source);
  }
 }
 const dependency=await engine.evaluate(`(()=>{const editor=window.__multi,source='**first\\r\\nsecond**\\r\\n\\r\\noutside';editor.setMarkdown(source);const outside=editor.rowNodes.at(-1),first=editor.rowNodes[0],at=source.indexOf('second')+6;editor.apply(at,at+2,'','remove-closing-markers');const result={source:editor.getMarkdown(),strong:editor.surface.querySelectorAll('strong').length,firstRefreshed:editor.rowNodes[0]!==first,outsideSame:editor.rowNodes.at(-1)===outside};editor.undo();result.undo=editor.getMarkdown();result.restored=editor.surface.querySelectorAll('strong').length;return result;})()`);
 assert.deepEqual(dependency,{source:'**first\r\nsecond\r\n\r\noutside',strong:0,firstRefreshed:true,outsideSame:true,undo:'**first\r\nsecond**\r\n\r\noutside',restored:2});
 for(const source of ['> **first λ\r\n> second**\r\n> outside','- **first λ\r\n  second**\r\n- outside','- [x] **first λ\r\n  second**\r\n- outside','**first λ\r\nsecond**\r\n===\r\noutside']){
  const view=await engine.evaluate(`(()=>{const editor=window.__multi;editor.setMarkdown(${JSON.stringify(source)});return {source:editor.getMarkdown(),styled:Array.from(editor.surface.querySelectorAll('strong')).map(node=>node.textContent)};})()`);assert.deepEqual(view,{source,styled:['first λ','second']},entry.id+': container inline context');
  const at=source.indexOf('second')+3;await engine.evaluate(`(()=>{window.__multi.focus();window.__multi.setSurfaceSelection(${at},${at});return true;})()`);await engine.sendKeys(['X']);await engine.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(await engine.evaluate('window.__multi.getMarkdown()'),source.slice(0,at)+'X'+source.slice(at));await engine.evaluate('(()=>{window.__multi.undo();window.__multi.showSourceMode();window.__multi.showWysiwygMode();return true;})()');assert.equal(await engine.evaluate('window.__multi.getMarkdown()'),source);
 }
 for(const source of ['- **first\r\n- second**','> **first\r\n>\r\n> second**','# **first\r\n# second**']){
  const strong=await engine.evaluate(`(()=>{window.__multi.setMarkdown(${JSON.stringify(source)});return window.__multi.surface.querySelectorAll('strong').length;})()`);assert.equal(strong,0,entry.id+': inline cannot cross sibling/paragraph/heading boundary');
 }
 for(const [source,prefix] of [['> ``first second``','> '],['- ``first second``','  '],['- [x] ``first second``','  ']]){
  const at=source.indexOf('second')+3;await engine.evaluate(`(()=>{const editor=window.__multi;editor.setMarkdown(${JSON.stringify(source)});editor.focus();editor.setSurfaceSelection(${at},${at});return true;})()`);await engine.sendKeys([{key:'Enter'}]);await engine.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(await engine.evaluate('window.__multi.getMarkdown()'),source.slice(0,at)+'\n'+prefix+source.slice(at),entry.id+': inline code Enter retains container without repeating list marker');
 }
 const copied=await engine.evaluate(`(()=>{const editor=window.__multi,source='**first\\r\\nmiddle\\r\\nthird\\r\\nlast**',data=new Map();editor.setMarkdown(source);editor.setSurfaceSelection(source.indexOf('middle')+1,source.indexOf('third')+3);const event={clipboardData:{setData:(type,value)=>data.set(type,value),getData:type=>data.get(type)||''},preventDefault(){}};editor.handleCopy(event,false);const unchanged=editor.getMarkdown(),fragment=data.get('text/plain');editor.setMarkdown('target: ');editor.setSurfaceSelection(8,8);editor.handlePaste(event);const result={fragment,unchanged,pasted:editor.getMarkdown(),styled:Array.from(editor.surface.querySelectorAll('strong')).map(node=>node.textContent)};editor.undo();result.undo=editor.getMarkdown();return result;})()`);
 assert.deepEqual(copied,{fragment:'**iddle\r\nthi**',unchanged:'**first\r\nmiddle\r\nthird\r\nlast**',pasted:'target: **iddle\r\nthi**',styled:['iddle','thi'],undo:'target: '},entry.id+': middle-row clipboard retains inherited formatting');
 for(const source of ['``ab `cd ef gh``','``ab `cd\r\nef gh``']){
  const start=source.indexOf('`cd'),end=source.indexOf('gh')+2;
  const value=await engine.evaluate(`(()=>{const editor=window.__multi;editor.setMarkdown(${JSON.stringify(source)});const fragment=editor.clipboardFragment({start:${start},end:${end}});editor.setMarkdown(fragment);return {fragment,code:Array.from(editor.surface.querySelectorAll('code')).map(node=>node.textContent)};})()`);
  assert.equal(value.fragment,'`` '+source.slice(start,end)+' ``',entry.id+': partial inline code uses safe padding');assert.deepEqual(value.code,source.slice(start,end).split('\r\n'));
 }
 for(const [source,expected] of [['**``ab `cd\r\nef gh``**','**`` `cd\r\nef gh ``**'],['> ``ab `cd\r\n> ef gh``','> `` `cd\r\n> ef gh ``']]){
  const start=source.indexOf('`cd'),end=source.indexOf('gh')+2;
  const fragment=await engine.evaluate(`(()=>{window.__multi.setMarkdown(${JSON.stringify(source)});return window.__multi.clipboardFragment({start:${start},end:${end}});})()`);assert.equal(fragment,expected,entry.id+': safe inline code retains enclosing context');
 }
 const htmlCode=await engine.evaluate(`(()=>{const source=window.AmoristInternals.HtmlToMarkdown.convert('<p><code>first\\nsecond</code></p>');window.__multi.setMarkdown(source);return {source,code:Array.from(window.__multi.surface.querySelectorAll('code')).map(node=>node.textContent)};})()`);
 assert.deepEqual(htmlCode,{source:'`first\nsecond`',code:['first','second']},entry.id+': external HTML code keeps physical rows');
 const literalSlash='`first\\\r\nsecond`';
 const slashView=await engine.evaluate(`(()=>{window.__multi.setMarkdown(${JSON.stringify(literalSlash)});return {source:window.__multi.getMarkdown(),code:Array.from(window.__multi.surface.querySelectorAll('code')).map(node=>node.textContent)};})()`);
 assert.deepEqual(slashView,{source:literalSlash,code:['first\\','second']},entry.id+': code keeps literal trailing backslash');
 for(const source of ['`first\r\nsecond`','**`first\nsecond`**','> `first\n> second`','- `first\n  second`','- [x] `first\n  second`','123. `first\n     second`']){
  const value=await engine.evaluate(`(()=>{const editor=window.__multi,data=new Map();editor.setMarkdown(${JSON.stringify(source)});editor.setSurfaceSelection(0,editor.getMarkdown().length);editor.handleCopy({clipboardData:{setData:(type,value)=>data.set(type,value)},preventDefault(){}},false);const html=data.get('text/html'),markdown=window.AmoristInternals.HtmlToMarkdown.convert(html);editor.setMarkdown(markdown);return {code:Array.from(editor.surface.querySelectorAll('code')).map(node=>node.textContent),htmlCode:(new DOMParser().parseFromString(html,'text/html')).querySelector('code').textContent};})()`);
  assert.deepEqual(value,{code:['first','second'],htmlCode:'first\nsecond'},entry.id+': generated HTML-only code round-trip');
 }
 console.log('Multiline inline: '+entry.id+' passed');
 }finally{await engine.close();}}}finally{await server.stop();}}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
