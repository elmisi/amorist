# Plan: Source-preserving Amorist editor

## How to work with this plan

Sections labeled *(Reviewer surface)* require user input before approval — read them in full.
Sections labeled *(Executor surface)* are the implementer's baseline — reviewers may skip.

For operations (annotate / review / finalize): see the **Operations Guide** appendix at the bottom of this file.

## Context *(Reviewer surface)*

`.qa/qa-contract.yaml` is the approved product specification. It requires local,
source-preserving Markdown edits: no unrelated bytes, whitespace, line terminators,
unknown syntax, table spacing or list spelling may change. The executable definition
of done is `tests/qa/` plus the Rust disk-path tests.

Today `web/editor/amorist-editor.js` renders Markdown into `contenteditable` and
`syncWysiwygInput()` replaces the authoritative Markdown with
`MarkdownCodec.serializeBlocks(this.surface)`. The codec normalises input and
reconstructs blocks. That full-DOM round trip is the mechanism behind the red
REQ-A1–A10 failures. `src-tauri/src/lib.rs` also normalises line endings on read
and accepts one line-ending mode on write, so it cannot preserve a mixed-ending file.

REQ-F1/F2 already pass through real-file Rust tests. REQ-E1/E2 are incomplete:
there is no app-owned working copy or application launch/kill test. The QA runner,
contract, fixtures and mutation checks are already built and must remain the oracle.

The branch has unrelated local changes in the two takeaway files and ten untracked
May plan artifacts in `docs/`; this plan neither changes nor stages them.

## Interpretation Log *(Reviewer surface)*

- **Read “conforme alla specifica QA” as meeting every approved blocking product
  requirement, not only reducing the current Linux failures.**
  - Alternatives considered: source preservation only; treat F/G passes as sufficient.
  - Consequence of each: chosen → includes editing, view switching, paste and recovery;
    source-only → leaves D1 and E1/E2 incomplete; current passes → cannot claim release readiness.
  - **Decision (2026-08-13): confirmed by the implementation mandate.** All approved
    blocking product requirements remain in scope.
- **Read the existing QA contract as immutable during implementation unless a new,
  explicit contract amendment is approved first.**
  - Alternatives considered: rewrite checks when implementation needs it; never add a regression case.
  - Consequence of each: chosen → checks remain definition of done; rewrite → risks green-by-weakened-check;
    total ban → prevents recording stable real defects.
  - **Decision (2026-08-13): confirmed by the implementation mandate.** Checks and
    fixtures are not weakened or rewritten to obtain a green result.

## Approach *(Reviewer surface)*

Make source text authoritative. Add a lossless document model that retains the exact
loaded bytes, a display-text projection, a reversible mapping between their offsets,
and source spans. This is required because `<textarea>.value` uses browser newline
normalisation and cannot itself retain CRLF/mixed terminators as the saved authority.
WYSIWYG is an editable projection; each supported gesture creates a local source
transaction with a contract-defined changed range. Source mode maps its displayed
selection and edits back into raw source transactions. Both views re-render from the
same model and map selection through spans. This replaces reconstructing the entire
file from the DOM.

Implement in this order: lossless source and neutral round trips; local editing
transactions; selection and viewport continuity; paste; working-copy recovery; full
contract runs and mutation audit. Keep the gate exactly as approved: checks run on
push, but only release publication is blocked by blocking failures.

## Decisions I Need From You *(Reviewer surface)*

None. The owner resolved all decision points on 2026-08-13:

- An untranslatable WYSIWYG gesture is refused with a Source-view notice; wider/block
  reconstruction is not an authorised fallback. If the same common action is refused in more
  than one corpus family, implement its local transaction before considering broader rendering.
- Recovery may lose at most 2 seconds after the final edit. Measure working-copy persistence on a
  supported release environment; if it exceeds 100 ms p95, use an idle write with a 5-second
  maximum only after an approved contract amendment.
- REQ-A2 receives an approved mechanical structured projection. It preserves every current prose
  allowance and may not enlarge a permitted edit range.

## Detailed Changes *(Executor surface)*

### Lossless document model

- Add `web/editor/amorist-document-model.js` to own the exact loaded source, per-line
  terminators, raw unsupported slices, source spans and revision number.
