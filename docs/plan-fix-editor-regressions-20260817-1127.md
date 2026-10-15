# Plan: Fix 0.10.6 Editor Regressions Without Reverting Source Preservation

## How to work with this plan

Sections labeled *(Reviewer surface)* require user input before approval — read them in full.
Sections labeled *(Executor surface)* are the implementer's baseline — reviewers may skip.

For operations (annotate / review / finalize): see the **Operations Guide** appendix at the bottom of this file.

## Context *(Reviewer surface)*

Amorist 0.10.6 at commit `7b541a9` correctly keeps raw Markdown authoritative and,
unlike 0.9.0 at `a9d7e73`, preserves the user's caret and visual document position
when switching WYSIWYG -> Source -> WYSIWYG. That behavior is specified by
`REQ-C1` and the six-case `REQ-C2` matrix in `.qa/qa-contract.yaml`, exercised in
both browser engines by `tests/qa/checks/family-c.js`, and repeated through the
compiled Linux Tauri application. It is a non-negotiable baseline for this work.

The same 0.10.6 renderer introduced three confirmed regressions:

- `web/editor/amorist-editor.js::render()` replaces every rendered source line on
  each transaction and then restores the selection. Ordinary typing therefore
  performs whole-document DOM construction even though the source transaction is
  local.
- `layoutTables()` alternates geometry reads and style writes table by table. A
  document with many tables repeatedly forces synchronous browser layout.
- 0.9.0 rendered fenced code and pipe tables as framed `<pre>` blocks with local
  `overflow:auto`. The 0.10.6 projection emits independent line `<span>` elements
  inside a surface with horizontal overflow hidden, so there is no per-table or
  per-code-block scroll owner and the former block styling no longer applies. The
  fix restores that visual vocabulary but intentionally gives the live wrappers
  horizontal scrolling only (`overflow-x:auto`, `overflow-y:hidden`): a vertically
  scrollable inner wrapper would be mistaken for the document viewport by
  `scrollViewportFor()` and could regress `REQ-C2`.

Measured on 2026-08-17 in Google Chrome 151 at a 1280x800 viewport, using real
`Input.insertText` events through the repository's QA driver:

| Deterministic document | 0.9.0 median per key | 0.10.6 median per key |
| --- | ---: | ---: |
| 500 comparable heading rows, about 26 kB | 4.61 ms | 22.20 ms |
| 1,500 comparable heading rows, about 78 kB | 14.21 ms | 57.17 ms |
| 500 mixed physical lines, about 31 kB | 7.65 ms | 248.09 ms |
| 1,500 mixed physical lines, about 94 kB | 19.71 ms | 1,768.00 ms |

An isolated 1,500-line 0.10.6 comparison measured 78.68 ms median without pipe
tables and 1,198.84 ms with a three-row table every 40 lines. This identifies the
table layout loop as the largest multiplier while confirming that whole-document
rendering is independently too expensive. These are component measurements in
Chrome, not claims about absolute WebKitGTK/Tauri timings; the execution phase
adds engine-blind WebKitGTK and Chromium measurements and a deterministic Tauri
IPC assertion.

The checkout already contains user-owned modifications to
`takeaway-qa-architect-evidence.md` and `takeaway-qa-architect-lessons.md`, plus
untracked historical plan files. They remain outside this plan. Implementation,
verification, versioning, committing and publication are separate authorities:
this plan authorizes local product/test implementation and verification only; it
does not authorize a version bump, commit, push, package publication or release.

## Interpretation Log *(Reviewer surface)*

The owner confirmed every interpretation below on 2026-08-17.

- **Read "resolve the regressions" as restoring the reported table containment,
  fenced-code presentation and typing responsiveness, plus adding a regression
  shield for those properties.**
  - Alternatives considered: reproduce every 0.9.0 pixel; broadly redesign the
    editor UI.
  - Consequence of each: chosen -> restores the lost behavior without importing
    0.9.0 source corruption; pixel reproduction -> freezes unrelated historical
    details and conflicts with the line-faithful projection; redesign -> expands
    scope beyond observed regressions.
  - **Confirmed by the owner.**
