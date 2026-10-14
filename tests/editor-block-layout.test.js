"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveEngines } = require("./qa/lib/engines");
const { startStaticServer } = require("./qa/lib/server");

async function main() {
  const server = await startStaticServer(path.resolve(__dirname, ".."));
  const words = "long content which wraps onto several visual lines while keeping its left edge aligned";
  const original = `12. ${words}\r\n    continuation of the same item\r\n- ${words}\r\n- [x] ${words}\r\n> first quotation line\r\n> second quotation line\r\n> > nested quotation\r\n\r\nuntouched tail`;
  try {
    for (const entry of resolveEngines().filter(entry => entry.applicable)) {
      assert.ok(entry.available, entry.reason);
      const engine = entry.create();
      try {
        await engine.start();
        await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
        // WebKit driver completion can precede the final input callback.
        // Wait before reading source; document expectations remain unchanged.
        const sendKeys = async sequence => {
          await engine.sendKeys(sequence);
          await new Promise(resolve => setTimeout(resolve, 60));
        };
        const geometry = await engine.evaluate(`(() => {
          document.documentElement.style.setProperty('--qa-width', '260px');
          const editor = window.__blocks = window.AmoristEditor.create(document.getElementById('host'), {value:${JSON.stringify(original)}});
          const rows = Array.from(editor.surface.querySelectorAll('.amorist-source-line'));
          const boxes = rows.map(row => {
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            const lines = new Map();
            let node;
            while ((node = walker.nextNode())) {
              for (let i = 0; i < node.length; i++) {
                if (node.data.charCodeAt(i) === 10) continue;
                const range = document.createRange(); range.setStart(node,i); range.setEnd(node,i+1);
                // WebKit may include the preceding line-end rectangle at a wrap.
                // The final fragment contains the selected character itself.
                const rect = Array.from(range.getClientRects()).at(-1);
                if (!rect) continue;
                const key = Array.from(lines.keys()).find(top => Math.abs(top - rect.top) < 4) ?? rect.top;
                if (rect.width > 0) lines.set(key, Math.min(lines.get(key) ?? Infinity, rect.left));
              }
            }
            const rect = row.getBoundingClientRect();
            return {lefts:Array.from(lines.values()),top:rect.top,bottom:rect.bottom,prefix:row.dataset.prefix};
          });
          return {source:editor.getMarkdown(),boxes};
        })()`);
        assert.equal(geometry.source, original);
        for (const index of [0, 2, 3]) {
          const lefts = geometry.boxes[index].lefts;
          assert.ok(lefts.length >= 3, `${entry.id}: item ${index} actually wraps`);
          assert.ok(lefts.every(left => Math.abs(left-lefts[0]) < 1), `${entry.id}: item ${index} hanging indent: ${lefts}`);
        }
        assert.ok(Math.abs(geometry.boxes[0].lefts[0]-geometry.boxes[1].lefts[0]) < 1,
          `${entry.id}: physical continuation aligns with its owner`);
        assert.ok(Math.abs(geometry.boxes[4].bottom-geometry.boxes[5].top) < 1,
          `${entry.id}: adjacent quote bars join`);
        assert.equal(geometry.boxes[6].prefix, "4");
        await engine.evaluate(`(() => {
          window.__tail = window.__blocks.surface.querySelectorAll('.amorist-source-line')[8];
          window.__blocks.focus(); window.__blocks.setSurfaceSelection(4,4); return true;
        })()`);
        await sendKeys([{key:"Backspace"}]);
        assert.equal(await engine.evaluate("window.__blocks.getMarkdown()"), original.slice(4),
          `${entry.id}: Backspace removes only the owning item's marker`);
        const ownership = await engine.evaluate(`(() => {
          const rows = window.__blocks.surface.querySelectorAll('.amorist-source-line');
          return {tailSame: rows[8] === window.__tail, continuation: rows[1].classList.contains('amorist-wysiwyg-list-continuation')};
        })()`);
        assert.deepEqual(ownership, {tailSame:true, continuation:false},
          `${entry.id}: structural edit updates continuation ownership and preserves unrelated DOM`);
        await engine.evaluate("(() => { window.__blocks.undo(); return true; })()");
        assert.equal(await engine.evaluate("window.__blocks.getMarkdown()"), original);
        const at = original.indexOf("continuation") + "continuation".length;
        await engine.evaluate(`(() => { window.__blocks.focus(); window.__blocks.setSurfaceSelection(${at},${at}); return true; })()`);
        await sendKeys([{key:"Enter"}]);
        assert.equal(await engine.evaluate("window.__blocks.getMarkdown()"), original.slice(0,at)+"\r\n    "+original.slice(at), `${entry.id}: continuation Enter retains indentation`);
        await engine.evaluate("(() => { window.__blocks.undo(); return true; })()");
        assert.equal(await engine.evaluate("window.__blocks.getMarkdown()"), original);
        const taskContinuation = "- [x] task\n  task continuation\n\t- nested\n\t  nested continuation";
        const nested = await engine.evaluate(`(() => {
          const editor = window.__blocks; editor.setMarkdown(${JSON.stringify(taskContinuation)});
          const rows = Array.from(editor.surface.querySelectorAll('.amorist-source-line'));
          return {source:editor.getMarkdown(),continuations:rows.map(row => row.classList.contains('amorist-wysiwyg-list-continuation')),
            padding:rows.map(row => getComputedStyle(row).paddingLeft)};
        })()`);
        assert.equal(nested.source, taskContinuation);
        assert.deepEqual(nested.continuations, [false,true,false,true], `${entry.id}: tasks and tab-indented nested owners`);
        assert.equal(nested.padding[0], nested.padding[1]);
        assert.equal(nested.padding[2], nested.padding[3]);
        await engine.evaluate(`(() => { window.__blocks.setMarkdown(${JSON.stringify(original)}); return true; })()`);
        const end = original.indexOf("nested quotation") + "nested quotation".length;
        await engine.evaluate(`(() => { window.__blocks.focus(); window.__blocks.setSurfaceSelection(${end},${end}); return true; })()`);
        await sendKeys([{key:"Enter"}]);
        assert.equal(await engine.evaluate("window.__blocks.getMarkdown()"), original.slice(0,end)+"\r\n> > "+original.slice(end), `${entry.id}: nested quote Enter retains depth`);
        await engine.evaluate("(() => { window.__blocks.undo(); window.__blocks.showSourceMode(); window.__blocks.showWysiwygMode(); return true; })()");
        assert.equal(await engine.evaluate("window.__blocks.getMarkdown()"), original);

        const referenceSource = '[Read][STRASSE] and [Straße][]\r\n\r\n| Link | Note |\r\n| --- | --- |\r\n| [Straße] | stable |\r\n\r\n[Straße]: old.md "Title"\r\n[Straße]: ignored.md\r\n\r\nuntouched tail';
        const references = await engine.evaluate(`(() => {
          const editor = window.__blocks;
          editor.setMarkdown(${JSON.stringify(referenceSource)});
          const rows = editor.surface.querySelectorAll('.amorist-source-line');
          window.__referenceTail = rows[9];
          return {source: editor.getMarkdown(), links: Array.from(editor.surface.querySelectorAll('a')).map(a => a.dataset.linkDestination),
            definition: rows[6].textContent};
        })()`);
        assert.equal(references.source, referenceSource);
        assert.deepEqual(references.links, ['old.md', 'old.md', 'old.md']);
        assert.equal(references.definition, '[Straße]: old.md "Title"\n');
        const destinationAt = referenceSource.indexOf('old.md');
        await engine.evaluate(`(() => { const editor = window.__blocks; editor.focus(); editor.setSurfaceSelection(${destinationAt}, ${destinationAt + 3}); return true; })()`);
        await sendKeys(['n']);
        // WebKit's sendKeys completion can precede its final input callback.
        await new Promise(resolve => setTimeout(resolve, 60));
        const changed = await engine.evaluate(`(() => {
          const editor = window.__blocks;
          return {source: editor.getMarkdown(), links: Array.from(editor.surface.querySelectorAll('a')).map(a => a.dataset.linkDestination),
            tailSame: editor.surface.querySelectorAll('.amorist-source-line')[9] === window.__referenceTail};
        })()`);
        assert.equal(changed.source, referenceSource.replace('old.md', 'n.md'));
        assert.deepEqual(changed.links, ['n.md', 'n.md', 'n.md']);
        assert.equal(changed.tailSame, true, `${entry.id}: definition edit preserves unrelated DOM`);
        await engine.evaluate('(() => { window.__blocks.undo(); return true; })()');
        assert.equal(await engine.evaluate('window.__blocks.getMarkdown()'), referenceSource);
        assert.deepEqual(await engine.evaluate("Array.from(window.__blocks.surface.querySelectorAll('a')).map(a => a.dataset.linkDestination)"), ['old.md', 'old.md', 'old.md']);
        const metadataSource = '[Name]:\r\n  <docs/λ.md>\r\n  "first\r\nsecond"\r\n\r\n[Name]\r\n\r\nordinary paragraph\r\n[Hidden]: hidden.md\r\n\r\n[Hidden]\r\n\r\n~~~\r\n[Code]: code.md\r\n~~~\r\n[Code]';
        const metadata = await engine.evaluate(`(() => {
          const editor = window.__blocks;
          const source = ${JSON.stringify(metadataSource)};
          editor.setMarkdown(source);
          const result = {source: editor.getMarkdown(), definitions: editor.lineDescriptors.filter(d => d.projection.referenceDefinition).length,
            links: Array.from(editor.surface.querySelectorAll('a')).map(a => ({href:a.dataset.linkDestination, title:a.getAttribute('title')}))};
          editor.showSourceMode(); editor.showWysiwygMode();
          result.roundtrip = editor.getMarkdown();
          return result;
        })()`);
        assert.equal(metadata.definitions, 4);
        assert.deepEqual(metadata.links, [{href:'docs/λ.md',title:'first\r\nsecond'}]);
        assert.equal(metadata.roundtrip, metadata.source);
        for(const [marker,indent] of [['- ','  '],['123. ','     ']]) {
          const source=marker+'parent\r\n'+indent+'> note λ\r\n'+indent+'> next\r\n'+indent+'continuation\r\n- sibling';
          const mixed=await engine.evaluate(`(() => {const editor=window.__blocks;editor.setMarkdown(${JSON.stringify(source)});return {source:editor.getMarkdown(),owners:editor.lineDescriptors.map(row=>row.listOwner?.index??null),quotes:editor.surface.querySelectorAll('.amorist-wysiwyg-quote').length,continuation:editor.lineDescriptors[3].projection.listContinuation};})()`);
          assert.equal(mixed.source,source);assert.deepEqual(mixed.owners,[0,0,0,0,4],`${entry.id}: quote container retains owning list item`);assert.equal(mixed.quotes,2);assert.equal(mixed.continuation,true);
          const at=source.indexOf('note λ')+5;
          await engine.evaluate(`(() => {const editor=window.__blocks;editor.focus();editor.setSurfaceSelection(${at},${at});return true;})()`);await sendKeys(['X']);
          assert.equal(await engine.evaluate('window.__blocks.getMarkdown()'),source.slice(0,at)+'X'+source.slice(at));
          await engine.evaluate('(() => {const editor=window.__blocks;editor.undo();editor.showSourceMode();editor.showWysiwygMode();return true;})()');assert.equal(await engine.evaluate('window.__blocks.getMarkdown()'),source);
          const end=source.indexOf('note λ')+'note λ'.length;
          await engine.evaluate(`(() => {const editor=window.__blocks;editor.focus();editor.setSurfaceSelection(${end},${end});return true;})()`);await sendKeys([{key:'Enter'}]);
          assert.equal(await engine.evaluate('window.__blocks.getMarkdown()'),source.slice(0,end)+'\r\n'+indent+'> '+source.slice(end),`${entry.id}: Enter retains nested quote container`);
          await engine.evaluate('(() => {window.__blocks.undo();return true;})()');assert.equal(await engine.evaluate('window.__blocks.getMarkdown()'),source);
        }
        console.log(`block-layout: ${entry.id} passed`);
      } finally { await engine.close(); }
    }
  } finally { await server.stop(); }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
