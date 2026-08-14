# Evaluation matrix — amorist

Generated from `.qa/qa-contract.yaml` and `.qa/risk-register.yaml`. Do not edit
by hand: change the contract and regenerate, otherwise the two disagree and the
matrix silently becomes fiction.

Contract status: **approved** (2026-07-28). This file is
generated; the contract is the source of truth.

| Requirement | What it says | Risks | Verification | Gate | Automation | Cost | False-positive risk | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `REQ-A1` | Open any .md file, type one character, delete it, save. The file on disk must be byte-ide… | R-001, R-002, R-003, R-004, R-010, R-012, R-014 | deterministic | blocking | full | low per case once the h… | low | RED today |
| `REQ-A2` | After a real edit, only the edited line may differ between the file before and the file a… | R-005, R-006, R-010, R-013 | deterministic | blocking | full | medium | medium | RED today |
| `REQ-A3` | A region the user touched but whose content ended up unchanged must be written back exact… | R-005 | deterministic | blocking | full | low | low | RED today |
| `REQ-A4` | Invisible characters are preserved verbatim: trailing spaces stay, a file that ended with… | R-014 | deterministic | blocking | full | low | low | RED today |
| `REQ-A5` | Markdown constructs amorist does not understand pass through untouched. They are copied v… | R-002, R-003, R-004, R-006 | deterministic | blocking | full | medium | low | RED today |
| `REQ-A6` | Table spacing is preserved as found in the file. No column re-alignment happens on open o… | R-012 | deterministic | blocking | full | low | low | RED today |
| `REQ-A7` | List markers and numbering are preserved as the author wrote them. A list written with "*… | R-013 | deterministic | blocking | full | low | low | RED today |
| `REQ-A8` | The information string on a fenced code block (the language tag) is preserved, along with… | R-001 | deterministic | blocking | full | low | low | RED today |
| `REQ-A9` | The file's line-ending convention is preserved: a CRLF file stays CRLF, an LF file stays… | R-010 | deterministic | blocking | full | low | low | partial |
| `REQ-A10` | Switching between WYSIWYG and source, any number of times and in any order, leaves the do… | R-002, R-007, R-012 | deterministic | blocking | full | low | low | RED today |
| `REQ-B1` | Every line of the file is shown as its own line in the WYSIWYG view. Soft breaks are not… | R-005, R-015 | deterministic | blocking | full | high | medium | RED today |
| `REQ-B2` | Typing lengthens the current line. It never moves the other lines of the same paragraph. | R-005 | deterministic | blocking | full | low | low | RED today |
| `REQ-B3` | In ordinary prose, Enter inserts a bare newline at the caret. It does not create a paragr… | R-015 | deterministic | blocking | full | low | low | RED today |
| `REQ-B4` | When typed Markdown becomes a visual construct, subsequent typing remains at the visible… | R-011 | deterministic | blocking | full | low | low | green today |
| `REQ-B6` | WYSIWYG list editing follows conventional editor behavior while retaining exact Markdown… | R-011, R-013 | deterministic | blocking | full | medium | low | green today |
| `REQ-B7` | Hidden heading and quote prefixes participate in conventional WYSIWYG editing. Enter cont… | R-011 | deterministic | blocking | full | low | low | green today |
| `REQ-B5` | Pipe-table columns are visually aligned in WYSIWYG without changing the source spacing. A… | R-012 | deterministic | blocking | full | low | medium | RED today |
| `REQ-C1` | Switching between WYSIWYG and source leaves the caret on the same character of the text,… | R-007, R-011 | deterministic | blocking | full | medium | medium | RED today |
| `REQ-C2` | After switching views, the physical source line displayed at the vertical midpoint of the… | R-011 | deterministic | blocking | full | medium | low | green today |
| `REQ-C3` | A failure while producing WYSIWYG never leaves the editor empty. Source remains visible w… | R-011 | deterministic | blocking | full | low | low | RED today |
| `REQ-D1` | Content pasted from another application never disappears silently. What amorist cannot co… | R-008 | deterministic | blocking | full | medium | low | RED today |
| `REQ-E1` | Work not yet saved survives an abrupt termination. A working copy is written periodically… | R-009 | deterministic | blocking | full | medium | low | green today |
| `REQ-E2` | amorist never writes to the user's .md file except on an explicit save. The working copy… | R-010 | deterministic | blocking | full | low | low | green today |
| `REQ-F1` | The file is written atomically. A failure during the write leaves the original file intac… | R-009 | deterministic | blocking | full | low | low | green today |
| `REQ-F2` | A file modified outside amorist since it was opened is detected on save, and is never ove… | R-009 | deterministic | blocking | full | low | medium | green today |
| `REQ-G1` | A check that cannot execute is a failure, never a pass. Missing browser, missing corpus,… | R-016 | deterministic | blocking | full | low | low | RED today |
| `REQ-G2` | The editor checks run on the engines the product actually ships with, not only on a stand… | R-017 | deterministic | blocking | full | medium | medium | RED today |
| `REQ-G3` | Every report names the engines actually exercised, and names any published platform that… | R-017 | manual | advisory | manual | low | low | RED today |

## Reading this table

**State** is measured against the repository at commit a9d7e73, not assumed:
8 requirements hold today, 1 holds partially, 19 fail. The suite is
expected to be red on first run — the contract specifies the editor that must
exist, not the one that does.

**Gate**: 27 blocking, 1 advisory. A blocking failure stops
publication of a release; it does not stop a commit, a merge or a push
(`G-PUSH` in the contract).

**Verification**: 27 deterministic, 1 manual. No requirement is verified by
a model. The runner never calls one, so a red result always means the code is
wrong — never that a service was unavailable or a model was inconsistent.

**Engines**: every check in families A, B, C and D runs twice — on the engine the
Linux application ships inside, and on a stand-in — and must pass on both
(`REQ-G2`). One engine unavailable fails the run; it does not pass on the
strength of the other.

## Unverifiable or human-reviewed qualities

| Quality | Owner | Cadence | Evidence | Why no automated proxy |
| --- | --- | --- | --- | --- |
| Behaviour on macOS, whose engine (WKWebView) cannot be driven | repository owner | once per release, while macOS is published | the six-case manual list in `REQ-G3`, recorded in the release entry | The Linux engine is driven directly and is no longer a hole. macOS has no equivalent driver and the Tauri WebDriver wrapper does not support it; a different build of the same engine family would be a proxy, not the engine that ships. The obligation is scoped to published platforms, so dropping the platform closes it. |
| Whether the editing model still feels right after the rewrite | repository owner | after packages 2 and 3 | a written note, not a check | Taste is not a contract term. It is recorded here so that it is not smuggled in as one. |

## What this matrix deliberately does not contain

- **Coverage percentages.** Every requirement maps to at least one risk and every
  risk to at least one requirement (cross-checked mechanically, and this file
  fails to generate if that stops being true). A percentage on top of that would
  add a number, not information.
- **Semantic evaluation in the gate.** A model may be used outside the gate to
  discover new paste cases (`REQ-D1`); anything it finds becomes a deterministic
  fixture. The verdict is never a model's.
