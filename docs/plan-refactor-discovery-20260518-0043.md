# Plan: Refactor Discovery Follow-up

## Context

This plan turns the refactor candidates from `docs/refactor-discovery/2026-05-18/discovery.md` into an execution sequence. It is written against commit `f35e615d244b741944f622ac3da595025b722bec` on `main`.

Verification trace for this plan:

- `git rev-parse HEAD` returned `f35e615d244b741944f622ac3da595025b722bec`.
- `wc -l bin/amorist web/app.js web/editor/amorist-editor.js web/editor/amorist-editor.css` matched the cited line counts: 303, 238, 1121, and 215.
- `git ls-files | rg '(^|/)(test|tests|spec|fixtures)|\.(test|spec)\.'` returned no tracked test/spec/fixture files.
- `rg 'execCommand|formatMarkdownTable|splitTableRow|tableCellWidth|applySpaceMarkdownShortcut|applyInlineMarkdownShortcut|serializeBlocks|renderMarkdown|parseBlocks|AmoristEditor.create|window.AmoristEditor' web README.md bin scripts docs/refactor-discovery` confirmed `web/app.js` is the only tracked caller of `window.AmoristEditor.create`, and `README.md` documents the embedded public API.
- `docs/refactor-discovery/2026-05-18/discovery.md` promotes R1 and R2, with R1 as the clearest next refactor and R2 dependent on R1.

Current architecture:

- `bin/amorist` is a 303-line Python stdlib launcher/server. It validates the Markdown path, serves `web/` on `127.0.0.1`, exposes `/api/document`, `/api/ping`, and `/api/version`, preserves LF/CRLF on save, rejects Markdown files over 10 MB, and shuts down after heartbeat loss.
- `web/app.js` is a 238-line browser app shell. It loads and saves the document, tracks dirty state, starts heartbeat pings every 3000 ms, mounts the editor, and supports screenshot demo mode.
- `web/editor/amorist-editor.js` is a 1121-line browser-global editor module. It exposes `window.AmoristEditor.create`, owns toolbar creation, contenteditable/source mode, Markdown parse/render/serialize, table formatting, typing shortcuts, selection helpers, and scroll restoration.
- `web/editor/amorist-editor.css` is a 215-line editor style file. It owns toolbar positioning, WYSIWYG/source surfaces, task checkbox rendering, and horizontal overflow for code/table blocks.

Discovery priorities covered by this plan:

- R1: extract table parsing/formatting into a dedicated codec.
- SL2: add persistent tests for central editor contracts.
- SL1: name the editing policy boundary shared by toolbar commands and typing shortcuts.
- R2: split the editor UI shell from Markdown conversion layers after R1 narrows table handling.
- SL3, SL4, RT1: add lower-priority coverage or decision records for app-shell save/reload, runtime encoding policy, and `document.execCommand`.

## How to work with this plan

Read the entire plan before acting. Context, approach, edge cases, and open questions are all load-bearing.

For operational instructions (how to annotate, review, analyze impact, check quality): see the companion file `plan-refactor-discovery-20260518-0043.ops.md` in the same directory.

## Approach

Use a staged refactor: first add testable seams, then move logic behind those seams, then make lower-priority policy decisions. Keep the public app behavior and public editor API stable.

Hard constraints:

- Preserve `window.AmoristEditor.create(container, options)` as the only public browser API.
- Keep `web/index.html` as a no-build classic-script app.
- Do not introduce `package.json`, bundlers, npm runtime dependencies, TypeScript, React, or another editor framework.
- Put extracted helper/codecs/policy under `window.AmoristInternals` to avoid creating new public APIs such as `window.AmoristTableCodec`.
- Keep optional browser smoke tests under `tests/`.
- Do not update `docs/refactor-discovery/2026-05-18/discovery.md`; it is a static-analysis artifact. This plan and later decision records are the follow-up artifacts.

Execution order:

1. Add dependency-free tests and fixtures.
2. Extract shared text helpers to avoid codec load-order cycles.
3. Extract the table codec and lock its current output with fixtures.
4. Extract Markdown conversion into a codec that reuses text utilities and table handling.
5. Extract or name the editing policy boundary while keeping `document.execCommand`.
6. Add an optional browser smoke test for app-shell save/reload behavior.
7. Make runtime UTF-8 read behavior explicit.
8. Write a decision record for whether to keep or replace `document.execCommand`.

