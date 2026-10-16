# Plan: Search, Undo and Redo

## Context

amorist is a local-first Markdown editor with a vanilla JS contenteditable frontend (`web/editor/`, 5 modules, ~1350 LOC). The editor has no undo/redo support and no search functionality.

**Current state of undo/redo:** The browser's native `Ctrl+Z` works at the DOM level on the contenteditable surface, but it operates on raw HTML mutations — it doesn't sync back to the markdown data model, and switching between WYSIWYG and source mode destroys the native undo stack entirely (the surface is rebuilt from markdown via `setMarkdown()` → `renderMarkdown()` at `amorist-editor.js:132`). There is no history tracking anywhere in the codebase (verified: `grep -rn 'undo\|redo\|history' web/` returns zero relevant hits).

**Current state of search:** No find/replace functionality exists (verified: `grep -rn 'find\|search\|replace' web/editor/` returns only `String.prototype.replace()` calls for regex substitution and `element.replaceWith()` for DOM manipulation). The browser's native `Ctrl+F` opens the browser's find bar, which works on visible text but doesn't integrate with the editor and is invisible in the Tauri webview.

**Design constraint — editor embeddability:** The `web/editor/` directory is a self-contained component. These features must live inside the editor module, not in `web/app.js`. The public API (`AmoristEditor.create()`) may grow, but the boundary is preserved: no app-shell or Tauri knowledge inside the editor.

**Toolbar scope decision:** Undo/redo and find are keyboard-only for v1. No toolbar buttons are added. Rationale: `Ctrl+Z`/`Ctrl+Y`/`Ctrl+F` are universally expected keyboard shortcuts that don't need visual affordances — every user who would use undo already reaches for `Ctrl+Z`. Adding toolbar buttons would widen the toolbar (already 13 items) for near-zero discoverability gain. Toolbar buttons can be added in a follow-up if user feedback requests them.

**Relevant files at commit `fe84068` (current HEAD of `feature/tauri2-standalone`):**

| File                                   | LOC | Role                                                 |
| -------------------------------------- | --- | ---------------------------------------------------- |
| `web/editor/amorist-editor.js`         | 334 | Editor UI shell, toolbar, mode switching, public API |
| `web/editor/amorist-editing-policy.js` | 429 | Contenteditable shortcuts, toolbar action dispatch   |
| `web/editor/amorist-markdown-codec.js` | 310 | Markdown parser/renderer/serializer                  |
| `web/editor/amorist-editor.css`        | 243 | Editor styling                                       |
| `web/app.css`                          | 200 | App shell styling (overrides for standalone layout)  |

## How to work with this plan

Read the entire plan before acting. Context, approach, edge cases, and open questions are all load-bearing.

For operational instructions (how to annotate, review, analyze impact, check quality): see the companion file `plan-search-undo-redo-20260520-1119.ops.md` in the same directory.

## Approach

### Undo/Redo: markdown-level history stack

The native browser undo operates on DOM mutations and is destroyed on every mode switch or `setMarkdown()` call. A reliable undo must track the markdown string, not the DOM. The design: a simple history stack inside the editor that records markdown snapshots.

**How it works:**

1. Every time `emitChange()` fires (the single choke point for all changes — WYSIWYG input, source textarea input, toolbar actions, paste, checkbox toggle), push the new `this.markdown` string onto the history stack. Note: `emitChange()` is also reached by public `setMarkdown()` calls when not silent. **Contract for embedders:** a non-silent `setMarkdown()` call pushes to history like any other edit. If an embedder loads a different document into the same editor instance, the previous history is preserved — the user can undo back to the previous content. To reset history (e.g., when switching documents), the embedder should call `destroy()` + `create()` rather than `setMarkdown()`. In the amorist app shell, `mountEditor()` already does destroy+create on reload, so this is a non-issue for the app.
2. Debounce pushes by 500ms so rapid typing produces one entry, not one per keystroke. The debounce timer resets on each input; the push fires 500ms after the last input stops.
3. `Ctrl+Z` pops the stack backwards, restores the markdown via `restoreHistoryMarkdown()`, and suppresses the resulting history push by avoiding `emitChange()`.
4. `Ctrl+Y` / `Ctrl+Shift+Z` moves forward in the stack.
5. Any new edit after an undo clears the forward history (standard undo behavior).