- **Read "we cannot return to 0.9.0" as preserving the 0.10.6 raw-source model,
  local transactions, recovery, structural editing and all 28 existing `.qa`
  requirements.**
  - Alternatives considered: restore the 0.9.0 DOM serializer; retain 0.10.6
    behavior only for view switching.
  - Consequence of each: chosen -> fixes UX without weakening file safety;
    serializer restoration -> reintroduces unrelated source changes; partial
    retention -> knowingly reopens already-fixed 0.10.x regressions.
  - **Confirmed by the owner.**
- **Read the view-position requirement as exact preservation of the current
  `REQ-C1` character mapping and `REQ-C2` start/middle/end x short/long matrix,
  in both directions and in the compiled Linux application.**
  - Alternatives considered: retain only the same approximate paragraph;
    preserve caret identity but not the viewport midpoint.
  - Consequence of each: chosen -> the same text remains visible across every
    switch as in 0.10.6; approximate paragraph -> permits visible jumps; caret-only
    -> passes identity while making the user hunt vertically.
  - **Confirmed by the owner.**
- **Read "prepare and implement" as local implementation after this plan passes
  the plan-cycle approval gate, without implicit release actions.**
  - Alternatives considered: version/build/commit/push automatically; produce a
    plan with no implementation.
  - Consequence of each: chosen -> completes the code and verification while
    preserving publication control; automatic release -> exceeds the request;
    plan-only -> leaves the requested fix undone.
  - **Confirmed by the owner.**

## Approach *(Reviewer surface)*

Amend the approved QA contract before changing checks. Add two blocking
requirements and two product risks:

- `REQ-B8` / `R-019`: every pipe table and fenced code block is one visually
  framed, independently horizontally scrollable WYSIWYG block. A wide block
  scrolls locally; the document surface and other blocks do not move. Table
  alignment remains display-only and source bytes remain unchanged.
- `REQ-B9` / `R-020`: ordinary within-line typing updates only its affected
  projection unit. On deterministic 500- and 1,500-line mixed documents, measure
  a plain-text target and a table-cell target separately: each gets 3 warm-ups
  and 20 real key events, with p95 event-to-next-frame budgets of 50 ms and 100 ms
  respectively in WebKitGTK and Chromium. Compute each p95 by sorting its 20
  samples and taking the 19th value (nearest-rank method). An untouched row
  outside the affected projection unit must keep the same DOM identity, so a fast
  machine cannot hide full-document replacement.

Keep `DocumentModel`, its raw/display mappings and transaction journal as the
source authority. Do not optimize that model speculatively. Instead, remove the
known dominant work from the input path:

1. Retain full rendering for initial open, explicit `setMarkdown`, Source ->
   WYSIWYG switching and structural transactions that add/remove physical lines or
   change a table/fence boundary. The owner explicitly accepted one full render
   for these structural gestures; stable same-line typing may never use it.
2. For same-line edits whose projection envelope is stable, replace only the
   affected source-line DOM node. For an edit inside a pipe table, rebuild and
   realign only that table wrapper. For an edit inside fenced code, replace only
   the affected code line inside its existing wrapper.
3. Keep a current `sourceLines` descriptor array and row-node index so the local
   patch path locates and replaces only the affected projection unit without the
   `render()` rebuild or `layoutTables()` document-wide query. Do not treat
   `selectionRaw()` -> `rawPoint()` as a full-document bottleneck: it already
   walks only the selected node's ancestors. Preserve the non-hot-path behavior
   of `setSurfaceSelection()`, `wysiwygViewportAnchor()`,
   `restoreWysiwygViewportAnchor()` and `handleClick()` against the new
   row/wrapper structure; existing `data-line` anchors remain available to
   `REQ-C2` and task clicks continue to resolve current raw offsets.
4. Group table rows and fenced-code lines in explicit block wrappers. Restore the
   established 0.9.0 visual vocabulary (light background, 1 px border, 8 px
   radius, 16 px padding) while keeping 0.10.6 line/source spans inside them. This
   is intentionally vocabulary-level continuity, not a pixel-perfect 0.9.0 copy.
5. Measure all table cells first, then apply all padding writes. Never read
   geometry after a style write in the same table-layout pass; ordinary typing
   outside a table performs no table geometry work.
6. Synchronize Tauri dirty state only when the Boolean dirty value changes. The
   first edit sends `set_dirty(true)` and Save/reload sends `set_dirty(false)`;
   subsequent keys while already dirty send no redundant IPC.

