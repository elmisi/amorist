# EL-173 — WYSIWYG ↔ source positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When toggling between WYSIWYG and source views, keep the line shown at the *middle* of the viewport aligned across both views, minimizing drift.

**Architecture:** Refine the existing `captureScrollPosition`/`restoreScrollPosition` in `web/editor/amorist-editor.js`. Change the anchor from the topmost visible block to the block/line crossing the vertical center of the viewport, and on restore center that anchor line. Extract the line/scroll arithmetic into pure module-level helpers so it is unit-testable without a DOM.

**Tech Stack:** Vanilla JS (classic script, IIFE → `window.AmoristEditor`), `node:vm`-based unit tests, no deps.

**Spec:** `docs/superpowers/specs/2026-05-26-el173-wysiwyg-source-positioning-design.md`

---

### Task 1: Pure helper — mid-viewport source line

**Files:**
- Modify: `web/editor/amorist-editor.js` (add module-level `midViewportLine` near `sourceLineHeight`, ~line 585)
- Test: `tests/editor-view-positioning.test.js` (new)

- [ ] **Step 1: Write the failing test**

```js
// tests/editor-view-positioning.test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadEditorHelpers() {
  // Stub the dependency guards so the IIFE runs in node.
  const window = {
    AmoristInternals: {
      TextUtils: {}, MarkdownCodec: {}, AmoristEditingPolicy: {},
    },
  };
  const context = vm.createContext({ window, console, Intl, document: { querySelector: () => null } });
  vm.runInContext(fs.readFileSync("web/editor/amorist-text-utils.js", "utf8"), context);
  // amorist-editor.js exposes helpers for test via window.__editorTestHelpers
  vm.runInContext(fs.readFileSync("web/editor/amorist-editor.js", "utf8"), context, { filename: "amorist-editor.js" });
  return window.__editorTestHelpers;
}

const h = loadEditorHelpers();

// midViewportLine(scrollTop, clientHeight, lineHeight)
assert.equal(h.midViewportLine(0, 400, 20), 10);      // center at y=200 -> line 10
assert.equal(h.midViewportLine(200, 400, 20), 20);     // scrolled 200 -> center y=400 -> line 20
assert.equal(h.midViewportLine(0, 0, 20), 0);
assert.equal(h.midViewportLine(0, 400, 0), 0);         // guard against /0

console.log("midViewportLine OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/editor-view-positioning.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'midViewportLine')` (helpers not exported yet).

- [ ] **Step 3: Add the helper and a test-only export**

In `web/editor/amorist-editor.js`, add near the other module-level helpers (after `sourceLineHeight`, around line 590):

```js
  function midViewportLine(scrollTop, clientHeight, lineHeight) {
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0;
    const centerY = scrollTop + clientHeight / 2;
    return Math.max(0, Math.floor(centerY / lineHeight));
  }
```

Then, just before the final `window.AmoristEditor = { create };` line, add:

```js
  window.__editorTestHelpers = { midViewportLine };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/editor-view-positioning.test.js`
Expected: `midViewportLine OK`

- [ ] **Step 5: Commit**

```bash
git add web/editor/amorist-editor.js tests/editor-view-positioning.test.js
git commit -m "EL-173: add midViewportLine helper with tests"
```

---

### Task 2: Pure helper — center scroll for a line

**Files:**
- Modify: `web/editor/amorist-editor.js`
- Test: `tests/editor-view-positioning.test.js`

- [ ] **Step 1: Extend the test (failing)**

Append to `tests/editor-view-positioning.test.js`:

```js
// centerScroll(anchorTop, clientHeight, scrollHeight)
// anchorTop = pixel offset of the anchor (line top or block center) in content space
assert.equal(h.centerScroll(500, 400, 2000), 300);   // 500 - 200 = 300
assert.equal(h.centerScroll(100, 400, 2000), 0);      // clamp low
assert.equal(h.centerScroll(1950, 400, 2000), 1600);  // clamp high (scrollHeight - clientHeight)
assert.equal(h.centerScroll(500, 400, 300), 0);       // content shorter than viewport -> 0

console.log("centerScroll OK");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/editor-view-positioning.test.js`
Expected: FAIL — `h.centerScroll is not a function`.

- [ ] **Step 3: Add the helper**

In `web/editor/amorist-editor.js`, after `midViewportLine`:

```js
  function centerScroll(anchorTop, clientHeight, scrollHeight) {
    const max = Math.max(0, scrollHeight - clientHeight);
    return clamp(anchorTop - clientHeight / 2, 0, max);
  }
```

Update the test-only export:

```js
  window.__editorTestHelpers = { midViewportLine, centerScroll };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/editor-view-positioning.test.js`
Expected: `midViewportLine OK` then `centerScroll OK`.

- [ ] **Step 5: Commit**