Final success criteria:

- `./bin/amorist --no-open file.md` still starts the app.
- `web/app.js` still mounts the editor through `window.AmoristEditor.create`.
- The documented Markdown subset still renders and serializes: headings, paragraphs, emphasis, inline code, links, blockquotes, bullet lists, numbered lists, task lists, fenced code blocks, and pipe tables.
- Pipe tables still preserve current behavior for emoji/wide glyph width, escaped pipes, blank lines inside tables, extra cells merged into the last column, missing-cell padding, separator alignment, and very wide horizontal scrolling.
- All required checks run without `npm install`.

## Detailed Changes

### 1. Persistent Test Harness

Create a committed test surface before moving editor internals.

Files to add:

- `tests/editor-table-codec.test.js`
- `tests/editor-markdown-codec.test.js`
- `tests/test_runtime_server.py`
- `tests/fixtures/tables.md`
- `tests/fixtures/editor-roundtrip.md`

Files to modify:

- `README.md`
- `scripts/README.md` only if documenting the optional browser smoke test there makes the command easier to find.

Target required check commands:

```bash
node tests/editor-table-codec.test.js
node tests/editor-markdown-codec.test.js
python3 tests/test_runtime_server.py
python3 -m py_compile bin/amorist
node --check web/app.js
node --check web/editor/amorist-text-utils.js
node --check web/editor/amorist-table-codec.js
node --check web/editor/amorist-markdown-codec.js
node --check web/editor/amorist-editing-policy.js
node --check web/editor/amorist-editor.js
```

Test harness shape:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadClassicScript(path, globals = {}) {
  const context = vm.createContext({ window: {}, console, ...globals });
  vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
  return context.window;
}
```

Test only pure functions in Node:

- Pure entries: `Internals.TextUtils.normalize`, `Internals.TextUtils.escapeHtml`, `Internals.TextUtils.escapeAttr`, `Internals.TableCodec.splitTableRow`, `Internals.TableCodec.formatMarkdownTable`, `Internals.TableCodec.tableCellWidth`, `Internals.MarkdownCodec.parseBlocks`, `Internals.MarkdownCodec.renderMarkdown`, and `Internals.MarkdownCodec.renderInline`.
- DOM-bound entries: `Internals.MarkdownCodec.serializeBlocks`, `Internals.MarkdownCodec.serializeBlock`, and `Internals.MarkdownCodec.inlineMarkdown`. These require DOM nodes and should be covered only through the optional browser smoke test or a future DOM harness.

Success criteria:

- Table tests include at least 10 exact-string assertions covering alignment, emoji/wide glyph width, escaped pipes, blank lines inside a table, extra cells, missing cells, separator alignment, and idempotence.
- Markdown codec tests include at least 6 assertions covering parse/render behavior for the documented Markdown subset.
- `README.md` lists the required check commands.

### 2. Shared Text Utilities

Extract shared text helpers before table and Markdown codecs. This avoids a load-order cycle because current `formatMarkdownTable` calls `normalize()`, and Markdown rendering also needs normalization and HTML escaping.

Files to add:

- `web/editor/amorist-text-utils.js`

Files to modify:

- `web/index.html`
- `web/editor/amorist-editor.js`
- `tests/editor-table-codec.test.js`
- `tests/editor-markdown-codec.test.js`

Move these helpers out of `web/editor/amorist-editor.js`:

- `normalize`
- `escapeHtml`
- `escapeAttr`

Target API:

```js
(function () {
  function normalize(markdown) {}
  function escapeHtml(value) {}
  function escapeAttr(value) {}

  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  Internals.TextUtils = {
    normalize,
    escapeHtml,
    escapeAttr,
  };
})();
```

Success criteria:

- `window.AmoristInternals.TextUtils` exists after loading `web/editor/amorist-text-utils.js`.
- `amorist-editor.js`, table codec, and Markdown codec use `Internals.TextUtils` instead of a local duplicate.
- `node --check web/editor/amorist-text-utils.js` passes.

### 3. Table Codec Extraction

Extract table-specific functions from `web/editor/amorist-editor.js` into a dedicated codec loaded before the editor.

Files to add:

- `web/editor/amorist-table-codec.js`

Files to modify:

- `web/index.html`
- `web/editor/amorist-editor.js`
- `README.md`
- `tests/editor-table-codec.test.js`

Move these functions out of `amorist-editor.js`:

- `isTableStart`
- `looksLikeTableRow`
- `nextNonEmptyTableRow`
- `isTableSeparator`
- `splitTableRow`
- `formatMarkdownTable`
- `tableAlignment`
- `formatTableRow`
- `formatTableSeparator`
- `padTableCell`
- `normalizeTableRow`
- `mergeExtraTableCells`
- `escapeTableCell`
- `tableCellWidth`
- `graphemeWidth`
- `isZeroWidthCodePoint`
- `isCombiningCodePoint`
- `isEmojiCodePoint`
- `isWideCodePoint`

Target API:

```js
(function () {
  const Internals = window.AmoristInternals || {};
  const TextUtils = Internals.TextUtils;
  if (!TextUtils) {
    throw new Error("AmoristTextUtils must be loaded before AmoristTableCodec.");
  }

  function splitTableRow(line, expectedColumnCount) {}
  function formatMarkdownTable(markdown) {}
  function isTableStart(lines, index) {}
  function looksLikeTableRow(line, expectedColumnCount) {}
  function nextNonEmptyTableRow(lines, index, expectedColumnCount) {}
  function tableCellWidth(value) {}

  Internals.TableCodec = {
    splitTableRow,
    formatMarkdownTable,
    isTableStart,
    looksLikeTableRow,
    nextNonEmptyTableRow,
    tableCellWidth,
  };
})();
```

Load order after this step:

```html
<script src="/web/editor/amorist-text-utils.js"></script>
<script src="/web/editor/amorist-table-codec.js"></script>
<script src="/web/editor/amorist-editor.js"></script>
<script src="/web/app.js"></script>
```

Editor consumption:

```js
const Internals = window.AmoristInternals || {};
const TextUtils = Internals.TextUtils;
const TableCodec = Internals.TableCodec;