The performance limits are QA completion gates, not targets to game. If the local
DOM patch is correct but either 1,500-line p95 remains above 100 ms, profile the
measured handler phases. Only if `DocumentModel.rebuildProjection()` consumes at
least 25% of event handling may its dense maps be replaced with an incremental
per-line index; otherwise optimize the measured dominant phase. Do not loosen the
contract, skip an engine or restore native DOM-to-Markdown serialization.

## Decisions I Need From You *(Reviewer surface)*

None.

On 2026-08-17 the owner explicitly authorized the `.qa` amendment and confirmed:
50 ms/100 ms p95 as blocking thresholds; 0.9.0 visual vocabulary without
pixel-perfect reproduction; preservation of the complete 0.10.6 source and view
continuity baseline; eight compiled-Tauri `REQ-C2` scenarios; dirty IPC only on
Boolean transitions; at most one full render for structural gestures; and local
implementation/verification without version bump, commit, push, packaging or
release. Changing any of those boundaries requires a new explicit amendment or
authorization.

## Detailed Changes *(Executor surface)*

### Contract, risks and generated QA specification

- Add a dated, owner-authorized amendment to `.qa/qa-contract.yaml` explaining
  that source fidelity and view continuity are necessary but insufficient when
  the renderer loses established visual containment or exceeds interactive input
  budgets.
- Add `REQ-B8` and `REQ-B9` exactly as defined in the reviewer surface, including
  viewport, fixture sizes, warm-up/sample counts, p95 limits, per-engine evidence,
  DOM-locality evidence and source-byte invariants.
- Add `R-019` and `R-020` to `.qa/risk-register.yaml`; map them to the two new
  requirements. The amendment and `.qa/architecture.md` must state the repository
  convention explicitly: `.qa/risks.yaml` is the frozen Discovery log, while
  post-Discovery product risks are added directly to the risk register, as
  already done for `R-016` through `R-018`. This keeps the declared traceability
  chain coherent without rewriting the frozen log. Also document the
  projection-unit boundary, allowed full-render cases, local-patch rule and
  two-phase layout rule.
- Regenerate `.qa/contract.json` and `.qa/eval-matrix.md` with
  `python3 .qa/tools/render-eval-matrix.py`; never edit generated content by hand.
- Files: `.qa/qa-contract.yaml`, `.qa/risk-register.yaml`,
  `.qa/architecture.md`, `.qa/contract.json`, `.qa/eval-matrix.md`.

- Target shape:

  ```yaml
  - id: REQ-B8
    severity: blocking
    automation: full
  - id: REQ-B9
    severity: blocking
    automation: full
  ```

- **User-visible success criterion:** a release cannot report green if tables or
  code blocks lose their local frame/scrolling, ordinary typing replaces the
  whole projection, WebKitGTK or Chromium misses the latency budget, or any of
  the 28 pre-existing requirements regresses.

### Projection units and local rendering

- Split `render()` into a full-projection coordinator and focused helpers:
  `buildProjection()`, `renderSourceLine()`, `renderTableBlock()`,
  `renderCodeBlock()` and `patchProjection(transaction, selection)` (names may
  vary, responsibilities may not). Keep the full-render fallback decision explicit
  in the projection-update path; optional diagnostics may log its reason there,
  but no dedicated reason-producing helper is required.
- Maintain one ordered line descriptor array and one row-node array/map for the
  active projection. Resolve raw offsets to line indices with binary search over
  current line starts. A DOM row keeps `data-line` for viewport checks; start/end
  offsets come from the current line descriptor rather than stale DOM attributes.
- Route `apply()`, undo and redo through one projection-update path. A same-line
  edit patches its row or enclosing table/code wrapper. A newline delta,
  cross-line selection, paste containing line endings, or change in table/fence
  membership takes one explicit full-render fallback, with no retry render.
- Do not assign the complete `textarea.value` on every WYSIWYG key. Populate it
  on initial load, explicit full render and immediately before Source becomes
  visible; raw Markdown remains in `DocumentModel` throughout.
- Preserve `selectionRaw()`, marker-aware caret placement, WebKitGTK's structural
  Backspace fallback, inline-format boundaries, task clicks, undo/redo and find.
- Files: `web/editor/amorist-editor.js`, optionally
  `web/editor/amorist-document-model.js` only if the measured 25% exit clause is
  met.
