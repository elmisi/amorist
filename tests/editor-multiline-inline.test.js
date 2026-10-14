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
 console.log('Multiline inline: '+entry.id+' passed');
 }finally{await engine.close();}}}finally{await server.stop();}}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