if (!TextUtils) throw new Error("AmoristTextUtils must be loaded before AmoristEditor.");
if (!TableCodec) throw new Error("AmoristTableCodec must be loaded before AmoristEditor.");
```

Success criteria:

- `amorist-editor.js` delegates table detection and formatting to `window.AmoristInternals.TableCodec`.
- Table fixture outputs are byte-for-byte identical to current behavior.
- The public API remains only `window.AmoristEditor.create`.
- `node tests/editor-table-codec.test.js` passes.

### 4. Markdown Codec Extraction

Extract Markdown parsing/rendering/serialization into a named codec after table extraction is stable.

Files to add:

- `web/editor/amorist-markdown-codec.js`

Files to modify:

- `web/index.html`
- `web/editor/amorist-editor.js`
- `README.md`
- `tests/editor-markdown-codec.test.js`

Move or wrap these functions:

- `parseBlocks`
- `isBlockStart`
- `renderMarkdown`
- `renderBlock`
- `sourceLineAttr`
- `renderInline`
- `token`
- `serializeBlocks`
- `serializeBlock`
- `inlineMarkdown`

Do not move `normalize`, `escapeHtml`, or `escapeAttr` into this codec; they belong to `Internals.TextUtils`.

Target API:

```js
(function () {
  const Internals = window.AmoristInternals || {};
  const TextUtils = Internals.TextUtils;
  const TableCodec = Internals.TableCodec;
  if (!TextUtils) {
    throw new Error("AmoristTextUtils must be loaded before AmoristMarkdownCodec.");
  }
  if (!TableCodec) {
    throw new Error("AmoristTableCodec must be loaded before AmoristMarkdownCodec.");
  }

  function parseBlocks(markdown) {}
  function renderMarkdown(markdown) {}
  function serializeBlocks(surface) {}
  function renderInline(text) {}
  function inlineMarkdown(node) {}

  Internals.MarkdownCodec = {
    parseBlocks,
    renderMarkdown,
    serializeBlocks,
    renderInline,
    inlineMarkdown,
  };
})();
```

Load order after this step:

```html
<script src="/web/editor/amorist-text-utils.js"></script>
<script src="/web/editor/amorist-table-codec.js"></script>
<script src="/web/editor/amorist-markdown-codec.js"></script>
<script src="/web/editor/amorist-editor.js"></script>
<script src="/web/app.js"></script>
```

Editor consumption:

```js
const Internals = window.AmoristInternals || {};
const TextUtils = Internals.TextUtils;
const MarkdownCodec = Internals.MarkdownCodec;