- Target shape:

  ```javascript
  apply(start, end, replacement, gesture) {
    const before = this.captureProjectionEnvelope(start, end);
    const entry = this.model.transaction(start, end, replacement, gesture);
    this.updateProjection(before, entry);
    this.emitChange();
  }
  ```

- **User-visible success criterion:** while typing continuously in prose, a list,
  a code block or a table cell, each character appears at the visible caret on
  the next animation frame; an untouched row retains DOM identity; the 500-line
  and 1,500-line p95 values remain at or below 50 ms and 100 ms respectively; and
  source bytes plus undo/redo remain exact.

### Table and fenced-code block presentation

- Render each recognized pipe table inside one
  `.amorist-wysiwyg-table-block`; render each fenced region, including backtick
  and tilde fences and info strings, inside one `.amorist-wysiwyg-code-block`.
  Preserve an `.amorist-source-line[data-line]` descendant for every physical
  source line so selection and viewport anchors remain line-addressable.
- Apply `max-width:100%`, `overflow-x:auto`, `overflow-y:hidden`, a 1 px border,
  8 px radius, 16 px padding, monospace text and the existing neutral background
  to both wrappers. Inline code keeps its current inline treatment.
- Treat the two wrappers as editor-only projection classes, not as output from
  `MarkdownCodec.renderMarkdown()`. Consolidate their common frame values with
  the existing `.amorist-editor-surface pre` rule so the visual vocabulary has
  one definition; keep `.amorist-markdown-table` only as an explicitly commented
  compatibility extension for codec-rendered preview/round-trip content. The
  live wrappers override the shared overflow with horizontal-only scrolling, so
  three divergent table/code framings do not accumulate.
- Keep table source spelling untouched, including ragged spacing, escaped pipes,
  emoji/wide glyphs and blank lines accepted by `TableCodec`. Alignment remains
  visual only.
- Replace `layoutTables()` with a block-scoped two-phase pass: collect all natural
  cell widths without writes, calculate column maxima, then write padding. A
  document-level initial layout batches all tables into the same read phase; a
  local table edit lays out only that wrapper.
- Files: `web/editor/amorist-editor.js`,
  `web/editor/amorist-editor.css`.
- **User-visible success criterion:** the user sees a table and code block with
  the agreed 1 px border, 8 px radius and 16 px padding; a block wider than the
  editor has its own horizontal scrollbar, scrolling it leaves the document and
  every other block fixed, and switching views still shows the same physical
  source text.

### Dirty-state hot path

- Make `setDirty(next)` compare `next` with `state.dirty` before mutating it.
  Always refresh the body class, status and buttons, but call
  `backend.syncDirty(next)` only when the Boolean value changed. Because both the
  frontend and Rust `AppState` start clean, initial load sends no redundant
  `set_dirty(false)`; recovery sends one `true`; successful Save or Reload sends
  one `false`; repeated edits, failed Save and a declined conflict overwrite send
  no same-value IPC.
- Add a dedicated Tauri-adapter scenario to the app-shell browser test. Before
  `web/app.js` loads, install a minimal `window.__TAURI__` stub and
  `core.invoke` recorder. The current smoke helper opens the target URL before a
  DevTools socket is attached, so add a separate instrumented-page helper that
  creates `about:blank`, attaches the socket, enables `Page`, calls
  `Page.addScriptToEvaluateOnNewDocument`, and only then navigates to the app.
  Stub `read_document`, `get_version`, `set_dirty`, `save_document`,
  `discard_working_copy` and the event listener used by the scenario; reject any
  unexpected command so missing coverage is visible. After initial load, typing
  20 characters and saving must yield the exact `set_dirty` argument sequence
  `[true, false]`. The normal HTTP-backed smoke scenarios remain intact.
- Files: `web/app.js`, `tests/app-shell-smoke.test.js`.
- **User-visible success criterion:** 20 continuous characters cause one native
  dirty transition rather than 20 calls; Save causes one clean transition; and
  the close guard warns while unsaved content exists but not after Save or Reload.

### Visual, locality and latency regression checks

- Extend `tests/qa/page/harness.html` and `tests/qa/lib/page.js` with engine-blind
  observations for block count/style, independent horizontal scroll state,
  untouched-row DOM identity and event-to-next-animation-frame latency. Checks
  may observe the DOM but may not call editor implementation helpers.
