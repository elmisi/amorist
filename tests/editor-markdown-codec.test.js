const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadClassicScript(path, window = {}) {
  const context = vm.createContext({ window, console, Intl });
  vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
  return context.window;
}

function loadMarkdownCodec() {
  const window = loadClassicScript("web/editor/amorist-text-utils.js");
  loadClassicScript("web/editor/amorist-table-codec.js", window);
  loadClassicScript("web/editor/amorist-markdown-codec.js", window);
  return window.AmoristInternals.MarkdownCodec;
}

const codec = loadMarkdownCodec();

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("# Title"))), [
  { type: "heading", level: 1, text: "Title", sourceLine: 0 },
]);

assert.equal(
  codec.renderMarkdown("# Title\n\nParagraph with **bold**, *em*, `code`, and [link](https://example.com)."),
  '<h1 data-source-line="0">Title</h1><p data-source-line="2">Paragraph with <strong>bold</strong>, <em>em</em>, <code>code</code>, and <a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>.</p>',
);

assert.equal(
  codec.renderMarkdown("> Quote\n> text"),
  '<blockquote data-source-line="0">Quote text</blockquote>',
);

assert.equal(
  codec.renderMarkdown("- One\n- Two"),
  '<ul data-source-line="0"><li>One</li><li>Two</li></ul>',
);

assert.equal(
  codec.renderMarkdown("1. One\n2. Two"),
  '<ol data-source-line="0"><li>One</li><li>Two</li></ol>',
);

assert.equal(
  codec.renderMarkdown("- [ ] Todo\n- [x] Done"),
  '<ul class="amorist-task-list" data-source-line="0"><li class="amorist-task-item" data-checked="false"><span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">Todo</span></li><li class="amorist-task-item" data-checked="true"><span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content">Done</span></li></ul>',
);

assert.equal(
  codec.renderMarkdown("```\nconst value = 1;\n```"),
  '<pre data-source-line="0"><code>const value = 1;</code></pre>',
);

assert.equal(
  codec.renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |"),
  '<pre class="amorist-markdown-table" data-block-type="table" data-source-line="0"><code>| A   | B   |\n| --- | --- |\n| 1   | 2   |</code></pre>',
);

assert.equal(codec.renderInline(""), "<br>");
assert.equal(codec.renderInline("x < y & z"), "x &lt; y &amp; z");

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("#### Sub-heading"))), [
  { type: "heading", level: 4, text: "Sub-heading", sourceLine: 0 },
]);

assert.equal(
  codec.renderMarkdown("#### H4\n\n##### H5\n\n###### H6"),
  '<h4 data-source-line="0">H4</h4><h5 data-source-line="2">H5</h5><h6 data-source-line="4">H6</h6>',
);

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("---"))), [
  { type: "hr", sourceLine: 0 },
]);

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("***"))), [
  { type: "hr", sourceLine: 0 },
]);

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("___"))), [
  { type: "hr", sourceLine: 0 },
]);

assert.ok(codec.renderMarkdown("---").includes("<hr"));
assert.ok(codec.renderMarkdown("***").includes("<hr"));
assert.ok(codec.renderMarkdown("___").includes("<hr"));

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("- a\n- b\n- c"))), [
  { type: "bulletList", items: ["a", "b", "c"], sourceLine: 0 },
]);

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("1. a\n2. b\n3. c"))), [
  { type: "orderedList", items: ["a", "b", "c"], sourceLine: 0 },
]);

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("- [ ] a\n- [x] b"))), [
  { type: "taskList", items: [{ checked: false, text: "a" }, { checked: true, text: "b" }], sourceLine: 0 },
]);

// Regression: any inline construct nested inside another (the reported case was
// bold wrapping inline-code) must render its inner content, not collapse to the
// token-placeholder index (previously serialized as `**0**`). The corruption was
// general to nesting: the inner placeholder leaked into the HTML and the browser
// silently dropped it, leaving a bare digit. Cover the whole nesting matrix.
assert.equal(
  codec.renderMarkdown("**`PROVA1`**"),
  '<p data-source-line="0"><strong><code>PROVA1</code></strong></p>',
);
assert.equal(
  codec.renderMarkdown("prefix **`PROVA2`** suffix"),
  '<p data-source-line="0">prefix <strong><code>PROVA2</code></strong> suffix</p>',
);
assert.equal(
  codec.renderMarkdown("- voce **`PROVA6`** nella lista"),
  '<ul data-source-line="0"><li>voce <strong><code>PROVA6</code></strong> nella lista</li></ul>',
);
assert.equal(
  codec.renderMarkdown("*`em-code`*"),
  '<p data-source-line="0"><em><code>em-code</code></em></p>',
);
assert.equal(
  codec.renderMarkdown("[`link-code`](http://x)"),
  '<p data-source-line="0"><a href="http://x" target="_blank" rel="noopener noreferrer"><code>link-code</code></a></p>',
);
assert.equal(
  codec.renderMarkdown("**[`triple`](http://x)**"),
  '<p data-source-line="0"><strong><a href="http://x" target="_blank" rel="noopener noreferrer"><code>triple</code></a></strong></p>',
);
// No inline placeholder may survive into rendered HTML, whatever the sentinel is.
const PLACEHOLDER_MARK = String.fromCodePoint(0xe000);
assert.ok(!codec.renderMarkdown("**`a`** and *`b`* and [`c`](http://x)").includes(PLACEHOLDER_MARK));

const fixture = fs.readFileSync("tests/fixtures/editor-roundtrip.md", "utf8");
const blocks = codec.parseBlocks(fixture);
assert.deepEqual(
  Array.from(blocks, (block) => block.type),
  ["heading", "paragraph", "quote", "bulletList", "orderedList", "taskList", "hr", "code", "table"],
);

console.log("editor-markdown-codec.test.js passed");
