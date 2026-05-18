# Decision: Keep `document.execCommand` Behind EditingPolicy

Date: 2026-05-18

## Context

The editor still uses a classic-script, no-build browser runtime. Toolbar commands now live behind `window.AmoristInternals.EditingPolicy`, so `AmoristEditor` owns lifecycle and mode switching while the policy owns editable-surface mutations.

Current `document.execCommand` calls are:

- `bold`
- `italic`
- `formatBlock` for `h1`, `h2`, `h3`, and `blockquote`
- `insertUnorderedList`
- `insertOrderedList`
- `createLink`
- `insertHTML` for task items
- `insertHTML` for fenced code blocks
- `insertText` for plain-text paste

## Decision

Keep `document.execCommand` for the toolbar and paste commands for now.

The replacement would need custom DOM/range implementations for inline marks, links, headings, lists, quotes, task insertion, code block insertion, and paste insertion. That would exceed the 150-line replacement threshold and would duplicate browser editing behavior that is currently isolated behind `Internals.EditingPolicy`.

## Evidence

- Static checks cover the extracted policy and editor load order through `node --check`.
- Persistent codec tests cover Markdown table and render contracts independently of toolbar editing.
- The optional `tests/app-shell-smoke.test.js` can exercise browser save/reload behavior in a Chromium-compatible browser.

## Next Action

Replace individual commands only if a target browser breaks a core toolbar behavior or tests show inconsistent serialization for bold, italic, headings, lists, quote, link, task item, code block, or paste. Any replacement should happen inside `Internals.EditingPolicy`, not in `AmoristEditor`.