**Why markdown-level, not DOM-level:** (a) survives mode switches, (b) single history for both WYSIWYG and source mode, (c) simpler — no need to track and replay DOM operations.

**Memory:** Each entry is one markdown string. A 10 MB file (the maximum amorist accepts) with 200 history entries = 2 GB worst case. That's too much. **Limit: 100 entries, and skip push if the new markdown is identical to the current entry.** For a 50 KB file (typical), 100 entries = 5 MB — acceptable. For the 10 MB ceiling, 100 entries = 1 GB — still high. **Additional safeguard: cap total history at ~50 million characters (code units).** When a push would exceed the cap, drop the oldest entry. Note: `string.length` returns UTF-16 code units, not bytes. For mostly-ASCII markdown, 50M code units ≈ 50 MB. For CJK-heavy files, actual heap usage is ~100 MB (2 bytes per code unit in V8/JSC). This is an acceptable approximation — using `TextEncoder` per push would add a non-trivial cost on every keystroke debounce. The cap is a safety valve, not a precise memory budget.

### Search: in-editor find bar

A minimal find bar that appears below the toolbar, highlights matches in the active surface, and navigates between them with Enter / Shift+Enter.

**Why not browser-native find:** The Tauri WebKitGTK webview doesn't expose the browser's find bar. Even in browser mode, the native find bar doesn't highlight inside contenteditable well and can't be styled.

**Scope:** Find only, no replace. The editor is small and single-file — replace is a power-user feature that can be added later via source mode (where standard textarea find/replace works).

### Keyboard shortcuts

| Shortcut                                                                                                                                                                                                                                                                     | Action           | Where                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Ctrl+Z` / `Cmd+Z`                                                                                                                                                                                                                                                           | Undo             | Editor (WYSIWYG + source)                                                                                                     |
| `Ctrl+Y` / `Cmd+Y`                                                                                                                                                                                                                                                           | Redo             | Editor (WYSIWYG + source)                                                                                                     |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z`                                                                                                                                                                                                                                               | Redo (alternate) | Editor (WYSIWYG + source)                                                                                                     |
| `Ctrl+F` / `Cmd+F`                                                                                                                                                                                                                                                           | Open find bar    | Editor (WYSIWYG + source)                                                                                                     |
| `Escape`                                                                                                                                                                                                                                                                     | Close find bar   | Find bar focused                                                                                                              |
| `Enter`                                                                                                                                                                                                                                                                      | Next match       | Find bar focused                                                                                                              |
| `Shift+Enter`                                                                                                                                                                                                                                                                | Previous match   | Find bar focused                                                                                                              |

These shortcuts must be intercepted before the browser handles them. `Ctrl+Z` in particular must call `event.preventDefault()` to block the native DOM undo. Currently `handleEditorKeyDown()` at `amorist-editor.js:180-189` ignores all modifier key combos (`if (event.ctrlKey || event.metaKey || event.altKey ...) return`). The new shortcuts require handling modifier combos instead of ignoring them.

---

## Detailed Changes

### 1. Undo/Redo history module

**No new file and no public editor API.** The history logic lives inside `amorist-editor.js` as a small class `MarkdownHistory`, co-located with the editor that uses it. No production module outside `AmoristEditor` should call it. For direct unit tests only, expose it through `window.AmoristInternals.MarkdownHistory`; do not document it in the embedded editor public API.

