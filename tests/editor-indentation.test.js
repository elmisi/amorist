"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveEngines } = require("./qa/lib/engines");
const { startStaticServer } = require("./qa/lib/server");

async function main() {
  const server = await startStaticServer(path.resolve(__dirname,".."));
  try {
    const entries=resolveEngines().filter(entry=>entry.applicable);
    assert.ok(entries.length,"No applicable engine declared for this platform");
    for (const entry of entries) {
      assert.ok(entry.available,entry.reason); const engine=entry.create();
      try {
        await engine.start(); await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
        for (const mode of ["wysiwyg","source"]) {
          const mount = async (source,start,end=start,backward=false) => engine.evaluate(`(() => {
            const host=document.getElementById('host'); if(window.__indent) window.__indent.destroy();host.replaceChildren();
            const editor=window.__indent=window.AmoristEditor.create(host,{value:${JSON.stringify(source)}});
            if(${JSON.stringify(mode)}==='source') editor.showSourceMode();
            editor.restoreRawSelection({start:${start},end:${end},direction:${JSON.stringify(backward?"backward":"forward")}});return true;
          })()`);
          const state = () => engine.evaluate("({source:window.__indent.getMarkdown(),selection:window.__indent.selectionRaw(),direction:window.__indent.selectionDirection()})");
          for (const ending of ["\n","\r\n","\r"]) {
            const source=`before${ending}alpha omega${ending}after`,at=source.indexOf('omega');
            await mount(source,at); await engine.sendKeys([{key:"Tab"}]);
            assert.deepEqual(await state(),{source:source.slice(0,at)+"  "+source.slice(at),selection:{start:at+2,end:at+2},direction:"forward"},`${entry.id}/${mode}: Tab inserts at caret with ${JSON.stringify(ending)}`);
            await engine.evaluate("(() => {window.__indent.undo();return true;})()");
            assert.deepEqual((await state()).selection,{start:at,end:at});assert.equal((await state()).source,source);
          }
          const selected="outside\r\none\ntwo\rthree\r\ntail";
          const start=selected.indexOf('one'),end=selected.indexOf('three')+'three'.length;
          await mount(selected,start,end,true); await engine.sendKeys([{key:"Tab"}]);
          await engine.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
          const indented="outside\r\n  one\n  two\r  three\r\ntail";
          assert.deepEqual(await state(),{source:indented,selection:{start:start+2,end:end+6},direction:"backward"},`${entry.id}/${mode}: selected mixed-ending lines and direction`);
          await engine.evaluate("(() => {window.__indent.undo();return true;})()");
          assert.deepEqual(await state(),{source:selected,selection:{start,end},direction:"backward"});
          await engine.evaluate("(() => {window.__indent.redo();return true;})()");
          assert.equal((await state()).source,indented);assert.equal((await state()).direction,"backward");
          await engine.sendKeys([{key:"Tab",shift:true}]);
          assert.equal((await state()).source,selected);
          const list="- parent\r\n  continuation\n  1. child\r    > quote\r\n- sibling";
          await mount(list,4);await engine.sendKeys([{key:"Tab"}]);
          assert.equal((await state()).source,"  - parent\r\n    continuation\n    1. child\r      > quote\r\n- sibling",`${entry.id}/${mode}: list subtree moves without sibling`);
          assert.deepEqual((await state()).selection,{start:6,end:6});
          await engine.sendKeys([{key:"Tab",shift:true}]);assert.equal((await state()).source,list);
          await engine.evaluate("(() => {window.__indent.undo();window.__indent.undo();return true;})()");
          assert.equal((await state()).source,list);
          const code="before\r```\r    literal\r```\rafter";
          const codeAt=code.indexOf('literal')+3;
          await mount(code,codeAt);await engine.sendKeys([{key:"Tab"}]);
          assert.equal((await state()).source,code.slice(0,codeAt)+"  "+code.slice(codeAt));
          assert.deepEqual((await state()).selection,{start:codeAt+2,end:codeAt+2});
          await engine.sendKeys([{key:"Escape"}]);
          assert.equal(await engine.evaluate("window.__indent.toolbar.contains(document.activeElement)"),true);
        }
        console.log(`indentation: ${entry.id} passed`);
      } finally {await engine.close();}
    }
  } finally {await server.stop();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