- Add a structured `allowed_change` declaration to the existing REQ-A2 contract entry without
  changing its approved behaviour: gesture identifier, affected-line rule and line-count delta.
  Extend `.qa/tools/render-eval-matrix.py` to project that declaration into `contract.json`.
  The new model’s transaction validator and `tests/qa/checks/family-a.js` must consume that one
  projection rather than retain independent gesture-to-line tables. CI must reject a gesture
  implemented by the model but absent from the projected contract.
  - **Decision (2026-08-13): approved as a mechanical contract amendment.** It must preserve
    the existing REQ-A2 prose semantics and may not enlarge any permitted edit range.
- Define transactions with raw-source start/end, replacement bytes, gesture and the computed
  allowed-line result. Keep an inverse transaction and resulting revision. Reject a transaction
  exceeding the REQ-A2 declaration.
- Remove every authority-changing `TextUtils.normalize()` path: editor constructor, source input,
  `getMarkdown`, `setMarkdown`, plain-text paste, codec `parseBlocks`, and scroll-line counting.
  Replace them with model raw/display mapping. Parsing and scroll geometry may use the display
  projection, but must never write it back over raw source; per-line terminators remain in the
  model until explicit replacement bytes change them.
- Refactor `web/editor/amorist-markdown-codec.js` to create projection metadata and spans;
  it must not format tables/lists/fences or reconstruct unknown source while rendering.
- **User-visible success criterion:** type then delete one character in every corpus file,
  save, and observe byte-identical disk content; edit one supported line and observe only
  the contract-allowed lines change.


### WYSIWYG transactions and view continuity

- Replace `MarkdownHistory`’s full-document snapshots with a bounded transaction journal: each
  entry carries forward/inverse source transactions, revision boundaries and the affected gesture.
  Undo applies the inverse and redo reapplies the forward transaction; neither may restore an
  unrelated source region. Replace `tests/editor-history.test.js` snapshots with journal tests
  that prove the REQ-A2 line envelope on undo and redo.
- Change `amorist-editor.js` and `amorist-editing-policy.js` so typing, selection replace,
  Enter, toolbar actions, indent/outdent and source edits create model transactions.
- Attach source spans to rendered nodes and map DOM selection to source offsets. Map source-only
  markers to the first visible character for REQ-C1.
- Make view switching swap projections without calling `setMarkdown(this.source.value)`.
  Before replacing a projection, record source selection, focus owner and viewport-coordinate
  anchor; after replacing it, restore a real focused caret with `setSelectionRange` in Source
  view or a DOM `Selection` range in WYSIWYG. Retain the harness’s existing `caretScreenY()` and
  `scrollCaretIntoView()` measurement path; both views must expose a real measurable caret.
- Preserve unsupported source as atomic projection nodes and apply Q1’s visible fallback; never
  fall back to whole-document serialization.
- **User-visible success criterion:** repeated source/WYSIWYG switching retains the unique caret
  anchor, keeps it visible within one line of screen height, and does not dirty an untouched file.
- Rework find highlighting as a presentation-only decoration indexed from model display offsets;
  it must not wrap editable DOM text and must never emit a model transaction or dirty event.
  Make task-checkbox clicks a local transaction replacing only the source `[ ]`/`[x]` marker.
  Both paths must preserve selection mapping and be included in the Task 3 focused QA run.

### Paste boundary

- In the same change that removes `MarkdownCodec.serializeBlocks()` from the projection boundary,
  migrate `amorist-html-to-markdown.js` from DOM-to-codec serialization to a dedicated DOM-to-source
  converter. Its output is the replacement source for `insertMarkdownAtCaret`, never HTML passed
  to `document.execCommand("insertHTML")`; this prevents a temporary paste regression while the
  codec changes.
- Preserve literal code-context paste. For other HTML, retain readable table separators and image
  address/alt information; represent unsupported HTML as readable text, not omission.
- **User-visible success criterion:** every declared paste token survives to the saved Markdown;
  table cells remain on separate lines.

### Disk API and recovery

- Keep `write_document()` as the sole user-file write path, including atomic rename and conflict
  confirmation. Change `read_document()` to return decoded UTF-8 source without
  `normalize_line_endings`, and replace the `line_ending` reconstruction protocol with the exact
  source string. Change `write_document()` to write that received source unchanged, removing
  `encode_line_endings`; this establishes the raw model's initial and final bytes before UI work
  depends on them.
