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

// Two trailing spaces are a hard line break, not stray whitespace: stripping
// them would destroy every <br> on the paste path, the one route where pasted
// HTML turns into Markdown.
assert.equal(H._cleanupMarkdown("a  \nb"), "a  \nb");
assert.equal(H._cleanupMarkdown("a   \nb"), "a  \nb");
// A single trailing space carries no meaning, so it is still noise.
assert.equal(H._cleanupMarkdown("a \nb"), "a\nb");
assert.equal(H._cleanupMarkdown("a\t\nb"), "a\nb");
// Whitespace-only lines are blank lines, not breaks.
assert.equal(H._cleanupMarkdown("a\n  \nb"), "a\n\nb");

console.log("html-to-markdown pure helpers OK");
