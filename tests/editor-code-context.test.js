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
        console.log(`code-context: ${entry.id} passed`);
      } finally { await engine.close(); }
    }
  } finally { await server.stop(); }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