```
class MarkdownHistory {
  constructor(maxEntries, maxCodeUnits) {
    this.entries = [];
    this.index = -1;
    this.maxEntries = maxEntries;        // 100
    this.maxCodeUnits = maxCodeUnits;    // 50 * 1024 * 1024
    this.totalCodeUnits = 0;
  }

  push(markdown) {
    if (this.index >= 0 && this.entries[this.index] === markdown) return;
    // Discard forward history
    while (this.entries.length > this.index + 1) {
      this.totalCodeUnits -= this.entries.pop().length;
    }
    // Enforce approximate memory cap
    while (this.totalCodeUnits + markdown.length > this.maxCodeUnits && this.entries.length > 0) {
      this.totalCodeUnits -= this.entries.shift().length;
      this.index--;
    }
    // Enforce entry cap
    while (this.entries.length >= this.maxEntries) {
      this.totalCodeUnits -= this.entries.shift().length;
      this.index--;
    }
    this.entries.push(markdown);
    this.totalCodeUnits += markdown.length;
    this.index = this.entries.length - 1;
  }

  undo() {
    if (this.index <= 0) return null;
    this.index--;
    return this.entries[this.index];
  }

  redo() {
    if (this.index >= this.entries.length - 1) return null;
    this.index++;
    return this.entries[this.index];
  }
}

Internals.MarkdownHistory = MarkdownHistory;
```

**Integration in the `AmoristEditor` constructor** (`amorist-editor.js`):

```
this.history = new MarkdownHistory(100, 50 * 1024 * 1024);
this.historyTimer = null;
```

After `setMarkdown()` in the constructor (line 52), push the initial state:

```
this.history.push(this.markdown);
```

**Debounced push in `emitChange()`** (lines 220-224):

```
emitChange() {
  if (typeof this.options.onChange === "function") {
    this.options.onChange(this.markdown);
  }
  clearTimeout(this.historyTimer);
  this.historyTimer = setTimeout(() => {
    this.history.push(this.markdown);
  }, 500);
}
```

Also add timer cleanup in `destroy()`:
```javascript
destroy() {
  clearTimeout(this.historyTimer);
  this.container.replaceChildren();
}
```

**Undo/redo methods:**

```
undo() {
  // Flush any pending debounced push so we undo from the latest state
  clearTimeout(this.historyTimer);
  this.history.push(this.markdown);
  var previous = this.history.undo();
  if (previous === null) return;
  this.restoreHistoryMarkdown(previous);
}

redo() {
  clearTimeout(this.historyTimer);
  var next = this.history.redo();
  if (next === null) return;
  this.restoreHistoryMarkdown(next);
}

restoreHistoryMarkdown(markdown) {
  this.isSyncing = true;
  this.surface.innerHTML = MarkdownCodec.renderMarkdown(markdown);
  this.source.value = markdown;
  this.markdown = markdown;
  this.isSyncing = false;
  if (this.findBar && !this.findBar.hidden) {
    this.performFind();
  }
  if (typeof this.options.onChange === "function") {
    this.options.onChange(this.markdown);
  }
}
```

`restoreHistoryMarkdown()` calls `onChange` so the app shell updates dirty state, but it does not call `emitChange()`, so it does not schedule a new history push. If the find bar is open when undo/redo fires, `performFind()` re-highlights matches against the restored content; the previous `<mark>` elements are destroyed by the `innerHTML` rebuild.

**Success criteria:** `Ctrl+Z` undoes the last change. `Ctrl+Y` re-applies it. History survives mode switches. 100 entries max, ~50 million UTF-16 code units total. Undo to the initial loaded state shows "Saved" in the status bar (not dirty).

---

### 2. Keyboard shortcut handling

**File:** `web/editor/amorist-editor.js`, method `handleEditorKeyDown()` (lines 180-189).

Current code rejects all modifier combos:

```
if (this.mode !== "wysiwyg" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
  return;
}
```

Replace with a handler that intercepts editor shortcuts BEFORE falling through to the existing markdown-shortcut logic:

