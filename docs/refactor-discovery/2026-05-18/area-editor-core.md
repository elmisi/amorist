# Area: Editor Core   (pass: 2026-05-18, commit: 40d5d727a7b6b584a94321f69c1d4c5f7b5a7339)

## Enumeration
- `web/editor/amorist-editor.js` — 1121 LOC, no persistent tests, intent from README and recent bug-fix commits.
- `web/editor/amorist-editor.css` — 215 LOC, visual/editor layout contract, intent from screenshots and sticky/wide-content fixes.

## Purposes
- `amorist-editor.js`: exposes embeddable `AmoristEditor.create`, owns contenteditable UI, markdown parsing/rendering/serialization, table formatting, typing shortcuts, scroll preservation.
- `amorist-editor.css`: owns toolbar, editable surface, source textarea, code/table overflow, task list rendering.

## Lens Scan
- Temporal coupling: signal — 11 recent commits touch `amorist-editor.js` for unrelated user-visible behaviours.
- Change amplification: signal — Markdown dialect changes affect parser, renderer, serializer, shortcuts, CSS, docs.
- Shotgun ceremony: signal — parse/render/serialize/table paths repeat Markdown block knowledge.
- Semantic drift: signal — README says "small Markdown subset" while table dialect carries many non-obvious rules.
- Asymmetric abstractions: signal — table handling has many named helpers; inline/block shortcuts remain DOM/range-level in class methods.
- Hidden policy: signal — table dialect policies, source-line scroll mapping, zero-width caret handling.
- Test gravity: signal — browser checks are ad hoc, not persistent project assets.
- Negative space: signal — no committed tests for editor contracts despite bug history.

## Smell Leads
- [ED-SL1] Contenteditable command and shortcut policy are interleaved: hidden policy / evidence `web/editor/amorist-editor.js:152-198 @40d5d72 -- "runAction(action)"`, `web/editor/amorist-editor.js:237-364 @40d5d72 -- "applySpaceMarkdownShortcut"` / why-status partial / suspicion browser editing policy lacks a named owner / inspect-next compare shortcuts vs toolbar commands / risk medium / bucket Do next.
- [ED-SL2] Persistent test negative space around central editor contracts: negative space / evidence `git ls-files @40d5d72 -- no test files`, commit `b759f51 -- Make quote typing shortcut more robust` / why-status recovered / suspicion complex round-trip behaviours are protected only by manual agent scripts / inspect-next choose fixture format for parser/table/typing contracts / risk medium / bucket Do next.

## Promoted Refactor Candidates
- [ED-R1] Extract table parsing/formatting into a dedicated codec: evidence `web/editor/amorist-editor.js:908-1043 @40d5d72 -- "function formatMarkdownTable(markdown)"`, commits `8fa25b6`, `c900a07`, `e5fec8f`, `9625fd1` / intent readable pipe-table blocks with tolerant local Markdown dialect / principles 1,3,4 / recommended shape extract table codec plus fixtures / risk low / scope small / bucket Do next.
- [ED-R2] Separate editor UI shell from Markdown conversion layers: evidence `web/editor/amorist-editor.js:11-448 @40d5d72 -- "class AmoristEditor"`, `web/editor/amorist-editor.js:451-1043 @40d5d72 -- "parseBlocks" through table helpers` / intent one dependency-free embeddable editor / principles 1,3,4 / recommended shape split internal modules while preserving `AmoristEditor.create` / risk medium / scope medium / bucket Do later.

## Acceptable as-is
- `web/editor/amorist-editor.css`: current CSS has clear ownership of editor presentation and recent sticky/overflow issues are locally contained.

## Looks messy, leave alone
- `document.execCommand` usage: deprecated-looking, but currently a deliberate pragmatic choice for zero-dependency editing; replacing it would cascade into editor-core design.

## Research tasks
- [ED-RT1] Browser editing API direction: needs browser/runtime evidence before replacing `execCommand` or contenteditable range handling.

## Open questions / assumptions
- The editor intentionally normalizes Markdown; exact Markdown lexical preservation is not a current invariant.