- Add deterministic performance document generation under `tests/qa/lib/` rather
  than placing 1,500 lines in the general corpus. Generate exactly 500 and 1,500
  physical lines using the benchmark's same structural family: prose/list filler,
  one three-row ragged table every 40 lines, no fenced blocks, a unique plain-text
  typing target and a unique cell in one existing table. This keeps the document
  shape directly comparable with the 2026-08-17 table-heavy measurement while
  timing both the cheap and table-layout paths. Exercise prose, list, table-cell
  and fenced-code DOM locality separately with small deterministic fixtures so
  every projection-unit path is covered.
- Add `REQ-B8` cases to `tests/qa/checks/family-b.js`: one narrow table, two wide
  tables, one wide fenced block, backtick/tilde fences, and a source-byte check.
  Assert computed border/padding/radius, local overflow, independent scrollLeft,
  and no surface horizontal scroll. Keep pipe-column alignment owned exclusively
  by `REQ-B5`; the B8 evidence cites the independently green B5 result instead of
  duplicating or redefining its 1 px assertion.
- Add `REQ-B9` cases using 3 warm-up keys and 20 measured keys for each
  engine/size/target combination. Sort each 20-sample set and use sample 19 as
  nearest-rank p95. Record all 160 samples and the eight p95 values in
  `.qa/reports/last-run.json`; fail if either target has a 500-line p95 above
  50 ms or a 1,500-line p95 above 100 ms, if a local gesture replaces projection
  nodes outside its unit, or if typed source is lost/reordered.
- Strengthen `REQ-C2` with one long mixed-geometry case whose viewport midpoint
  falls inside a table and one inside a fenced block, in both directions. Keep
  all existing six position combinations, and add the same two midpoint cases to
  `runTauriAppChecks()` so both browser engines and the compiled Linux application
  run an eight-scenario C2 matrix without replacing the original six.
- Files: `tests/qa/page/harness.html`, `tests/qa/lib/page.js`,
  `tests/qa/lib/performance-fixture.js`, `tests/qa/checks/family-b.js`,
  `tests/qa/checks/family-c.js`, `tests/qa/lib/tauri-app-e2e.js`,
  `tests/app-shell-smoke.test.js`.
- **User-visible success criterion:** the automated report reproduces the 0.10.6
  regressions before product changes, passes after the fix in WebKitGTK and
  Chromium, contains all eight engine/size/target latency verdicts, and proves
  that every forward/back view switch in the eight browser and compiled-app
  scenarios retains the same text and document edge/midpoint.

### Verification and visual acceptance

- Run syntax and focused unit checks before browser QA:
  `node --check` on `web/editor/amorist-editor.js`, `web/app.js`,
  `tests/app-shell-smoke.test.js`, `tests/qa/lib/page.js`,
  `tests/qa/lib/performance-fixture.js`, `tests/qa/checks/family-b.js`,
  `tests/qa/checks/family-c.js` and `tests/qa/lib/tauri-app-e2e.js`, plus
  `web/editor/amorist-document-model.js` if the 25% exit clause activates it;
  `node tests/editor-history.test.js`,
  `node tests/editor-table-codec.test.js`,
  `node tests/editor-toolbar.test.js`,
  `node tests/editor-view-positioning.test.js`, and
  `AMORIST_RUN_BROWSER_SMOKE=1 node tests/app-shell-smoke.test.js`.
- Run `xvfb-run -a node tests/qa/run.js --only B` and `--only C`; do not use an
  engine-specific run as completion evidence.
- Run the full `xvfb-run -a node tests/qa/run.js`, then inspect
  `.qa/reports/last-run.json`. Completion requires exit code 0, both WebKitGTK and
  Chromium named for every A-D requirement, the compiled-Tauri eight-scenario
  `REQ-C2` matrix green, all 160 timing samples and eight p95 values present, and
  no unavailable engine/harness error.
- Run `cargo test` in `src-tauri` and `git diff --check` over intended paths.
- Capture a 1366x860 WYSIWYG screenshot containing a wide table and wide fenced
  block for human inspection. Inspect it at full resolution and record whether
  both blocks have the 1 px frame, 8 px radius and 16 px padding; separately
  exercise each horizontal scrollbar and confirm the other block plus document
  viewport keep `scrollLeft` unchanged. The screenshot is evidence only unless
  the owner separately approves changing tracked README screenshots. Do not claim
  macOS embedding coverage from this Linux run.
