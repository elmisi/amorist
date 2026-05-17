# Refactor Discovery — Pass 2026-05-18

**Commit:** 40d5d727a7b6b584a94321f69c1d4c5f7b5a7339
**Date:** 2026-05-18
**Scope:** full project
**Primary areas:** Editor Core, App Shell, Runtime Server, Ops and Docs
**Adjacent areas:** none
**Methodology:** smell-led refactor-discovery methodology

---

## 1. Executive Summary

- Highest signal is in `web/editor/amorist-editor.js`: 11 recent commits changed the same file for distinct editor behaviours.
- R1 is the clearest next refactor: extract the table codec/formatter with fixtures before adding more table rules.
- R2 is useful but broader: split the editor UI shell from Markdown conversion and selection/typing policy.
- SL2 is the main safety lead: complex editor behaviours are verified by transient browser scripts, not committed tests.
- Runtime and app shell are comparatively cohesive; their findings are lower urgency.
- No document-intent items were promoted in this pass.

---

## 2. Investigation Leads

#### SL1: Contenteditable command and shortcut policy are interleaved
- **Area:** Editor Core
- **Files:** `web/editor/amorist-editor.js`
- **Lens:** hidden policy, asymmetric abstractions
- **Why it is suspicious:** Toolbar commands, Markdown shortcuts, caret tricks, and serialization callbacks all mutate the same DOM surface without a named editing policy.
- **Evidence:** `web/editor/amorist-editor.js:152-198 @40d5d72 -- "runAction(action)"`; `web/editor/amorist-editor.js:237-364 @40d5d72 -- "applySpaceMarkdownShortcut"`
- **Why-status:** partial
- **Inspect next:** Compare toolbar command behaviours with typing shortcut behaviours and identify which invariants both must preserve.
- **Promotion condition:** Promote after a named editing-policy boundary can be extracted without replacing the whole editor.
- **Risk:** medium
- **Bucket:** Do next
- **Depends on:** none

#### SL2: Central editor contracts have no persistent tests
- **Area:** Editor Core
- **Files:** `web/editor/amorist-editor.js`
- **Lens:** negative space, test gravity
- **Why it is suspicious:** The highest-churn behaviours are currently protected by ad hoc browser checks from development sessions.
- **Evidence:** `git ls-files @40d5d72 -- no test files`; commit `b759f51 -- touched web/editor/amorist-editor.js for "Make quote typing shortcut more robust"`
- **Why-status:** recovered
- **Inspect next:** Choose the smallest committed fixture harness for table formatting, source/WYSIWYG round-trip, and typing shortcuts.
- **Promotion condition:** Promote to execution once the preferred no-build test shape is chosen.
- **Risk:** medium
- **Bucket:** Do next
- **Depends on:** none

#### SL3: Dirty/save lifecycle lacks persistent contract coverage
- **Area:** App Shell
- **Files:** `web/app.js`
- **Lens:** negative space
- **Why it is suspicious:** File safety flows depend on dirty state, save state, reload confirmation, line endings, and server API response handling.
- **Evidence:** `web/app.js:73-94 @40d5d72 -- "reloadDocument()"`; `web/app.js:110-133 @40d5d72 -- "saveDocument()"`
- **Why-status:** recovered
- **Inspect next:** Add one browser smoke path around open-edit-save-reload only if editor contract tests are already in place.
- **Promotion condition:** Promote if save/reload changes resume or regressions recur.
- **Risk:** medium
- **Bucket:** Do later
- **Depends on:** SL2

#### SL4: File encoding and save boundary policy is implicit
- **Area:** Runtime Server
- **Files:** `bin/amorist`
- **Lens:** hidden policy
- **Why it is suspicious:** The local-file trust boundary assumes UTF-8 and atomic replace semantics without exposing the policy.
- **Evidence:** `bin/amorist:127-140 @40d5d72 -- "raw.decode(\"utf-8\")"`; `bin/amorist:164-170 @40d5d72 -- "tmp_path.replace(path)"`
- **Why-status:** partial
- **Inspect next:** Decide whether unsupported encodings should fail with a user-facing error or become a documented UTF-8 constraint.
- **Promotion condition:** Promote if non-UTF-8 files appear in real use or file-boundary UX changes.
- **Risk:** low
- **Bucket:** Do later
- **Depends on:** none

---

## 3. Promoted Refactor Candidates

#### R1: Extract table parsing/formatting into a dedicated codec
- **Area:** Editor Core
- **Files:** `web/editor/amorist-editor.js`
- **Why it matters now:** Table behaviour has accumulated several user-driven rules and repeated fixes in one file.
- **Principles:** 1 Readability, 3 Cognitive Load Minimization, 4 Abstraction via Naming
- **Evidence:** `web/editor/amorist-editor.js:908-1043 @40d5d72 -- "function formatMarkdownTable(markdown)"`; commits `8fa25b6`, `c900a07`, `e5fec8f`, `9625fd1`
- **Intent recovered:** Tables remain editable monospace Markdown blocks, aligned on render/save, tolerant of local Markdown quirks.
- **Recommended shape:** Extract a table codec/formatter module with named policies and fixture cases for emoji width, `\|`, blank lines, extra cells, and wide table text.
- **Cognitive-load delta:** lower
- **Expected benefit:** Future table changes stop competing with contenteditable and selection code.
- **Risk:** low
- **Scope:** small
- **Bucket:** Do next
- **Depends on:** none

