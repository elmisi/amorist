const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Minimal DOM stand-in for the serializer tests. serializeBlocks/inlineMarkdown
// only read tagName, nodeType, childNodes, children, textContent, classList,
// dataset, getAttribute and querySelector — nothing else is shimmed.
const Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

function textNode(value) {
  return { nodeType: Node.TEXT_NODE, textContent: value, childNodes: [] };
}

function element(tagName, childNodes = [], { className = "", dataset = {}, href = "" } = {}) {
  const classes = className.split(" ").filter(Boolean);
  return {
    nodeType: Node.ELEMENT_NODE,
    tagName,
    childNodes,
    dataset,
    className,
    classList: { contains: (name) => classes.includes(name) },
    getAttribute: (name) => (name === "href" ? href : ""),
    get children() {
      return this.childNodes.filter((child) => child.nodeType === Node.ELEMENT_NODE);
    },
    get firstElementChild() {
      return this.children[0];
    },
    get textContent() {
      return this.childNodes.map((child) => child.textContent).join("");
    },
    querySelector(selector) {
      const wanted = selector.replace(/^\./, "");
      for (const child of this.children) {
        if (child.classList.contains(wanted)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
  };
}

function loadClassicScript(path, window = {}) {
  const context = vm.createContext({ window, console, Intl, Node });
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
  {
    type: "bulletList",
    items: [
      { text: "a", children: [] },
      { text: "b", children: [] },
      { text: "c", children: [] },
    ],
    sourceLine: 0,
  },
]);

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("1. a\n2. b\n3. c"))), [
  {
    type: "orderedList",
    items: [
      { text: "a", children: [] },
      { text: "b", children: [] },
      { text: "c", children: [] },
    ],
    sourceLine: 0,
  },
]);

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("- [ ] a\n- [x] b"))), [
  {
    type: "taskList",
    items: [
      { checked: false, text: "a", children: [] },
      { checked: true, text: "b", children: [] },
    ],
    sourceLine: 0,
  },
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

// Nested lists. The reported bug: an indented ordered list under a bullet item
// matched no list pattern (every list regex was anchored at column 0), so it
// fell through to the paragraph branch, which joins its lines with a space —
// rendering "1. ... 2. ... 3. ..." on a single line.
const nestedSource = "- intro\n  1. one\n  2. two";

assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks(nestedSource))), [
  {
    type: "bulletList",
    sourceLine: 0,
    items: [
      {
        text: "intro",
        children: [
          {
            type: "orderedList",
            sourceLine: 1,
            items: [
              { text: "one", children: [] },
              { text: "two", children: [] },
            ],
          },
        ],
      },
    ],
  },
]);

assert.equal(
  codec.renderMarkdown(nestedSource),
  '<ul data-source-line="0"><li>intro<ol data-source-line="1"><li>one</li><li>two</li></ol></li></ul>',
);

// A bullet nested under an ordered item, and three levels deep.
assert.deepEqual(
  Array.from(codec.parseBlocks("1. outer\n   - inner\n     - deepest"), (block) => block.type),
  ["orderedList"],
);
assert.equal(
  codec.renderMarkdown("1. outer\n   - inner\n     - deepest"),
  '<ol data-source-line="0"><li>outer<ul data-source-line="1"><li>inner<ul data-source-line="2"><li>deepest</li></ul></li></ul></li></ol>',
);

// A nested list must not swallow the items that follow it at the outer level.
assert.deepEqual(JSON.parse(JSON.stringify(codec.parseBlocks("- a\n  - inner\n- b"))), [
  {
    type: "bulletList",
    sourceLine: 0,
    items: [
      {
        text: "a",
        children: [
          { type: "bulletList", sourceLine: 1, items: [{ text: "inner", children: [] }] },
        ],
      },
      { text: "b", children: [] },
    ],
  },
]);

// An indented list line must no longer be absorbed into a preceding paragraph.
assert.deepEqual(
  Array.from(codec.parseBlocks("Intro paragraph\n\n  1. one\n  2. two"), (block) => block.type),
  ["paragraph", "orderedList"],
);

// Serializer: the WYSIWYG surface round-trips nesting back to indented Markdown.
// Without this, Markdown being the source of truth means every mode switch or
// save would flatten a nested list back into one run-on line.
const nestedSurface = {
  children: [
    element("UL", [
      element("LI", [
        textNode("intro"),
        element("OL", [
          element("LI", [textNode("one")]),
          element("LI", [textNode("two")]),
        ]),
      ]),
    ]),
  ],
};
assert.equal(codec.serializeBlocks(nestedSurface), "- intro\n  1. one\n  2. two");