```
handleEditorKeyDown(event) {
  if (this.handleEditorShortcut(event)) return;

  // Existing WYSIWYG-only shortcuts (space, enter)
  if (this.mode !== "wysiwyg" || event.altKey || event.isComposing || event.ctrlKey || event.metaKey) {
    return;
  }
  if (event.key === " ") {
    this.editing.applySpaceMarkdownShortcut(event);
  } else if (event.key === "Enter") {
    this.editing.applyEnterMarkdownShortcut(event);
  }
}

handleEditorShortcut(event) {
  var mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey || event.isComposing) return false;

  // Undo: Ctrl+Z
  if (mod && !event.shiftKey && event.key === "z") {
    event.preventDefault();
    this.undo();
    return true;
  }
  // Redo: Ctrl+Y or Ctrl+Shift+Z
  var isRedo = event.key === "y" || (event.shiftKey && (event.key === "z" || event.key === "Z"));
  if (isRedo) {
    event.preventDefault();
    this.redo();
    return true;
  }
  // Find: Ctrl+F
  if (mod && !event.shiftKey && event.key === "f") {
    event.preventDefault();
    this.openFindBar();
    return true;
  }
  return false;
}
```

Note: `handleEditorKeyDown` is currently only bound to `this.surface` (the contenteditable div). For undo/redo to work in source mode too, also bind a keydown listener to `this.source` (the textarea). The listener should only handle undo/redo/find — not the WYSIWYG markdown shortcuts.

```
// In bind():
this.source.addEventListener("keydown", (event) => this.handleSourceKeyDown(event));

// New method:
handleSourceKeyDown(event) {
  this.handleEditorShortcut(event);
}
```