#### R2: Separate editor UI shell from Markdown conversion layers
- **Area:** Editor Core
- **Files:** `web/editor/amorist-editor.js`
- **Why it matters now:** One 1121 LOC file owns public API, toolbar, contenteditable events, parser, renderer, serializer, table logic, selection helpers, and scroll restoration.
- **Principles:** 1 Readability, 3 Cognitive Load Minimization, 4 Abstraction via Naming
- **Evidence:** `web/editor/amorist-editor.js:11-448 @40d5d72 -- "class AmoristEditor"`; `web/editor/amorist-editor.js:451-1043 @40d5d72 -- "parseBlocks" through table helpers`
- **Intent recovered:** Keep a dependency-free embeddable editor with `AmoristEditor.create` as the public API.
- **Recommended shape:** Preserve public API, split internal concerns into editor shell, Markdown block conversion, table codec, typing/selection helpers, and scroll helpers.
- **Cognitive-load delta:** lower
- **Expected benefit:** Smaller ownership boundaries make feature fixes less likely to disturb unrelated editor behaviours.
- **Risk:** medium
- **Scope:** medium
- **Bucket:** Do later
- **Depends on:** R1

---

## 4. Research Tasks

#### RT1: Decide whether to keep or replace `execCommand`
- **Area:** Editor Core
- **Files:** `web/editor/amorist-editor.js`
- **Why it matters now:** Toolbar actions still rely on browser editing commands while typing shortcuts use custom DOM/range code.
- **Evidence:** `web/editor/amorist-editor.js:165-195 @40d5d72 -- "document.execCommand"`; `web/editor/amorist-editor.js:201-212 @40d5d72 -- "wrapInline(tagName)"`
- **Blocked on:** Browser compatibility evidence and a decision about whether zero-dependency editing still outweighs a custom command layer.
- **Expected promotion path:** Could become an R item to replace toolbar commands with named DOM transformations, or a leave-alone decision.
- **Risk:** medium
- **Bucket:** Do later
- **Depends on:** SL1

---

## 5. Document-Intent Items

none

---

## 6. Prioritized Roadmap

### Do next
- R1: Highest payoff and lowest-risk extraction; table rules are already a cohesive subdomain.
- SL1: Investigate before changing toolbar/shortcut behaviour again.
- SL2: Choose persistent fixtures before the next editor feature batch.

### Do later
- R2: Valuable structural split, but safer after R1 narrows the table surface.
- SL3: Revisit when save/reload behaviour changes or persistent browser tests exist.
- SL4: Decide encoding policy if real files expose non-UTF-8 cases.
- RT1: Gather browser evidence before replacing pragmatic editor commands.

### Do not do now
- none

---

## 7. Lens Coverage

- Temporal coupling: strong signal in editor core via repeated commits touching `web/editor/amorist-editor.js`; examples include commit `b759f51 -- Make quote typing shortcut more robust`, `93a446c -- Add bold WYSIWYG markdown shortcut`, and `e5fec8f -- Allow blank lines inside markdown tables`.
- Change amplification: signal around Markdown dialect changes touching parser/render/serialize/shortcut/docs.
- Shotgun ceremony: signal around repeated Markdown block knowledge across conversion paths.
- Semantic drift: low signal; docs currently mostly match behaviour after recent cleanup.
- Asymmetric abstractions: signal between table helpers and less-named editing policy.
- Hidden policy: signal in table dialect, editing policy, and UTF-8 file boundary.
- Test gravity: signal from missing committed tests around editor contracts.
- Negative space: signal from no tests despite repeated editor regressions.

---

## 8. Areas Inspected With Verdicts

- Editor Core: has the dominant structural findings; table codec extraction is the clearest next refactor.
- App Shell: cohesive adapter layer with one lower-priority test coverage lead.
- Runtime Server: cohesive stdlib server with one lower-priority file-boundary policy lead.
- Ops and Docs: no findings; current scripts and docs are small, coherent, and user-facing.

---

## 9. Thematic Groups

- Editor correctness cluster: R1, SL1, SL2, R2, RT1 all touch the same editor-risk surface.
- File-safety cluster: SL3 and SL4 both touch local-file trust, but at different layers.

---

## 10. Open Questions and Assumptions

- The editor may normalize Markdown; exact lexical preservation is assumed not to be a hard invariant.
- Markdown files are assumed UTF-8 unless the user reports otherwise.
- Zero-dependency and no-build embedding remain primary constraints.