- **User-visible success criterion:** opening a representative large Markdown
  document in the built Linux app keeps both plain-text and table-cell typing at
  or below the 50 ms/100 ms p95 budgets, shows the agreed block styling and local
  scrollbars, and returns to the same visible text after two toggles at start,
  middle, end, table and code positions.

## Research Trace *(Executor surface)*

- TokenSave context was queried first for performance, renderer, table/code and
  view-position surfaces. It saved about 9,200 context tokens but reported an
  index 2 days 19 hours old and served `main` because
  `qa/contract-driven-suite` is untracked. Branch claims were therefore verified
  against Git and the checkout.
- `.tokensave/tokensave.db` indexes `web/editor/amorist-editor.js` only as a file
  node and `tokensave_affected` returned zero tests for the four changed frontend
  files. Direct `rg` found the actual affected tests in
  `tests/qa/checks/family-b.js`, `family-c.js`, the page/driver layer,
  `tests/app-shell-smoke.test.js`, `tests/editor-toolbar.test.js` and
  `tests/editor-view-positioning.test.js`.
- `git status --short --branch` verified HEAD `7b541a9`, branch synchronization
  with `origin/qa/contract-driven-suite`, clean product/QA paths, and unrelated
  modified takeaway files plus untracked plan artifacts.
- `.qa/contract.json` currently contains 28 requirements. The last report has
  `exitCode:0`, finished `2026-08-14T09:48:46.300Z`, and records WebKitGTK plus
  Chromium passes for all automated A-D requirements and a compiled-app pass for
  `REQ-C2`; `REQ-G3` remains manual by design.
- `command -v` verified `/usr/bin/google-chrome`, `/usr/bin/WebKitWebDriver` and
  `/usr/bin/xvfb-run` are available locally. There is no `package.json`; the QA
  convention remains Node builtins plus the Rust toolchain.
- The 2026-08-17 benchmark used temporary copies of `a9d7e73` and current HEAD,
  the repository static server and Chromium driver, real input events, fixed
  viewport and deterministic documents. No repository source file was changed by
  the measurement.
- Finalization rechecked `tests/app-shell-smoke.test.js`: `openPage()` creates the
  target URL before attaching its DevTools socket, and neither that helper nor
  `tests/qa/lib/engine-chromium.js` exposes pre-navigation injection. The dirty
  IPC scenario therefore includes the concrete `about:blank` -> attach ->
  `Page.addScriptToEvaluateOnNewDocument` -> navigate harness extension instead
  of assuming an existing hook. `web/app.js` also confirmed frontend and Rust
  dirty state start false, while `tests/qa/lib/tauri-app-e2e.js` confirmed the
  current compiled-app C2 helper owns only the six start/middle/end cases.

## Edge Cases and Risks *(Executor surface)*

- **Mixed LF/CRLF line maps.** Likelihood: medium. Impact: source corruption or
  wrong caret. Mitigation: derive every patched row from raw offsets and current
  physical terminators; run A1-A10 on the existing mixed-ending corpus. Exit
  clause: a structural transaction whose map cannot be patched gets its one
  allowed full render; stable same-line `insertText` may not use that escape and
  fails B9 until its local mapping is corrected. If bytes differ, stop and fix
  before any further optimization.
- **A typed character creates or destroys a table/fence boundary.** Likelihood:
  medium. Impact: stale wrapper or wrong styling. Mitigation: compare projection
  envelope before/after the transaction and full-render on membership change.
  Exit clause: no generic incremental parser; keep this explicit fallback unless
  measured normal usage shows it exceeding the B9 budget.
- **Wrapper nodes disturb selection or viewport geometry.** Likelihood: high.
  Impact: regression of the behavior explicitly retained from 0.10.6. Mitigation:
  keep one addressable source-line descendant per physical line and run C1/C2
  with table/code midpoint cases in WebKitGTK, Chromium and the compiled Tauri
  eight-scenario matrix. Exit clause: if wrappers cannot satisfy C1/C2, flatten
  only their outer visual structure and use a sibling overlay/background; never
  weaken C1/C2.