**Success criteria:** `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`, and `Ctrl+F` work in both WYSIWYG and source mode. Native browser undo is blocked. `Ctrl+S` still reaches `app.js` (it's on the `window` listener, not intercepted here).

---

### 3. Find bar UI

**File:** `web/editor/amorist-editor.js` — new DOM element created in the constructor, new methods for open/close/search.

The find bar is a thin input row between the toolbar and the content surface. It is hidden by default and appears when `Ctrl+F` is pressed.

**DOM structure:**

```
this.findBar = document.createElement("div");
this.findBar.className = "amorist-editor-findbar";
this.findBar.hidden = true;

this.findInput = document.createElement("input");
this.findInput.type = "text";
this.findInput.className = "amorist-editor-findbar-input";
this.findInput.placeholder = "Find...";
this.findInput.setAttribute("aria-label", "Find in document");

this.findCount = document.createElement("span");
this.findCount.className = "amorist-editor-findbar-count";

var closeBtn = document.createElement("button");
closeBtn.type = "button";
closeBtn.className = "amorist-editor-findbar-close";
closeBtn.textContent = "×";
closeBtn.title = "Close";
closeBtn.addEventListener("click", () => this.closeFindBar());

this.findBar.append(this.findInput, this.findCount, closeBtn);
```

Inserted in the DOM between toolbar and surface:

```
this.root.append(this.toolbar, this.findBar, this.surface, this.source);
```

**Event handling on find bar:**

```
this.findInput.addEventListener("input", () => this.performFind());
this.findInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    this.closeFindBar();
  } else if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    this.findPrevious();
  } else if (event.key === "Enter") {
    event.preventDefault();
    this.findNext();
  }
});
```

**Methods:**

```
openFindBar() {
  this.findBar.hidden = false;
  this.findInput.focus();
  this.findInput.select();
  this.performFind();
}

closeFindBar() {
  this.findBar.hidden = true;
  this.clearHighlights();
  this.focus();  // return focus to editor surface
}

clearHighlights() {
  this.stripFindMarks();
  this.findMatches = [];
  this.findIndex = -1;
  this.findCount.textContent = "";
}
```

**WYSIWYG mode find** — v1 uses DOM `<mark>` wrappers for portable range-based highlighting. Do not use `window.find()` because it is deprecated and unreliable in embedded webviews. Do not depend on the CSS Custom Highlight API for v1 because support depends on WebKitGTK/Safari versions; it can be added later behind `typeof CSS !== "undefined" && typeof CSS.highlights !== "undefined"`.

**Range-based highlighting algorithm:**

1. Collect all text nodes in the surface via TreeWalker
2. Find all occurrences of the query string (case-insensitive)
3. For each match, wrap the matching range in `<mark class="amorist-find-match">`. **Wrapping order:** collect all match positions first (as `[textNode, startOffset, endOffset]` tuples), then wrap from the last match to the first within each text node. Wrapping front-to-back would split text nodes and invalidate later offsets. Within a single text node with multiple matches, process them in reverse offset order.
4. Track the current match index, add a `amorist-find-current` class to the active one
5. Before serialization (in `syncWysiwygInput` and `getMarkdown`), strip all `<mark class="amorist-find-match">` wrappers
6. Set `isSyncing = true` during mark insertion to prevent onChange loops

**Find state contract:** One-character queries are valid. An empty query (`this.findInput.value.length === 0`) means "no active search": `performFind()` must call `clearHighlights()`, clear the count label, and return. `performFind()` owns stale-highlight cleanup before rebuilding matches; callers should not call `clearHighlights()` first unless they are closing the bar or resetting search state. `stripFindMarks()` only unwraps DOM marks and normalizes text nodes; it does not reset `this.findMatches`, `this.findIndex`, or the count label.

**`performFind()` target shape:**

```
performFind() {
  var query = this.findInput.value;
  if (!query) { this.clearHighlights(); return; }

  if (this.mode === "source") {
    this.performSourceFind(query);
    return;
  }

  // WYSIWYG mode: strip old marks, collect text nodes, find matches, wrap in reverse order
  this.isSyncing = true;
  this.stripFindMarks();
  var matches = collectTextMatches(this.surface, query);
  wrapMatchesReverse(matches);    // wraps <mark class="amorist-find-match">
  this.isSyncing = false;

  this.findMatches = this.surface.querySelectorAll("mark.amorist-find-match");
  this.findIndex = this.findMatches.length > 0 ? 0 : -1;
  this.updateFindHighlight();
  this.updateFindCount();
}

findNext() {
  if (!this.findMatches || this.findMatches.length === 0) return;
  this.findIndex = (this.findIndex + 1) % this.findMatches.length;
  this.updateFindHighlight();
}

findPrevious() {
  if (!this.findMatches || this.findMatches.length === 0) return;
  this.findIndex = (this.findIndex - 1 + this.findMatches.length) % this.findMatches.length;
  this.updateFindHighlight();
}

updateFindHighlight() {
  this.findMatches.forEach(function (m) { m.classList.remove("amorist-find-current"); });
  if (this.findIndex >= 0 && this.findIndex < this.findMatches.length) {
    this.findMatches[this.findIndex].classList.add("amorist-find-current");
    this.findMatches[this.findIndex].scrollIntoView({ block: "nearest" });
  }
  this.updateFindCount();
}

updateFindCount() {
  var total = this.findMatches ? this.findMatches.length : 0;
  this.findCount.textContent = total > 0 ? (this.findIndex + 1) + " of " + total : "";
}
```

`collectTextMatches(surface, query)` walks all text nodes with TreeWalker, finds case-insensitive indexOf matches, and returns `[{node, start, end}, ...]`. `wrapMatchesReverse(matches)` groups matches by node, processes nodes in reverse DOM order, and within each node wraps from last offset to first.

**Source mode find** — highlight matches using the textarea selection API:

1. Find all occurrences of the query in `this.source.value`
2. Store match positions as `[start, end]` pairs
3. Use `this.source.setSelectionRange(start, end)` to select the current match
4. Navigate with Enter/Shift+Enter
5. Show count in `this.findCount` element

No DOM mutation needed for source mode. The textarea selection API is the source-mode equivalent of the WYSIWYG `<mark>` highlights.

**Focus strategy for source-mode find:** Keep focus in the find input so Enter/Shift+Enter continue to navigate. On each navigation, update `this.source.setSelectionRange(start, end)` and scroll the textarea to the match line (`this.source.scrollTop = lineHeight * matchLine`). Do not move persistent focus to the textarea from the find input. If WebKitGTK fails to paint the textarea selection without focus, accept count + scroll-only behavior for v1 rather than breaking find-bar keyboard flow.

**Success criteria:** `Ctrl+F` opens find bar, typing highlights matches in real-time, Enter/Shift+Enter navigates, Escape closes. Match count shows "N of M". Highlights don't corrupt the markdown on save.

---

### 4. Find bar styling

**File:** `web/editor/amorist-editor.css` — append new rules.

```
.amorist-editor-findbar {
  align-items: center;
  background: var(--panel, #fff);
  border-bottom: 1px solid var(--border, #d8dee6);
  display: flex;
  gap: 8px;
  padding: 6px 8px;
}

.amorist-editor-findbar[hidden] {
  display: none;
}

.amorist-editor-findbar-input {
  border: 1px solid var(--border, #d8dee6);
  border-radius: 4px;
  font: inherit;
  font-size: 14px;
  min-width: 200px;
  outline: none;
  padding: 4px 8px;
}

.amorist-editor-findbar-input:focus {
  border-color: var(--accent, #246b54);
}

.amorist-editor-findbar-count {
  color: var(--muted, #68717d);
  font-size: 13px;
  white-space: nowrap;
}

.amorist-editor-findbar-close {
  background: transparent;
  border: none;
  color: var(--muted, #68717d);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 2px 6px;
}

.amorist-editor-findbar-close:hover {
  color: var(--text, #1c232b);
}

mark.amorist-find-match {
  background: #fff3cd;
  border-radius: 2px;
  color: inherit;
}

mark.amorist-find-current {
  background: #f0a020;
  color: #fff;
}
```

**App-shell override** (`web/app.css`): The find bar is between toolbar and content surface. In the flex column layout, it's a `flex: none` element. Add:

```
.editor .amorist-editor-findbar {
  flex: none;
}
```

**Success criteria:** Find bar visually matches toolbar style. Highlights are visible (yellow for matches, orange for current). The find bar doesn't break the flex layout.

---

### 5. Mark cleanup for serialization safety

**File:** `web/editor/amorist-editor.js` — modify `syncWysiwygInput()` and `getMarkdown()`.

Before serializing the surface to markdown, all `<mark class="amorist-find-match">` wrappers must be unwrapped (replaced with their text content) to prevent markdown corruption. The marks are purely visual and must not appear in the serialized output.

```
stripFindMarks() {
  this.surface.querySelectorAll("mark.amorist-find-match").forEach(function (mark) {
    mark.replaceWith.apply(mark, Array.from(mark.childNodes));
  });
  this.surface.normalize();  // merge adjacent text nodes
}
```

Call `stripFindMarks()` at the start of `syncWysiwygInput()` and `getMarkdown()` (when mode is WYSIWYG). After stripping, re-apply highlights if the find bar is open and the query is non-empty (call `performFind()` in a microtask to avoid re-entrancy). Keep `stripFindMarks()` deliberately narrow: it only unwraps visual marks and normalizes text nodes. State reset belongs to `clearHighlights()`.

**Serializer interaction:** The serializer's `inlineMarkdown()` at `amorist-markdown-codec.js:300` has a `default` branch that recursively descends into unknown elements, so `<mark>` wrapping `<strong>text</strong>` would serialize as `**text**` — the mark is transparent to serialization. The primary risk is DOM stability: contenteditable may merge or split mark elements during editing, creating orphaned marks or marks that span block boundaries. `stripFindMarks()` + `normalize()` handles this. **Test during implementation:** marks around bold text, inline code, links, and task checkboxes — verify save produces clean markdown in each case.

**Success criteria:** Saving a document while find bar is open produces clean markdown with no `<mark>` tags. Undo history entries contain clean markdown.

---

### 6. Find bar across mode switches

**Files:** `web/editor/amorist-editor.js`, methods `showSourceMode()` and `showWysiwygMode()`.

When the user toggles between WYSIWYG and source mode while the find bar is open, the search must re-run against the new surface. Add a `performFind()` call at the end of each mode-switch method if the find bar is visible:

```
showSourceMode() {
  // ... existing mode switch logic ...
  if (this.findBar && !this.findBar.hidden) {
    this.performFind();
  }
}

showWysiwygMode() {
  // ... existing mode switch logic ...
  if (this.findBar && !this.findBar.hidden) {
    this.performFind();
  }
}
```

The `performFind()` method already branches on `this.mode` internally, so calling it after the mode flag is updated applies the correct strategy (DOM marks for WYSIWYG, selection-range for source).

**Success criteria:** Search for "heading" in WYSIWYG, toggle to source — the find bar stays open, the count updates, and the match is highlighted in the textarea. Toggle back — marks re-appear in the rendered surface.

---

## Edge Cases and Risks

### Risk 1: Undo after mode switch loses caret position

- **Likelihood:** High — every undo calls `setMarkdown()` which rebuilds the surface.
- **Impact:** Caret jumps to the beginning of the document. Annoying but not data-losing.
- **Mitigation:** Accept for v1. Caret restoration requires mapping markdown positions to DOM positions, which is a separate feature. Users can click to reposition.
- **Exit clause:** If users consistently report this as unusable, add markdown-offset-based caret tracking in a follow-up.

### Risk 2: Find marks corrupt serialization

- **Likelihood:** Medium — `<mark>` in the contenteditable DOM can be split, merged, or moved by browser editing operations.
- **Impact:** Highlight wrappers can leave stale DOM state, confuse caret movement, or alter nested inline markup before serialization. The current serializer descends through unknown inline elements, so simple `<mark>` wrappers are usually transparent, but relying on that is fragile.
- **Mitigation:** `stripFindMarks()` before every serialization point. The two serialization entry points are `syncWysiwygInput()` and `getMarkdown()` — both verified by grep: `grep -n 'serializeBlocks' web/editor/amorist-editor.js` returns lines 120 and 199, which are inside these two methods. No other caller exists. Implementation tests must cover bold, inline code, links, and task content while the find bar is open.
- **Exit clause:** If mark cleanup proves fragile, switch to CSS Custom Highlight API (no DOM mutation at all) and drop WebKitGTK < 2.44 support.

### Risk 3: History memory usage on large files

- **Likelihood:** Low — most markdown files are under 100 KB.
- **Impact:** High memory usage (roughly 50-100 MB depending on JavaScript engine string representation and character set) on very large files.
- **Mitigation:** ~50 million UTF-16 code-unit cap + 100 entry cap. Oldest entries are dropped first. For a mostly-ASCII 10 MB file, this allows ~5 history entries before eviction begins — limited but functional.
- **Exit clause:** If memory is a concern, switch to a diff-based history (store diffs between entries instead of full snapshots). More complex but O(edit-size) memory per entry instead of O(file-size).

### Risk 4: Debounce makes undo feel wrong

- **Likelihood:** Medium — 500ms debounce means rapid typing followed by Ctrl+Z undoes the entire typing burst, not a single character.
- **Impact:** User surprise — "I only wanted to undo one word."
- **Mitigation:** 500ms is a well-tested value (VS Code uses similar). The `undo()` method flushes the debounce timer before undoing, so the latest state is always captured. If 500ms feels too coarse, it can be tuned down to 300ms.
- **Exit clause:** If character-level undo is needed, switch to operational transforms or a diff-based model. Significantly more complex.

---

## Failure Modes and Degradation

### Find bar in source mode with large files

- **What happens:** User searches in a 5 MB markdown file in source mode.
- **Degraded behavior:** Finding all occurrences requires scanning the entire string on each keystroke. For a 5 MB string, `indexOf` in a loop completes in < 5ms (string search is O(n) and well-optimized in V8/JSC). No degradation expected up to the 10 MB limit.
- **Threshold:** If search takes > 50ms (measured via `performance.now()`), debounce find input by 150ms.
- **Fallback:** None needed — string search is fast enough for 10 MB.

### Find bar in WYSIWYG mode with many matches

- **What happens:** User searches for "e" in a long document — hundreds of matches, each requiring a DOM `<mark>` wrap.
- **Degraded behavior:** Wrapping 500+ matches mutates the DOM heavily. Each wrap is O(1) but 500 wraps + `normalize()` could take 50-100ms, causing a visible jank.
- **Threshold:** 200 matches.
- **Fallback (deferred):** If match count > 200 and DOM marking takes > 50ms (measured in Task 6 implementation), add viewport-limited highlighting as a follow-up: show count but only wrap marks within ±2 screen heights of the current scroll position, re-wrap on scroll. This is NOT part of v1 — v1 wraps all matches unconditionally. The threshold is noted here as the trigger for the optimization.

### Undo on empty history

- **What happens:** User presses `Ctrl+Z` with no changes made.
- **Behavior:** `history.undo()` returns `null`. The `undo()` method does nothing. No error, no feedback.

---

## Open Questions

No blocking open questions remain for v1. The following decisions are settled for this implementation and should not block execution:

1. **CSS Custom Highlight API support:** Use DOM `<mark>` wrapping as the primary v1 strategy because it works on all current targets without version probing. The CSS Custom Highlight API (`CSS.highlights`) would eliminate serialization-safety concerns but requires Chromium 105+ / WebKitGTK 2.44+ / Safari 17.2+. The `::highlight` optimization can be added later behind a feature check: `typeof CSS !== "undefined" && typeof CSS.highlights !== "undefined"`.

2. **Undo granularity trade-off:** The 500ms debounce is a pragmatic choice. Some editors (Notion, Google Docs) use word-boundary detection for smarter grouping. Out of scope for v1 but worth noting as a follow-up improvement.

3. **Find bar behavior during mode switch:** `showSourceMode()` and `showWysiwygMode()` call `performFind()` if the find bar is visible. This keeps the search state across modes.

---

## Task Breakdown

- [ ] Task 1: Add `MarkdownHistory` class to `amorist-editor.js` with push/undo/redo/code-unit-cap logic, and expose it as `window.AmoristInternals.MarkdownHistory` for tests only
- [ ] Task 2: Integrate history into `AmoristEditor` — push on `emitChange` (debounced), initial push in constructor, clear `historyTimer` in `destroy()`
- [ ] Task 3: Add `undo()` and `redo()` methods to `AmoristEditor` — restore markdown, call onChange, suppress history push
- [ ] Task 4: Add shared `handleEditorShortcut(event)` for `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`, and `Ctrl+F`; call it from both WYSIWYG and source mode keydown handlers
- [ ] Task 5: Add find bar DOM structure to `AmoristEditor` constructor — input, count label, close button, event listeners
- [ ] Task 6: Implement `openFindBar()`, `closeFindBar()`, `clearHighlights()`, `performFind()`, `findNext()`, `findPrevious()` for WYSIWYG mode; one-character queries are valid and an empty query clears search state
- [ ] Task 7: Implement find for source mode (selection-range-based)
- [ ] Task 8: Add narrow `stripFindMarks()` DOM cleanup and call it before serialization in `syncWysiwygInput()` and `getMarkdown()`; keep search-state reset in `clearHighlights()`
- [ ] Task 9: Add find bar and highlight CSS to `amorist-editor.css`, flex override in `app.css`
- [ ] Task 10: Handle find bar across mode switches — re-run find on toggle
- [ ] Task 11: Add `MarkdownHistory` unit test to `tests/` — load `web/editor/amorist-editor.js` in a `node:vm` context with minimal stubs for required editor dependencies, read `window.AmoristInternals.MarkdownHistory`, and exercise push/undo/redo/code-unit-cap/entry-cap. Run via `node tests/editor-history.test.js`.
- [ ] Task 12: Extend `tests/app-shell-smoke.test.js` with undo/redo and find smoke checks — verify Ctrl+Z reverts a typed change, Ctrl+F opens find bar, typing a query highlights matches, Escape closes. These require the full browser environment (Chromium via the existing smoke harness, gated by `AMORIST_RUN_BROWSER_SMOKE=1`).
- [ ] Task 13: Manual test: find in WYSIWYG with marks around bold, code, links, task checkboxes — save and verify clean markdown. Find in source — verify match navigation scrolls textarea.

Dependencies: Tasks 1-3 are sequential (history core → integration → methods). Task 4 depends on Task 3. Tasks 5-7 are sequential (DOM → WYSIWYG find → source find). Task 8 depends on Task 6. Task 9 is independent (CSS). Task 10 depends on Tasks 6-7. Tasks 11-13 depend on all implementation tasks.
