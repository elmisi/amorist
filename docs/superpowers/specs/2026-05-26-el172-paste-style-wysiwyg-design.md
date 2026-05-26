# EL-172 — Copy & paste with style in the WYSIWYG view

**Card:** EL-172-copy-paste-in-wysiwyg-view · label `amorist`
**Branch:** `feature/el172-paste-style`
**Date:** 2026-05-26

## Problem

When pasting into the WYSIWYG (contenteditable) view, the user expects formatting to be carried over. Today everything is flattened to plain text.

### Current behaviour

`amorist-editor.js:330` `handlePaste`:

```js
const text = event.clipboardData && event.clipboardData.getData("text/plain");
if (!text) return;
event.preventDefault();
this.editing.insertPlainText(text); // execCommand insertText — strips all formatting
```

So both rich HTML (from a browser/Word) and plain Markdown text lose all structure.

## Decisions (from brainstorming)

- **Rich HTML paste** → convert to clean Markdown-compatible formatting; discard non-mappable styling.
- **Plain-text paste** → treat the text as **Markdown source** and parse it into formatting.

## Approach

Rewrite `handlePaste` to route by clipboard payload, producing Markdown that is then rendered through the existing `MarkdownCodec.renderMarkdown()` and inserted at the caret.

```
handlePaste(event):
  if caret is inside <pre>/<code>  -> insert literal text/plain, no parsing   (protect code)
  else if clipboard has text/html  -> md = HtmlToMarkdown.convert(html)
  else                             -> md = text/plain (treated as Markdown source)
  insert rendered(md) at caret
```

### New module: `web/editor/amorist-html-to-markdown.js`

- IIFE writing to `window.AmoristInternals`, dependency-guarded, **no app-shell / Tauri leakage** (editor embeddability rule).
- Loaded as a classic `<script>` in dependency order (after text-utils, before/with markdown-codec).
- Converts a sanitized HTML fragment to Markdown. Supported elements:
  `h1–h6, p, br, hr, strong/b, em/i, code, pre, a, ul/ol/li (incl. nesting), blockquote`.
  Tables are a stretch goal (the codec already round-trips pipe tables) — include if low-risk, otherwise defer.
- **Sanitization:** strip `span`, `style`, `font`, class/inline-style noise (Word/Google Docs cruft); keep only structural semantics. Unknown elements degrade to their text content.

### Insertion at caret

- **Inline-only result** (single line, only inline formatting): insert inline HTML at the caret via the editing layer.
- **Block-level result** (multiple blocks, headings, lists): insert rendered blocks, splitting the current block when the caret is mid-paragraph.

This block-splitting case is the main risk and the primary TDD target.

### Codec exception for code context

When the caret is inside a `<pre><code>` block or inline `<code>`, paste literal `text/plain` (never parse) so pasted code is not mangled.

## Components touched

| Component | Change |
|-----------|--------|
| `web/editor/amorist-html-to-markdown.js` | new converter module |
| `web/editor/amorist-editor.js` | rewrite `handlePaste`; route by payload + code-context guard |
| `web/editor/amorist-editing-policy.js` | helper to insert rendered Markdown at caret (inline + block split) |
| `web/index.html` (script tags) | load new module in dependency order |
| `tests/editor-html-to-markdown.test.js` | new unit tests (node:vm + DOM shim) |

## Testing

- Unit: `HtmlToMarkdown.convert()` for each supported element, nesting, and Word/Docs cruft stripping.
- Unit: plain-text-with-markdown paste → parsed formatting; pasted code in code block → literal.
- Round-trip: paste rich content → serialize back via `serializeBlocks` → stable Markdown.
- Manual (browser smoke): paste from a webpage, from another amorist window, and a raw `**bold**` string.

## Out of scope

- Images / embedded binary clipboard data.
- Pasting full HTML documents with arbitrary CSS layout.

## Versioning

MINOR bump. Update `VERSION` + `CHANGELOG.md`.
