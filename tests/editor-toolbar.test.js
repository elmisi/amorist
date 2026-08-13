"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const { ChromiumEngine } = require("./qa/lib/engine-chromium");
const { startStaticServer } = require("./qa/lib/server");

async function evaluate(engine, expression) {
  return engine.evaluate(expression);
}

async function main() {
  const discovered = ChromiumEngine.discover();
  assert.ok(discovered.available, discovered.reason);
  const server = await startStaticServer(path.resolve(__dirname, ".."));
  const engine = new ChromiumEngine(discovered.binary);
  try {
    await engine.start();
    await engine.navigate(`${server.origin}/tests/qa/page/harness.html`);

    const link = await evaluate(engine, `(() => {
      window.__qa.open("alpha bravo");
      window.__qa.selectTextRange(0, 5);
      window.prompt = () => "https://example.test/a)";
      window.__qa.toolbarAction("link");
      return window.__qa.markdown();
    })()`);
    assert.equal(link, "[alpha](https://example.test/a%29) bravo");

    const codeBlock = await evaluate(engine, `(() => {
      window.__qa.open("first\\nalpha bravo\\nlast");
      window.__qa.selectTextRange(6, 11);
      window.__qa.toolbarAction("codeblock");
      return window.__qa.markdown();
    })()`);
    assert.equal(codeBlock, "first\n```\nalpha bravo\n```\nlast");

    for (const [action, markdown] of [
      ["h1", "# alpha"],
      ["bullet", "- alpha"],
      ["quote", "> alpha"],
    ]) {
      const toggled = await evaluate(engine, `(() => {
        window.__qa.open(${JSON.stringify(markdown)});
        window.__qa.setCaretAtTextOffset(2);
        window.__qa.toolbarAction(${JSON.stringify(action)});
        return window.__qa.markdown();
      })()`);
      assert.equal(toggled, "alpha", `${action} toggles its own source marker`);
    }

    await evaluate(engine, `(() => {
      window.__qa.open("  - alpha");
      window.__qa.setCaretAtTextOffset(2);
      return true;
    })()`);
    await engine.sendKeys([{ key: "Tab", shift: true }]);
    assert.equal(await evaluate(engine, "window.__qa.markdown()"), "- alpha", "Shift+Tab removes one local indent");

    const find = await evaluate(engine, `(() => {
      window.__qa.open("alpha beta alpha");
      const surface = document.querySelector(".amorist-editor-surface");
      surface.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
      const bar = document.querySelector(".amorist-editor-findbar");
      const input = document.querySelector(".amorist-editor-findbar-input");
      const opened = !bar.hidden;
      input.value = "alpha";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      const selected = window.getSelection().toString();
      const count = document.querySelector(".amorist-editor-findbar-count").textContent;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return { opened, selected, count, closed: bar.hidden };
    })()`);
    assert.deepEqual(find, { opened: true, selected: "alpha", count: "2 of 2", closed: true });

    await evaluate(engine, `(() => {
      window.__qa.open("alpha bravo");
      window.__qa.setCaretAtTextOffset(3);
      window.__qa.toolbarAction("bold");
      return true;
    })()`);
    await engine.sendKeys(["X"]);
    assert.equal(await evaluate(engine, "window.__qa.markdown()"), "alp**X**ha bravo");
    await evaluate(engine, "window.__qa.toolbarAction('bold')");
    await engine.sendKeys(["Y"]);
    assert.equal(await evaluate(engine, "window.__qa.markdown()"), "alp**X**Yha bravo");

    const richMarkdown = "```\n**literal**\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---";
    const richProjection = await evaluate(engine, `(() => {
      window.__qa.open(${JSON.stringify(richMarkdown)});
      const code = document.querySelector(".amorist-wysiwyg-code");
      const tableRows = document.querySelectorAll(".amorist-wysiwyg-table").length;
      const rule = document.querySelector(".amorist-wysiwyg-rule");
      return {
        codeText: code && code.textContent.trim(),
        codeHasStrong: Boolean(code && code.querySelector("strong")),
        tableRows,
        ruleBorder: rule && getComputedStyle(rule).borderTopWidth,
      };
    })()`);
    assert.deepEqual(richProjection, { codeText: "**literal**", codeHasStrong: false, tableRows: 3, ruleBorder: "1px" });

    const multiLineSource = "before\r\none\rtwo\nthree\r\nafter";
    const multiLine = await evaluate(engine, `(() => {
      const source = ${JSON.stringify(multiLineSource)};
      const selectMiddle = () => {
        const view = window.__qa.surfaceText();
        const start = view.indexOf("one") + 1;
        const end = view.indexOf("three") + "three".length;
        window.__qa.selectTextRange(start, end);
      };
      window.__qa.open(source); selectMiddle(); window.__qa.toolbarAction("quote");
      const quoted = window.__qa.markdown();
      window.__qa.open(quoted); selectMiddle(); window.__qa.toolbarAction("quote");
      const unquoted = window.__qa.markdown();
      window.__qa.open(source); selectMiddle(); window.__qa.toolbarAction("h2");
      const heading = window.__qa.markdown();
      window.__qa.open(source); selectMiddle(); window.__qa.toolbarAction("codeblock");
      const codeBlock = window.__qa.markdown();
      return { quoted, unquoted, heading, codeBlock };
    })()`);
    assert.deepEqual(multiLine, {
      quoted: "before\r\n> one\r> two\n> three\r\nafter",
      unquoted: multiLineSource,
      heading: "before\r\n## one\r## two\n## three\r\nafter",
      codeBlock: "before\r\n```\rone\rtwo\nthree\r```\r\nafter",
    });
  } finally {
    await engine.close();
    await server.stop();
  }
}

main().then(
  () => console.log("editor-toolbar: link and code block actions passed"),
  (error) => { console.error(error.stack || error); process.exitCode = 1; },
);