this.markdown = TextUtils.normalize(markdown || "");
this.markdown = TextUtils.normalize(this.source.value);
this.surface.innerHTML = MarkdownCodec.renderMarkdown(this.markdown);
this.markdown = MarkdownCodec.serializeBlocks(this.surface);
```

Success criteria:

- `AmoristEditor` no longer owns Markdown parse/render/serialize implementations directly.
- Source/WYSIWYG toggling still round-trips supported Markdown.
- Rendered top-level blocks still include `data-source-line` for scroll restoration.
- `node tests/editor-markdown-codec.test.js` passes.
- `README.md` embedded editor docs list all required script files in load order.

### 5. Editing Policy Boundary

Extract or name the policy that mutates the editable surface for toolbar commands and typing shortcuts. Keep the existing browser editing model; do not replace `document.execCommand` in this step.

Files to add:

- `web/editor/amorist-editing-policy.js`

Files to modify:

- `web/index.html`
- `web/editor/amorist-editor.js`
- `tests/editor-editing-policy.test.js` if pure decision logic is extracted.

Current verified command surfaces:

- `runAction(action)` is an `AmoristEditor` instance method and uses `document.execCommand` for bold, italic, headings, unordered lists, ordered lists, quote, link, task insertion, code block insertion, and paste text insertion.
- `applySpaceMarkdownShortcut`, `applyEnterMarkdownShortcut`, and `applyInlineMarkdownShortcut` are `AmoristEditor` instance methods and use custom DOM/range transformations.
- Those methods close over `this.surface`, `this.markdown`, and `this.handleWysiwygInput()`. This is an interface design task, not a mechanical move.

Target API:

```js
(function () {
  function create({ surface, onChanged }) {}

  const Internals = window.AmoristInternals || (window.AmoristInternals = {});
  Internals.EditingPolicy = { create };
})();
```

Editor consumption:

```js
const Internals = window.AmoristInternals || {};
const EditingPolicy = Internals.EditingPolicy;
if (!EditingPolicy) {
  throw new Error("AmoristEditingPolicy must be loaded before AmoristEditor.");
}

this.editing = EditingPolicy.create({
  surface: this.surface,
  onChanged: () => this.handleWysiwygInput(),
});
```

Policy responsibilities:

- Apply block shortcuts: `#`, `##`, `###`, `-`, `1.`, and `>`.
- Apply Enter shortcut for fenced code blocks.
- Apply inline shortcuts for `` `code` `` and `**bold**`.
- Apply toolbar commands by action name.
- Ensure every successful mutation calls `onChanged()` exactly once.

Success criteria:

- `AmoristEditor` delegates command and shortcut mutation decisions to `Internals.EditingPolicy`.
- `AmoristEditor` still owns lifecycle, public API, mode toggling, and scroll restoration.
- Toolbar labels and current typing shortcuts do not change.
- `document.execCommand` remains in use unless the later decision record says otherwise.

### 6. App Shell Save/Reload Contract Coverage

Add an optional browser smoke test for dirty/save/reload behavior after codec tests exist.

Files to add:

- `tests/app-shell-smoke.test.js`

Files to modify:

- `README.md`
- `scripts/README.md` only if documenting how to run optional smoke checks there is clearer.

Do not extract app-shell state in this plan. `web/app.js` currently reads browser globals directly through `document.getElementById`, `fetch`, `window.confirm`, and event listeners. A pure state-machine extraction would be larger than this coverage task.

Smoke-test behavior:

- Skip with a clear message if no Chromium-compatible browser is available.
- Start `./bin/amorist --no-open` against a temporary Markdown file.
- Open the printed local URL.
- Edit the document through the editor.
- Save and verify the temporary file changed.
- Reload and verify dirty state clears.
- Confirm the test writes only under a temporary directory and terminates the launched `amorist` process.

Success criteria:

- The optional smoke test is committed under `tests/`.
- The required no-browser check list remains independent of this smoke test.
- `README.md` labels the smoke test optional.

### 7. Runtime Encoding and Save Boundary Policy

Make UTF-8 read behavior explicit while preserving current valid-file behavior.

Files to modify:

- `bin/amorist`
- `README.md`
- `tests/test_runtime_server.py`

Current asymmetry:

- Read path: `send_document` currently calls `raw.decode("utf-8")` at `bin/amorist:128-129` without catching `UnicodeDecodeError`, so invalid UTF-8 can produce a 500.
- Write path: `save_document` already catches `UnicodeDecodeError` for JSON payload decoding at `bin/amorist:153-156` and returns `400`.

Recommended read-path change:

```python
try:
    markdown = raw.decode("utf-8")
except UnicodeDecodeError:
    self.send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Markdown files must be UTF-8 encoded.")
    return
```

Do not broaden or tidy the write-path error handling in this task unless a test exposes a specific bug.

Tests should cover:

- LF input saves as LF when `lineEnding` is `lf`.
- CRLF input saves as CRLF when `lineEnding` is `crlf`.
- Invalid JSON save payload returns `400`.
- Save payload over 10 MB returns `413`.
- Invalid UTF-8 document read returns a clear non-200 response and does not modify the file.

Success criteria:

- UTF-8-only behavior is explicit in code and `README.md`.
- `python3 tests/test_runtime_server.py` passes.
- Valid UTF-8 Markdown behavior is unchanged.

### 8. `execCommand` Decision Record

Defer replacement of `document.execCommand` until after the structural split and tests exist. This task writes a decision record only.

Files to add:

- `docs/decision-exec-command.md`

Do not update `docs/refactor-discovery/2026-05-18/discovery.md`; it remains static analysis.

Research method:

- Enumerate every current `document.execCommand` call in `web/editor/amorist-editor.js`.
- Test toolbar behavior in the target browser available to the project.
- Compare keeping `execCommand` against replacing toolbar commands with explicit DOM/range transformations inside `Internals.EditingPolicy`.

Decision criteria:

- Keep `execCommand` if toolbar commands are stable in the current target browser and replacement would exceed 150 lines of custom selection code.
- Replace it in a separate future plan if a target browser breaks a core command or tests show inconsistent serialization for bold, italic, headings, lists, quote, link, task item, code block, or paste.

Success criteria:

- `docs/decision-exec-command.md` records evidence, decision, and next action.
- Toolbar implementation is not changed by this research task.

## Edge Cases and Risks

- **Risk: Browser-global load order breaks the editor.**
  - **Likelihood:** medium.
  - **Impact:** the app opens but the editor fails before mount.
  - **Mitigation:** every internal lookup such as `Internals.TextUtils`, `Internals.TableCodec`, `Internals.MarkdownCodec`, or `Internals.EditingPolicy` must be followed immediately by a load-order guard at the top of the IIFE.
  - **Exit clause:** if classic-script globals become too fragile after these 4 internal modules, stop splitting further and keep remaining helpers in `amorist-editor.js`; do not introduce a build step without a separate plan.

- **Risk: Table output whitespace changes.**
  - **Likelihood:** medium.
  - **Impact:** saves rewrite tables unexpectedly, reducing trust in the editor.
  - **Mitigation:** table fixture tests must compare exact strings before and after extraction.
  - **Exit clause:** if exact compatibility takes more than one focused extraction pass, keep the original table code in place, add tests first, then retry extraction in a smaller patch.

- **Risk: Markdown codec extraction breaks scroll restoration.**
  - **Likelihood:** medium.
  - **Impact:** source/WYSIWYG toggling jumps to the wrong part of the document.
  - **Mitigation:** preserve `data-source-line` generation and add a fixture assertion that rendered top-level blocks include source-line attributes.
  - **Exit clause:** if source-line mapping becomes unclear, leave render/parse in the editor and only keep table codec plus tests.

- **Risk: Node tests need DOM APIs.**
  - **Likelihood:** high for serialization, low for table formatting.
  - **Impact:** tests become brittle or pull the repo back toward npm dependencies.
  - **Mitigation:** only test pure functions in Node; cover DOM behavior through optional browser smoke checks.
  - **Exit clause:** if meaningful DOM tests require `jsdom`, do not add it under this plan.

- **Risk: Editing policy extraction changes caret behavior.**
  - **Likelihood:** medium.
  - **Impact:** shortcuts serialize but typing feels broken.
  - **Mitigation:** first extraction should preserve existing DOM/range logic and verify heading/list/task/quote/fence/inline-code/bold shortcuts manually or through smoke checks.
  - **Exit clause:** if caret regressions appear, revert only the editing-policy extraction and keep codec extractions.