- **Table width measurement thrashes layout again.** Likelihood: medium. Impact:
  typing pauses on table-heavy files. Mitigation: instrument read/write phases,
  one read batch then one write batch, local table only during edits. Exit clause:
  if table-edit p95 still exceeds 100 ms at 1,500 lines, replace pixel padding
  with a shared CSS-grid/table layout that retains line-addressable wrappers.
- **Performance thresholds vary with host load.** Likelihood: medium. Impact:
  flaky gate. Mitigation: page-internal event-to-frame timing, 3 warm-ups, 20
  samples, p95, fixed viewport/content and two engines; DOM locality remains a
  deterministic independent assertion. Exit clause: if 5 clean repeated runs
  vary by more than 25%, retain the DOM-locality gate and collect timing as a
  named blocking harness problem; do not silently raise thresholds.
- **IME/composition differs between engines.** Likelihood: medium. Impact: doubled
  or lost characters. Mitigation: retain `insertCompositionText`, add a focused
  composition transaction check in WebKitGTK and Chromium, and never combine
  native mutation with a second source transaction. Exit clause: if local patching
  cannot preserve an active composition, buffer that composition and commit one
  source transaction at `compositionend`; any doubled/lost source still blocks
  completion, and ordinary `insertText` remains on the local hot path.
- **Dirty-state deduplication misses recovery/close transitions.** Likelihood:
  low. Impact: close without warning or stale warning. Mitigation: assert clean ->
  dirty -> saved, recovery -> dirty and reload -> clean transitions while counting
  IPC. Exit clause: if deduplication in `setDirty()` cannot preserve those flows,
  move the last-sent comparison into the Tauri backend adapter and rerun the same
  transition assertions; do not debounce or restore same-value/per-key calls.

## Failure Modes and Degradation *(Executor surface)*

- A multiline or projection-boundary transaction that cannot be patched safely
  performs at most one explicit full projection render and zero retries. The user
  may see that one full-render duration for the structural gesture; continuous
  `insertText` on a stable line may never take this fallback. Any such ordinary-key
  fallback fails `REQ-B9`.
- If table alignment computation fails, raw Markdown remains authoritative and
  the wrapper stays locally scrollable, but the QA run fails `REQ-B5`/`REQ-B8` and
  blocks local completion and any later release. The implementation does not
  rewrite spacing or hide the error behind unaligned source changes.
- If WYSIWYG rendering throws, existing `REQ-C3` behavior remains: Source is the
  only visible view, exact text and selection are retained, and the user sees the
  explicit warning. No empty editor is permitted.
- If either WebKitGTK or Chromium is unavailable, the run fails under `REQ-G1`;
  one-engine success is not completion. If compiled Tauri cannot execute the
  eight-scenario C2 matrix, the run names the missing prerequisite and release
  remains blocked; no browser-only substitute is accepted.
- If latency exceeds 50 ms p95 at 500 lines or 100 ms p95 at 1,500 lines, the
  report includes all samples and the affected engine. There is no automatic
  retry, threshold increase or advisory downgrade; profile and fix the measured
  phase.

## Task Breakdown *(Executor surface)*

- [ ] Task 1: Apply the approved 2026-08-17 contract/risk/architecture amendment,
  regenerate JSON/matrix artifacts, and verify the generated requirement count is
  30; outcome: B8/B9 are blocking definitions before checks or product code change.
- [ ] Task 2: Add B8/B9 harness observations, deterministic performance fixtures,
  red regression checks, C2 table/code midpoint probes in both browser and
  compiled-Tauri matrices, and the instrumented-page Tauri-adapter dirty-IPC
  assertion with exact `[true, false]` sequence;
  outcome: current 0.10.6 fails for the documented visual/locality/latency reasons
  while the original C1/C2 cases remain green.
- [ ] Task 3: Introduce table/code projection wrappers, restore block styling and
  replace `layoutTables()` with batched block-scoped measurement; outcome: wide
  blocks scroll independently, tables stay aligned, bytes stay identical and
  ordinary non-table typing performs zero table geometry reads.
- [ ] Task 4: Add the line/row projection index, local same-line patch path,
  explicit structural fallback and dirty-state transition deduplication; outcome:
  untouched DOM rows survive each ordinary key, caret/undo/find/structural editing
  remain correct, structural gestures perform at most one full render, and only
  one dirty IPC is sent per Boolean transition.
