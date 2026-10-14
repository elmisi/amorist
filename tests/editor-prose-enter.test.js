"use strict";
const assert=require("node:assert/strict");
const path=require("node:path");
const {resolveEngines}=require("./qa/lib/engines");
const {startStaticServer}=require("./qa/lib/server");
async function main(){
  const server=await startStaticServer(path.resolve(__dirname,".."));
  const entries=resolveEngines().filter(entry=>entry.applicable);assert.ok(entries.length);
  try{for(const entry of entries){assert.ok(entry.available,entry.reason);const engine=entry.create();
    try{await engine.start();await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
        // WebKit driver completion can precede the final input callback.
        // Wait before reading source; document expectations remain unchanged.
        const sendKeys = async sequence => {
          await engine.sendKeys(sequence);
          await new Promise(resolve => setTimeout(resolve, 60));
        };
      const mount=(source,at)=>engine.evaluate(`(()=>{const host=document.getElementById('host');if(window.__prose)window.__prose.destroy();host.replaceChildren();const editor=window.__prose=window.AmoristEditor.create(host,{value:${JSON.stringify(source)}});editor.focus();editor.setSurfaceSelection(${at},${at});return true})()`);
      const state=()=>engine.evaluate("({source:window.__prose.getMarkdown(),text:window.__prose.surface.textContent.replaceAll(String.fromCharCode(8203),''),boundaries:window.__prose.model.boundaryState().automaticBreaks})");
      for(const ending of ["\n","\r\n","\r"]){
        const source="old"+ending+"alpha omega"+ending+"tail",at=source.indexOf("omega");
        await mount(source,at);await sendKeys([{key:"Enter"}]);
        const expected=source.slice(0,at)+"\\"+ending+source.slice(at),result=await state();
        assert.equal(result.source,expected);assert.equal(result.text,expected.replace(/\\(?=\r\n|\r|\n)/g,"").replace(/\r\n|\r/g,"\n"));
        assert.deepEqual(result.boundaries,[{marker:at,escapes:[]}]);
        await sendKeys([{key:"Backspace"}]);assert.equal((await state()).source,source,`${entry.id}: join removes only generated marker and boundary`);
        await engine.evaluate("(()=>{window.__prose.undo();return true})()");assert.equal((await state()).source,expected);assert.equal((await state()).boundaries.length,1);
        await engine.evaluate(`(()=>{window.__prose.setSurfaceSelection(${at},${at});return true})()`);
        await sendKeys([{key:"Delete"}]);
        assert.equal((await state()).source,source,`${entry.id}: forward Delete joins the generated boundary including the full terminator`);
        assert.equal((await state()).boundaries.length,0);
        await engine.evaluate("(()=>{window.__prose.undo();return true})()");assert.equal((await state()).source,expected);assert.equal((await state()).boundaries.length,1);
        await engine.evaluate("(()=>{window.__prose.undo();return true})()");assert.equal((await state()).source,source);assert.equal((await state()).boundaries.length,0);
      }
      await mount("alpha",5);await sendKeys([{key:"Enter"}]);await engine.evaluate("new Promise(resolve=>requestAnimationFrame(resolve))");await sendKeys([{key:"Enter"}]);
      assert.equal((await state()).source,"alpha\n\n",`${entry.id}: second Enter creates paragraph and removes generated marker`);
      assert.equal((await state()).boundaries.length,0);
      await engine.evaluate("(()=>{window.__prose.undo();return true})()");assert.equal((await state()).source,"alpha\\\n");assert.equal((await state()).boundaries.length,1);
      await mount("literal\\",8);await sendKeys([{key:"Enter"}]);
      assert.equal((await state()).source,"literal"+"\\".repeat(3)+"\n");
      assert.deepEqual((await state()).boundaries,[{marker:9,escapes:[8]}]);
      assert.equal((await state()).text,"literal\\\n");
      await sendKeys([{key:"Backspace"}]);assert.equal((await state()).source,"literal\\",`${entry.id}: literal backslash survives joining`);
      await engine.evaluate("(()=>{window.__prose.undo();window.__prose.setSurfaceSelection(9,9);return true})()");
      await sendKeys([{key:"Delete"}]);assert.equal((await state()).source,"literal\\",`${entry.id}: forward Delete preserves the original literal backslash`);
      const intentional="literal"+"\\".repeat(2)+"\nnext";
      await mount(intentional,9);await sendKeys([{key:"Delete"}]);
      assert.equal((await state()).source,"literal"+"\\".repeat(2)+"next",`${entry.id}: intentional escaping survives a literal forward boundary deletion`);
      const manual="alpha\\\nbeta";await mount(manual,6);await sendKeys([{key:"Enter"}]);
      assert.equal((await state()).source,"alpha\\\n\nbeta",`${entry.id}: manual hard-break marker remains intentional`);
      assert.equal((await state()).boundaries.length,0);
      await mount("alpha beta",5);await sendKeys([{key:"Enter"}]);
      await engine.evaluate("(()=>{const editor=window.__prose;editor.showSourceMode();editor.source.focus();editor.source.setSelectionRange(5,6);return true})()");
      await sendKeys(["\\"]);
      assert.equal((await state()).source,"alpha\\\n beta");
      assert.equal((await state()).boundaries.length,0,`${entry.id}: explicitly retyping an identical source backslash removes automatic ownership`);
      await mount("alpha beta",6);await sendKeys([{key:"Enter"}]);
      await engine.evaluate("(()=>{const editor=window.__prose;editor.restoreRawSelection({start:0,end:editor.model.source.length,direction:'forward'});return true})()");
      await sendKeys([{key:"Tab"}]);
      assert.equal((await state()).source,"  alpha \\\n  beta");
      assert.deepEqual((await state()).boundaries,[{marker:8,escapes:[]}],`${entry.id}: indenting rows preserves generated-boundary ownership`);
      await sendKeys([{key:"Tab"}]);
      assert.equal((await state()).source,"    alpha \n    beta",`${entry.id}: making the whole selection code removes its internal automatic break`);
      assert.equal((await state()).boundaries.length,0);
      await engine.evaluate("(()=>{window.__prose.undo();return true})()");
      assert.equal((await state()).source,"  alpha \\\n  beta");
      assert.deepEqual((await state()).boundaries,[{marker:8,escapes:[]}],`${entry.id}: one undo restores indentation and owned marker`);
      for(const tail of ['# title','- item','> note','```\ncode\n```']) {
        const original='alpha '+tail;await mount(original,6);await sendKeys([{key:'Enter'}]);
        assert.equal((await state()).source,'alpha \n'+tail,`${entry.id}: splitting before a block does not retain a newly generated hard break`);
        assert.equal((await state()).boundaries.length,0);
        await engine.evaluate('(()=>{window.__prose.undo();return true})()');assert.equal((await state()).source,original);
      }
      await mount('alpha beta',6);await sendKeys([{key:'Enter'}]);
      await engine.evaluate("(()=>{const editor=window.__prose;editor.setSurfaceSelection(editor.getMarkdown().indexOf('beta'),editor.getMarkdown().length);editor.handleCopy({clipboardData:{setData(){}},preventDefault(){}},true);return true})()");
      assert.equal((await state()).source,'alpha \n',`${entry.id}: cutting the next row removes its redundant owned boundary`);
      assert.equal((await state()).boundaries.length,0);
      await engine.evaluate('(()=>{window.__prose.undo();return true})()');assert.equal((await state()).source,'alpha \\\nbeta');assert.equal((await state()).boundaries.length,1);
      const mixedOriginal='literal\\\r\n\r\nalpha 😀 beta\rneighbor';await mount(mixedOriginal,mixedOriginal.indexOf('beta'));await sendKeys([{key:'Enter'}]);
      await engine.evaluate("(()=>{const editor=window.__prose,s=editor.getMarkdown();editor.restoreRawSelection({start:s.indexOf('alpha'),end:s.indexOf('beta')+4,direction:'backward'});return true})()");
      await sendKeys([{key:'Tab'},{key:'Tab'}]);
      const mixedExpected='literal\\\r\n\r\n    alpha 😀 \r    beta\rneighbor';
      assert.equal((await state()).source,mixedExpected,`${entry.id}: whole-unit cleanup preserves mixed endings, Unicode and unrelated literal marker`);
      const mixedSelection=await engine.evaluate('({span:window.__prose.selectionRaw(),direction:window.__prose.selectionDirection()})');
      assert.deepEqual(mixedSelection,{span:{start:mixedExpected.indexOf('alpha'),end:mixedExpected.indexOf('beta')+4},direction:'backward'});
      await engine.evaluate('(()=>{window.__prose.undo();return true})()');assert.equal((await state()).source,'literal\\\r\n\r\n  alpha 😀 \\\r  beta\rneighbor');assert.equal((await state()).boundaries.length,1);
      const inline="before `alpha beta` after",codeAt=inline.indexOf("beta");
      for(const shortcut of ["- ","# ","> "]) {
        await mount("alpha",5);await sendKeys([{key:"Enter"}]);
        await sendKeys([shortcut]);
        await engine.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
        assert.equal((await state()).source,"alpha\n"+shortcut,`${entry.id}: structural shortcut removes only the previous generated marker`);
        assert.equal((await state()).boundaries.length,0);
        if(shortcut[0]!=="#") await engine.evaluate("(()=>{window.__prose.undo();return true})()");
        await engine.evaluate("(()=>{window.__prose.undo();return true})()");
        assert.equal((await state()).source,"alpha\\\n"+(shortcut[0]==="#"?"#":""),`${entry.id}: undo restores structural change and marker together`);
        assert.equal((await state()).boundaries.length,1);
      }
      await mount("alpha\\\n",7);await sendKeys(["- "]);
      assert.equal((await state()).source,"alpha\\\n- ",`${entry.id}: an existing manual marker survives structural typing`);
      await mount("alpha",5);await sendKeys([{key:"Enter"}]);
      await sendKeys(["```"]);
      await engine.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      assert.equal((await state()).source,"alpha\n```",`${entry.id}: code-fence creation removes the preceding owned marker`);
      assert.equal((await state()).boundaries.length,0);
      await engine.evaluate("(()=>{window.__prose.undo();return true})()");
      assert.equal((await state()).source,"alpha\\\n``");assert.equal((await state()).boundaries.length,1);
      await mount(inline,codeAt);await sendKeys([{key:"Enter"}]);
      assert.equal((await state()).source,inline.slice(0,codeAt)+"\n"+inline.slice(codeAt),`${entry.id}: inline code Enter stays literal`);
      assert.equal((await state()).boundaries.length,0);
      const source="old\r\nalpha omega";await mount(source,source.indexOf("omega"));
      await engine.evaluate("(()=>{const editor=window.__prose;editor.showSourceMode();editor.source.focus();editor.source.setSelectionRange(10,10);return true})()");
      await sendKeys([{key:"Enter"}]);assert.equal((await state()).source,"old\r\nalpha \r\nomega");assert.equal((await state()).boundaries.length,0);
      console.log(`prose-enter: ${entry.id} passed`);
    }finally{await engine.close();}
  }}finally{await server.stop();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