- **Risk: Invalid UTF-8 handling shows a generic browser error.**
  - **Likelihood:** low.
  - **Impact:** user sees an HTTP error instead of polished app UI.
  - **Mitigation:** return a clear status and message first; app-shell UX polishing can be a later task.
  - **Exit clause:** if invalid-encoding UX becomes important in real use, add an app-shell error mapping task before expanding runtime encoding support.

## Failure Modes and Degradation

- Missing internal editor script:
  - Applies to `amorist-text-utils.js`, `amorist-table-codec.js`, `amorist-markdown-codec.js`, and `amorist-editing-policy.js`.
  - Behavior: editor startup fails with a clear console error before mounting.
  - Degradation: no editor mount and no file write.
  - Fallback: restore the missing script tag or inline the module back into `amorist-editor.js`.

- Malformed or partial table text:
  - If fewer than 2 non-empty table lines exist, return the trimmed normalized input, matching current behavior.
  - If rows have missing cells, pad to the separator/header column count.
  - If rows have extra cells, merge extras into the final column.
  - Fallback: keep the content as editable monospace Markdown text; do not introduce HTML table rendering in this refactor.

- Test runner unavailable:
  - If `node` is unavailable, JavaScript checks cannot run; Python runtime tests still can.
  - If `python3` is unavailable, the app cannot run either because `python3` is an installer prerequisite.
  - Fallback: document exact commands that could not run in the implementation report.

- Browser unavailable for optional smoke tests:
  - Required tests still pass without a browser.
  - Optional smoke test skips with a clear message.
  - Fallback: use `./scripts/capture-screenshots.sh` manually as visual verification when a browser is available.

- Runtime save failure during temporary-file write or replace:
  - Current behavior may return an unhandled server error if write/replace raises.
  - This plan does not require changing that behavior unless runtime tests expose a reproducible regression.
  - Fallback for a future task: catch `OSError`, return `HTTPStatus.INTERNAL_SERVER_ERROR`, and leave the original file untouched.

## Open Questions

No unresolved open questions remain for this plan.

Assumptions to preserve during implementation:

- Exact Markdown lexical preservation is not a hard invariant; the editor already normalizes spacing, table layout, and some inline syntax during serialization.
- UTF-8-only Markdown is acceptable for the current user base. If real non-UTF-8 files appear, create a separate encoding plan.
- No-build, no-runtime-dependency embedding is more important than ergonomic ES modules or npm-based tests.

Resolved decisions:

- Extracted helpers, codecs, and editing policy live under `window.AmoristInternals`.
- Optional browser smoke tests live under `tests/`.
- `docs/refactor-discovery/2026-05-18/discovery.md` remains unchanged static analysis.

## Task Breakdown

- [ ] Task 1: Add dependency-free test harness files and fixture files under `tests/`.
- [ ] Task 2: Document the required check commands in `README.md`.
- [ ] Task 3: Extract shared helpers into `web/editor/amorist-text-utils.js`.
- [ ] Task 4: Load `amorist-text-utils.js` before editor codec files in `web/index.html`.
- [ ] Task 5: Extract table helpers into `web/editor/amorist-table-codec.js`.
- [ ] Task 6: Update `web/editor/amorist-editor.js` to use `window.AmoristInternals.TableCodec`.
- [ ] Task 7: Make `tests/editor-table-codec.test.js` pass with exact current table output.
- [ ] Task 8: Extract Markdown parse/render/serialize helpers into `web/editor/amorist-markdown-codec.js`.
- [ ] Task 9: Update `web/editor/amorist-editor.js` to use `window.AmoristInternals.MarkdownCodec`.
- [ ] Task 10: Make `tests/editor-markdown-codec.test.js` pass for the documented Markdown subset and `data-source-line`.
- [ ] Task 11: Extract the editing policy into `web/editor/amorist-editing-policy.js` without replacing `document.execCommand`.
- [ ] Task 12: Add optional browser smoke coverage in `tests/app-shell-smoke.test.js`.
- [ ] Task 13: Make runtime UTF-8 read handling explicit in `bin/amorist`, `README.md`, and `tests/test_runtime_server.py`.
- [ ] Task 14: Write `docs/decision-exec-command.md`.
- [ ] Task 15: Run the full required check set and update embedded-editor documentation for the final script load order.
