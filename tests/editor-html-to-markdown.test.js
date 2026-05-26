const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadModule() {
  const window = { AmoristInternals: { MarkdownCodec: { serializeBlocks: () => "" } } };
  const context = vm.createContext({ window, console });
  vm.runInContext(fs.readFileSync("web/editor/amorist-html-to-markdown.js", "utf8"), context, {
    filename: "amorist-html-to-markdown.js",
  });
  return window.AmoristInternals.HtmlToMarkdown;
}

const H = loadModule();

assert.equal(H._isStripped("SCRIPT"), true);
assert.equal(H._isStripped("STYLE"), true);
assert.equal(H._isStripped("P"), false);
assert.equal(H._isUnwrapped("SPAN"), true);
assert.equal(H._isUnwrapped("FONT"), true);
assert.equal(H._isUnwrapped("STRONG"), false);

assert.equal(H._cleanupMarkdown("a\n\n\n\nb\n\n"), "a\n\nb");
assert.equal(H._cleanupMarkdown("   \n\nhi  "), "hi");

console.log("html-to-markdown pure helpers OK");
