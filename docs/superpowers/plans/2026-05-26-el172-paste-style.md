# EL-172 — Copy & paste with style in WYSIWYG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasting into the WYSIWYG view preserves formatting: rich HTML (browser/Word/another amorist window) is converted to clean Markdown-compatible structure, and plain text is interpreted as Markdown source. Code contexts paste literally.

**Architecture:** New embeddable module `web/editor/amorist-html-to-markdown.js` parses pasted HTML with `DOMParser`, sanitizes it (drop scripts/styles, unwrap `span`/`font`, strip attributes except `href`, wrap loose inline content in `<p>`), then **reuses** `MarkdownCodec.serializeBlocks()` to emit Markdown (DRY — that walker already maps `strong/em/code/a/br/h1-6/ul/ol/li/blockquote/pre`). `handlePaste` in `amorist-editor.js` routes by clipboard payload and inserts rendered Markdown at the caret, except inside code where it pastes literal text.

**Tech Stack:** Vanilla JS (classic scripts, IIFE → `window.AmoristInternals`), `DOMParser`, `node:vm` unit tests for the pure helpers, manual browser verification for the DOM path.

**Spec:** `docs/superpowers/specs/2026-05-26-el172-paste-style-wysiwyg-design.md`

---

### Task 1: New module — pure helpers (tag classification + markdown cleanup), TDD

**Files:**
- Create: `web/editor/amorist-html-to-markdown.js`
- Test: `tests/editor-html-to-markdown.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
// tests/editor-html-to-markdown.test.js
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

// Tag classification (case-insensitive, uppercase tag names as DOM reports them)
assert.equal(H._isStripped("SCRIPT"), true);
assert.equal(H._isStripped("STYLE"), true);
assert.equal(H._isStripped("P"), false);
assert.equal(H._isUnwrapped("SPAN"), true);
assert.equal(H._isUnwrapped("FONT"), true);
assert.equal(H._isUnwrapped("STRONG"), false);

// cleanupMarkdown collapses 3+ blank lines and trims trailing space
assert.equal(H._cleanupMarkdown("a\n\n\n\nb\n\n"), "a\n\nb");
assert.equal(H._cleanupMarkdown("   \n\nhi  "), "hi");

console.log("html-to-markdown pure helpers OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/editor-html-to-markdown.test.js`
Expected: FAIL — cannot read file (module does not exist yet).

- [ ] **Step 3: Create the module with the pure helpers + export**

`web/editor/amorist-html-to-markdown.js`:

```js
(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  const MarkdownCodec = Internals.MarkdownCodec;
  if (!MarkdownCodec) {
    throw new Error("AmoristMarkdownCodec must be loaded before AmoristHtmlToMarkdown.");
  }

  // Elements removed entirely (content discarded).
  const STRIPPED = new Set(["SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "NOSCRIPT"]);
  // Inline wrappers with no Markdown meaning: replace with their children.
  const UNWRAPPED = new Set(["SPAN", "FONT", "U", "S", "SMALL", "ABBR", "TIME", "MARK"]);

  function isStripped(tag) {
    return STRIPPED.has(tag);
  }
  function isUnwrapped(tag) {
    return UNWRAPPED.has(tag);
  }

  function cleanupMarkdown(md) {
    return md.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  Internals.HtmlToMarkdown = {
    // convert() added in Task 2
    _isStripped: isStripped,
    _isUnwrapped: isUnwrapped,
    _cleanupMarkdown: cleanupMarkdown,
  };
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/editor-html-to-markdown.test.js`
Expected: `html-to-markdown pure helpers OK`

- [ ] **Step 5: Syntax check + commit**

```bash
node --check web/editor/amorist-html-to-markdown.js
git add web/editor/amorist-html-to-markdown.js tests/editor-html-to-markdown.test.js
git commit -m "EL-172: html-to-markdown module skeleton with tested pure helpers"
```

---

### Task 2: Implement `convert(html)` (DOM sanitize → serializeBlocks)

**Files:**
- Modify: `web/editor/amorist-html-to-markdown.js`

- [ ] **Step 1: Add sanitize + convert**

Inside the IIFE, before the `Internals.HtmlToMarkdown = {...}` export, add:

```js
  const INLINE_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "CODE", "BR", "SUB", "SUP"]);

  function sanitize(root) {
    // Depth-first; mutate as we go. Work on a static list to avoid live-collection surprises.
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === 8 /* comment */) {
        node.remove();
        return;
      }
      if (node.nodeType !== 1 /* element */) return; // keep text nodes

      const tag = node.tagName;
      if (isStripped(tag)) {
        node.remove();
        return;
      }
      sanitize(node); // recurse first so children are clean before we unwrap

      if (isUnwrapped(tag)) {
        node.replaceWith(...node.childNodes);
        return;
      }

      // Strip every attribute except href on anchors.
      Array.from(node.attributes || []).forEach((attr) => {
        if (!(tag === "A" && attr.name === "href")) {
          node.removeAttribute(attr.name);
        }
      });
    });
  }

  function isInlineNode(node) {
    if (node.nodeType === 3) return (node.textContent || "").trim().length > 0 || true;
    if (node.nodeType !== 1) return false;
    return INLINE_TAGS.has(node.tagName);
  }

  // serializeBlocks only iterates element children, so loose top-level text /
  // inline runs must be wrapped in <p> or they would be dropped.
  function wrapLooseInline(root, doc) {
    let para = null;
    Array.from(root.childNodes).forEach((node) => {
      const loose =
        node.nodeType === 3 || (node.nodeType === 1 && INLINE_TAGS.has(node.tagName));
      if (loose) {
        if (!para) {
          para = doc.createElement("p");
          root.insertBefore(para, node);
        }
        para.appendChild(node);
      } else {
        para = null;
      }
    });
  }

  function convert(html) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    sanitize(body);
    wrapLooseInline(body, doc);
    const md = MarkdownCodec.serializeBlocks(body);
    return cleanupMarkdown(md);
  }
```

- [ ] **Step 2: Expose `convert` in the export**

Change the export object to:

```js
  Internals.HtmlToMarkdown = {
    convert,
    _isStripped: isStripped,
    _isUnwrapped: isUnwrapped,
    _cleanupMarkdown: cleanupMarkdown,
  };
```

- [ ] **Step 3: Syntax check**

Run: `node --check web/editor/amorist-html-to-markdown.js`
Expected: no output.

- [ ] **Step 4: Re-run pure-helper test (no regression)**

Run: `node tests/editor-html-to-markdown.test.js`
Expected: `html-to-markdown pure helpers OK` (convert is exercised in the browser, Task 6).

- [ ] **Step 5: Commit**

```bash
git add web/editor/amorist-html-to-markdown.js
git commit -m "EL-172: implement HtmlToMarkdown.convert via sanitize + serializeBlocks"
```

---

### Task 3: Load the module in dependency order

**Files:**
- Modify: `web/index.html:35-37`

- [ ] **Step 1: Add the script tag after markdown-codec**

The module depends on `MarkdownCodec` and must load before `amorist-editor.js`. Edit the script block so it reads:

```html
    <script src="editor/amorist-text-utils.js"></script>
    <script src="editor/amorist-table-codec.js"></script>
    <script src="editor/amorist-markdown-codec.js"></script>
    <script src="editor/amorist-html-to-markdown.js"></script>
    <script src="editor/amorist-editing-policy.js"></script>
    <script src="editor/amorist-editor.js"></script>
    <script src="app.js"></script>
```

- [ ] **Step 2: Commit**

```bash
git add web/index.html
git commit -m "EL-172: load html-to-markdown module after markdown-codec"
```

---

### Task 4: Rewrite `handlePaste` with routing + code guard + caret insertion

**Files:**
- Modify: `web/editor/amorist-editor.js` (binding at top ~line 5; `handlePaste` ~line 330)

- [ ] **Step 1: Bind the dependency**

Near the top of the IIFE (after `const EditingPolicy = Internals.EditingPolicy;`, ~line 5), add:

```js
  const HtmlToMarkdown = Internals.HtmlToMarkdown;
```

And after the `EditingPolicy` guard (~line 15) add:

```js
  if (!HtmlToMarkdown) {
    throw new Error("AmoristHtmlToMarkdown must be loaded before AmoristEditor.");
  }
```

- [ ] **Step 2: Replace `handlePaste` and add two helpers**

Replace the existing `handlePaste` method (lines 330-335) with:

```js
    handlePaste(event) {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      // Inside a code block / inline code: never parse, paste literally.
      if (this.isInCodeContext()) {
        const literal = clipboard.getData("text/plain");
        if (!literal) return;
        event.preventDefault();
        this.editing.insertPlainText(literal);
        return;
      }

      const html = clipboard.getData("text/html");
      let markdown;
      if (html && html.trim()) {
        markdown = HtmlToMarkdown.convert(html);
      } else {
        // Plain text is treated as Markdown source (EL-172 decision).
        markdown = TextUtils.normalize(clipboard.getData("text/plain") || "");
      }
      if (!markdown) return;
      event.preventDefault();
      this.insertMarkdownAtCaret(markdown);
    }

    isInCodeContext() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return false;
      let node = selection.anchorNode;
      while (node && node !== this.surface) {
        if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === "PRE" || node.tagName === "CODE")) {
          return true;
        }
        node = node.parentNode;
      }
      return false;
    }

    insertMarkdownAtCaret(markdown) {
      const html = MarkdownCodec.renderMarkdown(markdown);
      // execCommand splits the current block when inserting block-level HTML,
      // which is the desired behavior for multi-block pastes.
      document.execCommand("insertHTML", false, html);
      this.syncWysiwygInput();
    }
```

- [ ] **Step 3: Syntax check**

Run: `node --check web/editor/amorist-editor.js`
Expected: no output.

- [ ] **Step 4: Run the existing JS test suite (no regression)**

Run: `node tests/editor-markdown-codec.test.js && node tests/editor-table-codec.test.js && node tests/editor-history.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add web/editor/amorist-editor.js
git commit -m "EL-172: route paste by payload, parse markdown, guard code context"
```

---

### Task 5: Confirm dependency guards & startup integrity

**Files:** none (verification)

- [ ] **Step 1: Verify load order doesn't throw**

Run the existing browser smoke test (it loads all editor scripts in order; a broken guard or load order would throw at startup):
`AMORIST_RUN_BROWSER_SMOKE=1 node tests/app-shell-smoke.test.js`
Expected: `app-shell-smoke.test.js passed` (or a clean "Skipping" only if no Chromium — in that case run the Tauri dev app instead and confirm the editor loads without a console error).

- [ ] **Step 2: Commit (if any guard ordering fix was needed)**

```bash
git add -A
git commit -m "EL-172: ensure editor scripts load with html-to-markdown guard"
```

---

### Task 6: Manual paste verification in the running app

**Files:** none (verification)

Launch under a real terminal: `cd src-tauri && cargo tauri dev -- -- /tmp/paste-test.md`

- [ ] **Step 1: Rich HTML from a browser**

Copy a paragraph with **bold**, *italic*, a link, and a bullet list from a web page; paste into the WYSIWYG view. Expected: formatting preserved as headings/bold/italic/link/list (no raw `<span>`/styles). Toggle to source and confirm clean Markdown.

- [ ] **Step 2: Internal copy (amorist → amorist)**

Select a formatted region in amorist, copy, paste elsewhere in the document. Expected: structure preserved and round-trips to stable Markdown.

- [ ] **Step 3: Plain text with Markdown syntax**

Copy the literal text `**ciao** e *via*` from a plain-text source (e.g. a terminal) and paste. Expected: it renders as **ciao** and *via* (parsed), per the EL-172 decision.

- [ ] **Step 4: Paste inside a code block**

Place the caret inside a fenced code block and paste `**not bold**`. Expected: pasted literally, asterisks visible, no parsing.

- [ ] **Step 5: Version bump + changelog**

Update `VERSION` (MINOR) and add a `CHANGELOG.md` entry. Commit per the semver skill.

```bash
git add VERSION CHANGELOG.md
git commit -m "EL-172: bump version for rich paste support"
```

---

## Self-Review notes

- Spec coverage: HTML→Markdown via serializeBlocks reuse (Tasks 1-2), span/style stripping (sanitize, Task 2), plain-text-as-Markdown (Task 4), code-context literal paste (Task 4), load order (Task 3), block-split insertion via `insertHTML` (Task 4, risk noted in spec). Tables: serializeBlocks already emits pipe tables for amorist's own `<pre class="amorist-markdown-table">`, but external `<table>` is **not** handled (stretch goal, deferred per spec) — external tables degrade to text; acceptable for v1.
- Type consistency: `convert`, `sanitize`, `wrapLooseInline`, `cleanupMarkdown`, `isStripped`, `isUnwrapped`, `isInCodeContext`, `insertMarkdownAtCaret` referenced consistently; `HtmlToMarkdown` bound and guarded in editor.js.
- No placeholders.
- Testing limitation: the DOM path (`convert`) needs a real DOM (`DOMParser`); the repo has no jsdom and `serializeBlocks` itself is not unit-tested. Automated coverage is the pure helpers (node:vm) + the existing smoke test still passing; the converter's behavior is verified manually (Task 6) with explicit cases. This matches the codebase's existing test conventions.