// Ordered markers are wider than bullets, so children indent to the content
// column ("1. " → 3 spaces) and stay nested when re-parsed.
const orderedParentSurface = {
  children: [
    element("OL", [
      element("LI", [
        textNode("outer"),
        element("UL", [element("LI", [textNode("inner")])]),
      ]),
    ]),
  ],
};
assert.equal(codec.serializeBlocks(orderedParentSurface), "1. outer\n   - inner");
assert.deepEqual(
  JSON.parse(JSON.stringify(codec.parseBlocks(codec.serializeBlocks(orderedParentSurface)))),
  JSON.parse(JSON.stringify(codec.parseBlocks("1. outer\n   - inner"))),
);

// A flat list still serializes as before, and nesting survives a task list.
assert.equal(
  codec.serializeBlocks({
    children: [element("UL", [element("LI", [textNode("a")]), element("LI", [textNode("b")])])],
  }),
  "- a\n- b",
);
assert.equal(
  codec.serializeBlocks({
    children: [
      element("UL", [
        element("LI", [
          element("SPAN", [], { className: "amorist-task-checkbox" }),
          element("SPAN", [textNode("todo")], { className: "amorist-task-content" }),
          element("UL", [element("LI", [textNode("sub")])]),
        ], { className: "amorist-task-item", dataset: { checked: "true" } }),
      ], { className: "amorist-task-list" }),
    ],
  }),
  "- [x] todo\n  - sub",
);

// Hard line breaks. Inside a paragraph a newline is a soft break — a space —
// which is what lets prose be wrapped in the source without the wrap showing up
// in the output. Only an explicit marker forces a <br>: two trailing spaces or
// a trailing backslash. The backslash form used to leak into the rendered text.
assert.equal(
  codec.renderMarkdown("Date: 2026-07-17\nStatus: ok"),
  '<p data-source-line="0">Date: 2026-07-17 Status: ok</p>',
);
assert.equal(
  codec.renderMarkdown("Date: 2026-07-17  \nStatus: ok"),
  '<p data-source-line="0">Date: 2026-07-17<br>Status: ok</p>',
);
assert.equal(
  codec.renderMarkdown("Date: 2026-07-17\\\nStatus: ok"),
  '<p data-source-line="0">Date: 2026-07-17<br>Status: ok</p>',
);
assert.equal(
  codec.renderMarkdown("> quoted  \n> break"),
  '<blockquote data-source-line="0">quoted<br>break</blockquote>',
);
// Trailing spaces on the last line of a paragraph are not a break — there is no
// following line to break from.
assert.equal(
  codec.renderMarkdown("only line  "),
  '<p data-source-line="0">only line</p>',
);
// A break must survive the inline tokenizer rather than being swallowed by, or
// swallowing, the constructs around it.
assert.equal(
  codec.renderMarkdown("**bold**  \n`code`"),
  '<p data-source-line="0"><strong>bold</strong><br><code>code</code></p>',
);

// The editor's own Shift+Enter must round-trip. It used to serialize as a bare
// newline, which the parser then read back as a space: the break was silently
// lost on the first save or mode switch.
const breakSurface = {
  children: [element("P", [textNode("Date: 2026-07-17"), element("BR"), textNode("Status: ok")])],
};
assert.equal(codec.serializeBlocks(breakSurface), "Date: 2026-07-17  \nStatus: ok");
assert.equal(
  codec.renderMarkdown(codec.serializeBlocks(breakSurface)),
  '<p data-source-line="0">Date: 2026-07-17<br>Status: ok</p>',
);

// A break inside a quote has to keep the continuation quoted, or the second line
// would fall out of the blockquote entirely on reload.
assert.equal(
  codec.serializeBlocks({
    children: [element("BLOCKQUOTE", [textNode("quoted"), element("BR"), textNode("break")])],
  }),
  "> quoted  \n> break",
);

// A list item cannot carry a hard break: the parser has no lazy-continuation
// support, so "- a  \n  b" would come back as a list plus a paragraph. Collapsing
// to a space loses the break but keeps the document's structure — previously this
// wrote a bare newline and did split the item apart.
assert.equal(
  codec.serializeBlocks({
    children: [element("UL", [element("LI", [textNode("a"), element("BR"), textNode("b")])])],
  }),
  "- a b",
);
// Same for a heading, which is a single line by construction.
assert.equal(
  codec.serializeBlocks({
    children: [element("H2", [textNode("a"), element("BR"), textNode("b")])],
  }),
  "## a b",
);

console.log("editor-markdown-codec.test.js passed");