- Extend `AppState` and Tauri commands with an app-owned working copy: document identity, source
  revision, saved revision and unsaved source. Persist the canonical document path plus the exact
  last-saved UTF-8 source alongside the unsaved source; offer recovery only when reopening the
  same canonical path and its current decoded source equals that saved baseline. Introduce one
  cross-platform `app_data_home` helper
  for this state: on Linux it delegates to the existing XDG-aware `data_home()` before adding the
  Amorist subdirectory; on macOS it uses Tauri 2.11.2’s verified
  `app.path().app_data_dir()` resolution. Never write a recovery file beside the user document.
- In `web/app.js`, debounce a working-copy persistence by 2 seconds from the final model edit. On
  startup offer recover/discard only after the canonical-path and saved-baseline validation above;
  delete/commit the copy only after explicit Save succeeds. Measure persistence at <100 ms p95 on
  a supported release environment; otherwise take the approved Q2 exit clause.
- Add an application launch/kill test for REQ-E1/E2 using disposable files.
- **User-visible success criterion:** after an edit followed by a 2-second wait and abrupt close,
  reopening the same unchanged file offers the unsaved text; recovery restores it while bytes and
  mtime of the user’s file remain unchanged until Save.

### QA evidence and release gating

- Do not weaken the contract, fixture expectations or runner verdict logic. Run focused families
  during each task with `node tests/qa/run.js --only <family>` and full runs with
  `node tests/qa/run.js` on every locally applicable engine afterwards. On Linux that full run
  must cover WebKitGTK and Chromium; on macOS it must cover Safari and Chromium.
- Regenerate `contract.json` and `eval-matrix.md` only after an approved contract amendment; retain
  CI’s current drift check and G1/G2 sabotage cases.
- Once a family is green, run its listed mutation from `.qa/architecture.md` and record expected and
  observed result in `.qa/reports/qa-audit.md`.
- **User-visible success criterion:** release publication remains unavailable while any blocking
  requirement is failed, incomplete or could-not-run; eligibility requires green published-platform
  reports, mutation evidence and the manual embedded-webview pass in REQ-G3.

## Edge Cases and Risks *(Executor surface)*

- **Unsafe edit mapping.** Likelihood: high; impact: silent corruption. Mitigation: range validation
  and Q1 fallback. Exit clause: disable the specific WYSIWYG action until its transaction exists.
- **Mixed endings normalised at Rust/UI boundary.** Likelihood: high; impact: REQ-A9 failure.
  Mitigation: carry exact text end-to-end. Exit clause: retain compatibility path until the mixed
  ending fixture passes on all applicable engines.
- **Selection crosses marker or multi-line block.** Likelihood: high; impact: C1/C2 failure.
  Mitigation: span mapping and viewport coordinates, not block indices. Exit clause: switch to source
  at original offset; do not guess an anchor.
- **Stale/malformed recovery record.** Likelihood: medium; impact: wrong text offered. Mitigation:
  canonical-path and saved-baseline validation; never auto-apply. Exit clause: quarantine record
  and show recovery unavailable without modifying the user file.
- **Test host differs from embedded webview.** Likelihood: known; impact: incomplete coverage.
  Mitigation: retain REQ-G3 manual pass and report the residue. Exit clause: add Tauri-level harness
  before claiming embedded behaviour covered.

## Failure Modes and Degradation *(Executor surface)*

- Unsupported WYSIWYG construct → refuse only unsafe action, retain raw source, show Source-view notice.
- Working-copy write failure → retain in-memory text, leave user file untouched, show persistent warning;
  retry on next model revision or explicit Save only.
- Invalid recovery record → no recovery prompt or file write; preserve diagnostic copy outside document directory.
- External modification → retain current CONFLICT flow and explicit forced retry only.
- Missing QA prerequisite → preserve named non-zero failure; no zero-fixture, single-engine or incomplete run passes.

## Task Breakdown *(Executor surface)*

- [ ] Task 1: Apply the approved REQ-A2 projection, regenerate `contract.json` and
  `eval-matrix.md`, and make both the model validator and `family-a.js` read it. Verify the
  renderer cross-check and `node tests/qa/run.js --only A`; outcome: one gesture-envelope
  authority with no broadened allowance.
