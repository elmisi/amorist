# EL-173 — WYSIWYG ↔ source positioning

**Card:** EL-173-posizionamento-wysisyg-source · label `amorist`
**Branch:** `feature/el173-view-positioning`
**Date:** 2026-05-26

## Problem

Switching between WYSIWYG and source view should keep the viewport on essentially the same portion of text, with minimal drift. Today there is noticeable drift.

### Current behaviour

`amorist-editor.js:501` `captureScrollPosition` / `restoreScrollPosition`:

- Capture anchors on the **topmost** visible block (`getBoundingClientRect().bottom > surfaceTop`), reads its `data-source-line`.
- Restore (source) sets `scrollTop = line * lineHeight`; restore (WYSIWYG) sets `scrollTop = target.offsetTop`, with a percentage fallback.

Drift sources: long blocks and wrapped lines make "block top → source line × lineHeight" approximate; anchoring at the very top amplifies the error across the visible region.

## Decision (from brainstorming)

Anchor on the line displayed at the **middle of the page**: whatever sits mid-viewport in WYSIWYG should sit mid-viewport in source, and vice versa. Tune empirically ("try it and see").

## Approach

### Capture (mid-viewport)

- **WYSIWYG → :** compute the viewport mid-line `midY = surfaceRect.top + surfaceClientHeight / 2`. Pick the block whose box straddles `midY` (`rect.top <= midY < rect.bottom`); read its `data-source-line`. Refine within the block when feasible (proportional position inside a multi-line block) to reduce drift; otherwise the block's start line.
- **source → :** `midLine = floor((scrollTop + clientHeight / 2) / lineHeight)`.

Keep the `progress` ratio as a fallback for when no anchor line resolves.

### Restore (center the anchor)

- **→ source:** `scrollTop = midLine * lineHeight - clientHeight / 2`, clamped to `[0, scrollHeight - clientHeight]`.
- **→ WYSIWYG:** find the block for the anchor line (`blockForSourceLine`), then `scrollTop = block.offsetTop + block.offsetHeight/2 - clientHeight/2`, clamped. Fall back to `scrollHeight * progress` when no block matches.
- Keep the double `requestAnimationFrame` restore (layout settle) already in place.

This is intentionally a refinement of the existing mechanism (same `data-source-line` anchoring), changing the anchor point from top to center and centering on restore.

## Components touched

| Component | Change |
|-----------|--------|
| `web/editor/amorist-editor.js` | rewrite `captureScrollPosition` / `restoreScrollPosition` to mid-viewport anchoring; clamp helpers |

No new modules.

## Testing

- Unit (where DOM shim allows): mid-line math for source given `scrollTop`, `clientHeight`, `lineHeight`; clamping at top/bottom edges.
- Manual: on a long document, scroll so a known heading sits mid-screen, toggle view, confirm the same heading is near mid-screen (minimal drift) both directions. Iterate on the centering offset if needed.

## Out of scope

- Caret-following on view switch (decision was scroll/viewport-based, not caret-based).
- Smooth-scroll animation.

## Versioning

PATCH/MINOR bump (behavioural improvement). Update `VERSION` + `CHANGELOG.md`.