```bash
git add web/editor/amorist-editor.js tests/editor-view-positioning.test.js
git commit -m "EL-173: add centerScroll helper with tests"
```

---

### Task 3: Capture mid-viewport anchor

**Files:**
- Modify: `web/editor/amorist-editor.js:501-519` (`captureScrollPosition`)

- [ ] **Step 1: Rewrite `captureScrollPosition`**

Replace the current method body with:

```js
    captureScrollPosition() {
      if (this.mode === "source") {
        var lineHeight = sourceLineHeight(this.source);
        return {
          line: midViewportLine(this.source.scrollTop, this.source.clientHeight, lineHeight),
          progress: this.source.scrollHeight > 0 ? this.source.scrollTop / this.source.scrollHeight : 0,
        };
      }

      var rect = this.surface.getBoundingClientRect();
      var midY = rect.top + this.surface.clientHeight / 2;
      var midBlock = Array.from(this.surface.children).find(function (child) {
        var r = child.getBoundingClientRect();
        return r.top <= midY && r.bottom > midY;
      }) || Array.from(this.surface.children).find(function (child) {
        return child.getBoundingClientRect().bottom > midY;
      });

      return {
        line: midBlock ? Number(midBlock.dataset.sourceLine || 0) : 0,
        progress: this.surface.scrollHeight > 0 ? this.surface.scrollTop / this.surface.scrollHeight : 0,
      };
    }
```

- [ ] **Step 2: Syntax check**

Run: `node --check web/editor/amorist-editor.js`
Expected: no output (pass).

- [ ] **Step 3: Re-run unit tests (no regression)**

Run: `node tests/editor-view-positioning.test.js && node tests/editor-markdown-codec.test.js`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add web/editor/amorist-editor.js
git commit -m "EL-173: capture mid-viewport anchor instead of topmost block"
```

---

### Task 4: Restore by centering the anchor

**Files:**
- Modify: `web/editor/amorist-editor.js:521-543` (`restoreScrollPosition`)

- [ ] **Step 1: Rewrite `restoreScrollPosition`**

Replace the current method body with:

```js
    restoreScrollPosition(position) {
      if (!position) return;
      var self = this;

      var restore = function () {
        if (self.mode === "source") {
          var lineHeight = sourceLineHeight(self.source);
          var lineTop = position.line * lineHeight;
          self.source.scrollTop = centerScroll(lineTop, self.source.clientHeight, self.source.scrollHeight);
          return;
        }

        var target = blockForSourceLine(self.surface, position.line);
        if (target) {
          var anchorTop = target.offsetTop + target.offsetHeight / 2;
          self.surface.scrollTop = centerScroll(anchorTop, self.surface.clientHeight, self.surface.scrollHeight);
          return;
        }

        self.surface.scrollTop = self.surface.scrollHeight * position.progress;
      };

      restore();
      window.requestAnimationFrame(restore);
    }
```

- [ ] **Step 2: Syntax check**

Run: `node --check web/editor/amorist-editor.js`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add web/editor/amorist-editor.js
git commit -m "EL-173: center the anchor line on view restore"
```

---

### Task 5: Manual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Launch the app on a long document**

Run (under a real terminal/PTY per the global rule):
`cd src-tauri && cargo tauri dev -- -- ../tests/fixtures/<a long .md file>`
(If no long fixture exists, open any long markdown file.)

- [ ] **Step 2: Verify centering both directions**

- Scroll so a recognizable heading sits at mid-screen in WYSIWYG. Toggle to source (toolbar "source" button). Confirm the same heading text is near the vertical center (minimal drift).
- Scroll in source so a known line is mid-screen. Toggle back to WYSIWYG. Confirm the corresponding block is near center.
- Repeat near the top and bottom of the document (clamping should not over/under-scroll).

- [ ] **Step 3: If drift is too large, tune**

The empirical knob is the anchor offset. If WYSIWYG→source consistently lands too low/high, adjust the proportional position within multi-line blocks (use `target.offsetTop` instead of block center) and re-verify. Record the chosen behavior in a commit message.

- [ ] **Step 4: Version bump + changelog**

Update `VERSION` (MINOR) and add a `CHANGELOG.md` entry describing the centered view-switch positioning. Commit per the semver skill.

```bash
git add VERSION CHANGELOG.md
git commit -m "EL-173: bump version for centered view positioning"
```

---

## Self-Review notes

- Spec coverage: mid-viewport capture (Task 3), centered restore (Task 4), clamp at edges (Task 2 helper), empirical tuning (Task 5) — all covered.
- Types: helpers `midViewportLine`, `centerScroll`, existing `clamp`, `sourceLineHeight`, `blockForSourceLine` used consistently.
- No placeholders.
- Note: DOM-dependent block selection in capture/restore is validated manually (Task 5) since the test harness has no layout engine; pure arithmetic is unit-tested (Tasks 1–2).