- [ ] Task 2: First make the Rust read/write path lossless, then add the raw/display model,
  transaction journal and projection parser. In the same change migrate the paste converter from
  DOM serialization to source replacement. Verify neutral corpus round trips plus `cargo test`
  in `src-tauri`; outcome: no disk, model or paste path can replace raw document text through DOM
  serialization.
- [ ] Task 3: Migrate every declared REQ-A2 gesture: within-line insert/delete, Enter,
  cross-boundary deletion, multi-line selection replacement, N-line paste, toolbar/shortcut
  formatting and indent/outdent, then undo/redo. Add task-checkbox transactions, find
  decorations, view switching and real selection/viewport restoration. Verify
  `node tests/qa/run.js --only A`, `--only B`, `--only C` and `--only D`; outcome: A1–A10,
  B1–B3, C1/C2 and D1 pass on every applicable engine.
- [ ] Task 4: Implement working-copy persistence, recovery UI and launch/kill tests using the
  platform-data root and baseline validation defined above. Verify REQ-E1/E2 with the built
  application and measure a 2-second recovery window and <100 ms p95 persistence; outcome: E1/E2
  are measured and pass without a pre-save user-file write.
- [ ] Task 5: On Linux run `node tests/qa/run.js`; on Lestrade, use the approved isolated Node
  runtime and disposable source copy to run the same command with Safari and Chromium and
  `cargo tauri build`. Run the relevant mutation after every family turns green, append
  expected/observed evidence to `.qa/reports/qa-audit.md`, and perform REQ-G3’s six
  release-owner cases: neutral open/save, one-character correction, mid-line Enter, source round
  trip, web paste, and kill/recover. Outcome: release readiness is evidence-backed rather than
  inferred.

## Research Trace *(Executor surface)*

- Checked `git status --short --branch`, diffs and untracked files: only takeaway edits and old May plan
  artifacts are unrelated local work.
- Read all primary `.qa` artifacts, including the full `last-run.json`: contract is approved; source/view/paste
  requirements fail, recovery is incomplete, F1/F2/G1/G2 have evidence.
- Read editor, codec, paste, app, Rust and QA-check sources: current authority is DOM serialization; Rust
  normalises on read; no working-copy command exists; QA checks define exact gesture and result boundaries.
  The locally installed Tauri 2.11.2 path API confirms the desktop `app_data_dir()` route used for
  the non-Linux platform-data helper.
- TokenSave was queried first but is stale and falls back to `main` because this branch is untracked; all
  branch-specific claims above come from the checkout itself.
- Verified the macOS target `lestrade.local` over SSH: macOS 26.5 on x86_64, Xcode 26.3,
  Cargo 1.95.0 and `cargo tauri` 2.11.2 are available. Apple Git is available at `/usr/bin/git`,
  but no Node executable is available. Its existing Amorist checkout is on the same branch but at
  `61b69d4`, not this checkout's `5cffff1`, and has a user-owned modification to
  `docs/decision-exec-command.md`; it must not be reset, cleaned or used as the test worktree.

## macOS Verification Target *(Executor surface)*

Use `lestrade.local` for the macOS build and release verification. Provision Node v22.17.0 under
`/Users/alessandro/.local/share/amorist-tools/` without system-wide installation, then keep its
existing checkout untouched. Create a disposable source copy under a fresh `mktemp -d` directory,
populate it from the implementation checkout, and record the source commit plus `git diff --check`
before testing. Run `node tests/qa/run.js` there with Safari and Chromium, then run
`cargo tauri build` from its `src-tauri/` directory. A build or test result from the pre-existing
checkout, or from a source copy whose recorded revision does not match the implementation checkout,
is not macOS evidence for this plan.

If the remote test source or approved Node runtime cannot be prepared, the macOS report must
remain could-not-run with the named prerequisite; it cannot inherit a Linux result or release
approval.

## Unresolved Items Inventory *(Reviewer surface)*

None. The owner approved an isolated Node v22.17.0 runtime under the Lestrade user directory on
2026-08-13. There are no remaining `TODO`, `assumed:` or `unverified:` items outside this plan's
Operations Guide appendix.

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