- [ ] Task 5: Run focused unit/B/C checks and the numeric performance gate; if the
  plain-text or table-cell 1,500-line p95 misses 100 ms, apply the measured 25%
  model-optimization exit clause and rerun without changing the contract; outcome:
  WebKitGTK and Chromium pass B8/B9, all original C1/C2 cases remain green and the
  two new C2 wrapper cases pass in browser and compiled-Tauri matrices.
- [ ] Task 6: Run full Linux QA, compiled-Tauri checks, Rust tests, diff checks and
  the 1366x860 screenshot/built-app acceptance checklist; outcome: all 30 declared
  requirements have their intended evidence, every automated blocking requirement
  is green, the eight latency verdicts meet their limits, and the user observes the
  agreed frame/scroll behavior plus exact round-trip view position. Do not create
  a version, commit, push, package or release in this task.

---

## Operations Guide *(Appendix — instructions for any agent operating on this plan)*

Operations available on this plan. Any coding agent can follow these instructions.

## Operation Dispatch Rule

Identify the requested operation by the user's **exact** wording:

- `plan-cycle-annotate` → run section `## plan-cycle-annotate`.
- `plan-cycle-review` → run section `## plan-cycle-review`.
- `plan-cycle-finalize` → run section `## plan-cycle-finalize`.

**No aliases.** If wording doesn't exactly match one of the three, do NOT execute: reply

> Operazione non riconosciuta. Le operazioni valide su questo piano sono: `plan-cycle-annotate`, `plan-cycle-review`, `plan-cycle-finalize`.

Existing `> **NOTE**:` lines don't change the requested operation. For `plan-cycle-annotate`, never edit/remove/resolve/rewrite existing plan content.

## Grilling discipline

When an operation needs decisions from you, it grills — it resolves the decision tree in waves, never as a flat dump:

- **Per wave, ask only mutually independent (orthogonal) questions.** Two questions are dependent — and MUST NOT share a wave — if the answer to one would change the answer to the other, or change whether the other still needs asking. Independent questions don't influence each other, so they may be grouped (a handful at most).
- **Walk the tree in waves.** Answer the current orthogonal set, follow the branches the answers open, and let the newly-unblocked questions form the next wave. Repeat until no branch is left open.
- **Every question carries a recommended answer** (the planner's default) with a one-line why.
- **Explore before asking.** If the codebase or the plan can answer it, investigate and state the finding instead of asking.

## plan-cycle-annotate

Add inline annotations below the section/task they refer to. Do NOT modify plan content — only add notes.

**Format:** `> **NOTE**: [tag?] comment`. Tags: `[impact]` (plan-impact skill), `[quality: <criterion>]` (plan-quality skill), none (user). `plan-cycle-review` processes all uniformly.

**Safety check:** before editing, state "plan-cycle-annotate mode: I will only add `> **NOTE**:` lines." After editing, verify the diff only adds notes + blank spacing; if it removes/modifies non-note text, revert and redo.

## plan-cycle-review

1. Read the entire plan.
2. Find all `> **NOTE**:` lines.
3. For each: understand, update plan, remove annotation.
4. If unclear, keep the annotation and resolve it via the **Grilling discipline** (above).

## plan-cycle-finalize

Make the plan operative, self-contained, coherent, robust — a fresh agent must execute it without prior context.

1. Read the entire plan.
2. For each section, check ALL 11 rules: Self-contained, Operative, Outcome-layer success, Numbers-not-adjectives, Exit clauses, Explicit degradation, Verify-before-claim, Enumerate-universals, Mark-unverifiable, Coherent, Robust.
3. Rewrite every failing section — do not annotate.
4. Report: sections updated count + one-line summary per section.
5. **Unresolved Items Inventory** — list every remaining TODO, `assumed:`, `unverified:`. For each, prompt the user per item via the **Grilling discipline** (above): *resolve before execution* or *proceed knowingly with consequence stated*. Approval is invalid without this step.

## General Principles

- `plan-cycle-annotate` may only add `> **NOTE**:` annotations — never rewrites.
- `plan-cycle-review` and `plan-cycle-finalize` rewrite plan content directly.
- Multiple annotate passes can run before a single review pass.
- The plan is approved only when the owner explicitly says so.
