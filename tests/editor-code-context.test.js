"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveEngines } = require("./qa/lib/engines");
const { startStaticServer } = require("./qa/lib/server");

async function main() {
  const entries = resolveEngines().filter((entry) => entry.applicable);
  assert.ok(entries.length, "No applicable engine declared for this platform");
  const server = await startStaticServer(path.resolve(__dirname, ".."));
  const original = "before\r\n````js\r\n# literal heading\r\n1. literal number\r\n- [x] task\r\n> quote\r\n\r\n```\r\nend\r\n````\r\nafter";
  try {
    for (const entry of entries) {
      assert.ok(entry.available, entry.reason);
      const engine = entry.create();
      try {
        await engine.start();
        await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);
        const opening = await engine.evaluate(`(() => {
          const host = document.getElementById("host");
          const editor = window.__codeRegression = window.AmoristEditor.create(host, {value: ${JSON.stringify(original)}});
          const rows = Array.from(host.querySelectorAll(".amorist-source-line"));
          return { source: editor.getMarkdown(),
            codeRows: rows.filter(row => row.classList.contains("amorist-wysiwyg-code")).map(row => ({
              text: row.textContent, prefix: row.dataset.prefix,
              classes: row.className, height: row.getBoundingClientRect().height })),
            fences: rows.filter(row => row.classList.contains("amorist-wysiwyg-fence")).map(row => row.getBoundingClientRect().height) };
        })()`);
        assert.equal(opening.source, original);
        assert.equal(opening.codeRows.length, 7, `${entry.id}: every physical code content line remains`);
        for (const row of opening.codeRows) {
          assert.equal(row.prefix, "0");
          assert.doesNotMatch(row.classes, /wysiwyg-(h[1-6]|list|quote|task|fence)/);
        }
        assert.equal(opening.fences.length, 2);
        assert.ok(opening.fences.every(height => height === 0), `${entry.id}: hidden fences add no height`);
        assert.ok(opening.codeRows[4].height > 0, `${entry.id}: original blank code line is visible`);

        const at = original.indexOf("# literal heading");
        await engine.evaluate(`(() => { window.__codeRegression.focus(); window.__codeRegression.setSurfaceSelection(${at}, ${at}); return true; })()`);
        await engine.sendKeys([{ key: "Backspace" }]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original.slice(0, at - 2) + original.slice(at), `${entry.id}: code Backspace joins physical lines without stripping markers`);
        await engine.evaluate("(() => { window.__codeRegression.undo(); return true; })()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original);

        const end = at + "# literal heading".length;
        await engine.evaluate(`(() => { window.__codeRegression.focus(); window.__codeRegression.setSurfaceSelection(${end}, ${end}); return true; })()`);
        await engine.sendKeys([{ key: "Enter" }]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original.slice(0, end) + "\r\n" + original.slice(end));
        await engine.evaluate("(() => { window.__codeRegression.undo(); window.__codeRegression.showSourceMode(); window.__codeRegression.showWysiwygMode(); return true; })()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), original);
        for (const [body, fence] of [
          ["alpha```middle``````omega", "```````"],
          ["alpha~~~~~omega", "``````"],
          ["```\n# original literal\n```", "````"],
        ]) {
          const source = "before\r\n" + body.replace(/\n/g, "\r\n") + "\r\nafter";
          const wrapped = await engine.evaluate(`(() => {
            const editor = window.__codeRegression;
            editor.setMarkdown(${JSON.stringify(source)});
            editor.showSourceMode();
            editor.source.setSelectionRange(7, 7 + ${JSON.stringify(body)}.length);
            editor.toolbar.querySelector('[data-action="codeblock"]').click();
            return editor.getMarkdown();
          })()`);
          assert.equal(wrapped, "before\r\n" + fence + "\r\n" + body.replace(/\n/g, "\r\n") + "\r\n" + fence + "\r\nafter",
            `${entry.id}: safe generated fence preserves selected content and external bytes`);
          await engine.evaluate("(() => { window.__codeRegression.undo(); return true; })()");
          assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), source);
        }
        const converted = await engine.evaluate(`window.AmoristInternals.HtmlToMarkdown.convert(
          "<pre><code>first  \\n\\n\\n&#96;&#96;&#96;nested&#96;&#96;&#96;\\nlast\\t\\n</code></pre>")`);
        assert.equal(converted, "````\nfirst  \n\n\n```nested```\nlast\t\n````",
          `${entry.id}: HTML PRE keeps whitespace and uses safe fences`);
        const identical = "```\nfirst\n```\n# outside\n```\nlast\n```";
        const interpretation = await engine.evaluate(`(() => {
          const editor = window.__codeRegression;
          editor.setMarkdown(${JSON.stringify(identical)});
          return { source: editor.getMarkdown(),
            blocks: editor.surface.querySelectorAll(".amorist-wysiwyg-code-block").length,
            heading: editor.surface.querySelector(".amorist-wysiwyg-h1").textContent.trim() };
        })()`);
        assert.deepEqual(interpretation, { source: identical, blocks: 2, heading: "outside" },
          `${entry.id}: an identical delimiter closes existing code; opening never rewrites it`);
        const table = "before\r\n| Left | Right |\r\n| --- | --- |\r\n| `a|b` | c\\|d |\r\nafter";
        const cells = await engine.evaluate(`(() => {
          const editor = window.__codeRegression; editor.setMarkdown(${JSON.stringify(table)});
          const row = editor.surface.querySelectorAll('.amorist-wysiwyg-table')[2];
          return {source:editor.getMarkdown(),cells:row.querySelectorAll('.amorist-wysiwyg-table-cell').length,
            code:row.querySelector('code').textContent};
        })()`);
        assert.deepEqual(cells, {source:table,cells:4,code:"a|b"},
          `${entry.id}: code and escaped pipes stay inside their cells`);
        const codeAt = table.indexOf("a|b") + 2;
        await engine.evaluate(`(() => {window.__codeRegression.focus();window.__codeRegression.setSurfaceSelection(${codeAt},${codeAt});return true;})()`);
        await engine.sendKeys(["x"]);
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"), table.slice(0,codeAt)+"x"+table.slice(codeAt),
          `${entry.id}: editing code in a table preserves surrounding delimiters and bytes`);
        await engine.evaluate("(() => {window.__codeRegression.undo();window.__codeRegression.showSourceMode();window.__codeRegression.showWysiwygMode();return true;})()");
        assert.equal(await engine.evaluate("window.__codeRegression.getMarkdown()"),table);
        console.log(`code-context: ${entry.id} passed`);
      } finally { await engine.close(); }
    }
  } finally { await server.stop(); }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
