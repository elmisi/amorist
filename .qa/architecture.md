# QA architecture — amorist

Companion to `.qa/qa-contract.yaml` (status: **approved**, 2026-07-28). This
describes how the contract is compiled into something executable.

It is built. `tests/qa/` holds the suite, `tests/qa/README.md` is the working
guide, and `.qa/reports/qa-audit.md` records what was broken on purpose to show
the apparatus can fail. What follows is the design and the reasoning; where the
two disagree, the code is wrong.

## Contract boundary

**Source of truth, in order.** `.qa/qa-contract.yaml` first; then
`.qa/risk-register.yaml` for the risk-to-requirement mapping; then
`.qa/decisions.yaml` for why a requirement says what it says. `.qa/risks.yaml`
is the raw Discovery log with the reproductions and is never a source of
obligations. `.qa/eval-matrix.md` is generated and must never be hand-edited.

**Invalidation rule.** Any change to the product's intended behaviour invalidates
the affected requirement, not the check that implements it. The order is always:
amend the contract, get it approved, then change the check. A check changed
without a contract amendment is a contract breach regardless of what the suite
reports — this is `R-018`, the process risk that the audit phase exists to catch.

**Approval.** `status: approved` written into the contract by the repository
owner. Approval in conversation does not count and does not authorise writing a
single test.

## Runner boundary

**One command**, no arguments needed for the default run:

```
node tests/qa/run.js            # everything
node tests/qa/run.js --only A   # one family
```

**Structured result**, written to `.qa/reports/last-run.json`: for every
requirement, its identifier, verdict, the fixtures exercised, and for each
failure the fixture, the byte offset or line number, and the two values that
differ. A failure that cannot name where it happened is not a usable failure.

**Exit code.** Non-zero if and only if a blocking requirement failed, or a check
could not run (`REQ-G1`). Advisory failures are reported and do not affect the
exit code. There is no third state: a check either produced a verdict or the run
failed.

**Model independence.** The runner never calls a model, never opens a network
connection, and reads nothing outside the repository. A red result therefore
always means the code is wrong — never that something was unavailable. This is
what makes the result usable as a release gate.

**Three execution layers**, chosen in D-014 and D-020, with the editor layer
doubled across two engines by D-029:

| Layer | What runs | What it verifies |
| --- | --- | --- |
| Editor | one set of checks, run once per engine applicable to the platform: the shipping engine through its own WebDriver server (WebKitGTK on Linux, Safari on macOS), plus a Chromium-family stand-in over the DevTools protocol. All with node builtins only, all loading a test page that pulls in `web/editor/*.js` alone — no server, no app shell | families A, B, C, D: everything about the text the editor produces, and the caret |
| Disk | Rust tests over temporary files | family F: atomic write, conflict detection, line endings |
| Recovery | the built application, started and killed | family E: the working copy and its recovery |

**The editor layer compares exact file text in against exact file text out.**
That is stronger than it first looks and it is deliberate: it makes the editor
component responsible for being transparent to line terminators, rather than
normalising them at the door and leaving the backend to guess them back. The
per-line terminator rule (`REQ-A9`, `D-027`) is only reachable this way —
information normalised away on the way in cannot be restored on the way out by
anything downstream. Expect `encode_line_endings` in the Rust backend to become
a no-op and then disappear as this lands.

**The recovery layer is a Linux application test.** It builds the debug binary,
starts it through `tauri-driver` with a disposable document and isolated
`XDG_DATA_HOME`, types through WebDriver, asserts the declared 2-second timer,
samples the user's bytes and mtime, sends `SIGKILL` to the exact application
PID, and restarts it. It then exercises both Reload/discard and explicit Save.
Direct Tauri WebDriver automation is unavailable on macOS, so that run records
the platform limitation rather than borrowing Linux evidence.

**One protocol, two hosts.** Both shipping engines speak the same standard
WebDriver protocol over plain HTTP, so adding the second platform reused the
client rather than adding one. The differences are confined to how a session is
opened. This is why the coverage was cheap, and it is the reason to prefer a
standard protocol over a vendor one wherever both exist.

**Applicability is declared, not detected.** The contract lists which engines
belong to which platform. An engine absent from the current platform is recorded
as *inapplicable* and skipped; an engine that belongs here and will not start is
a *failure*. This is the only skip the suite permits anywhere, and it is safe
only because the permission comes from the contract. A skip decided by detection
would be the silent pass arriving through the front door.

**Driver interface.** The editor layer has exactly one seam: a small driver
object with the operations the checks need — load the page, evaluate an
expression, dispatch a key, read a bounding rectangle, read and set the
selection. Two implementations sit behind it, one speaking WebDriver over plain
HTTP, one speaking the DevTools protocol over a raw WebSocket. **No check may
name an engine.** A check that branches on which engine it is running under has
stopped comparing the two, which is the only reason both are run.

The Chromium-family implementation reuses the technique already present in
`tests/app-shell-smoke.test.js` (spawn the browser binary, speak the DevTools
protocol over a raw WebSocket). It deliberately does **not** reuse that test's
scaffolding, which starts `bin/amorist` — the deprecated Python server is outside
the perimeter (D-020) and must not become a dependency of the gate. It also must
not reuse its browser lookup, which searches for a binary named `chromium` and
silently succeeds when it finds nothing; the lookup tries the known names in
order and fails loudly (`REQ-G1`).

**Why keep the stand-in at all**, now that the real engine can be driven: it is
faster to start and far easier to debug, and a check that behaves differently on
the two engines is itself a finding — either an engine bug worth knowing about,
or a check that depends on something it should not.

**Prerequisites**, which the runner verifies rather than assumes: the WebDriver
server package for the shipping engine, at the same version as the library the
application links against, and a display — virtual where none exists. A missing
prerequisite fails the run and names itself. It never degrades to a
single-engine run that reports success.

**Known coverage hole**, stated rather than hidden: families A-D drive the
shipping engine inside a **test host** — the small reference browser that ships
with the Linux driver, the system browser on macOS — rather than the webview the
application embeds. Same engine, different host. Family E now covers the Linux
application embedding for recovery and write isolation only; it does not turn
that focused scenario into general app-host coverage.

This was first written as a macOS problem, which would have claimed a
completeness on Linux that never existed. It was caught only because the runner
prints the name of the host it actually drove, and the name was not the one the
document assumed. Worth keeping as a habit: **print what was really exercised,
not what was meant to be** — the two diverge quietly.

`REQ-G3` requires every report to name that residue, along with the platform the
run covered and the published platforms it did not — because a run on one
platform is evidence about one platform.

## Fixture boundary

`tests/qa/corpus/` holds the synthetic corpus. Every file is written from
scratch; no file of the user's is ever copied in (D-026). The corpus imitates
four families of real document: Obsidian-style notes with front matter and wiki
links, technical documentation with fenced code and tables, hand-wrapped prose
drafts, and files that have passed through several tools and carry inconsistent
formatting.

The checks **iterate over the directory**; they never list cases in code. Adding
a newly discovered breaking case is therefore a copy, not a code change — which
is also how every real defect becomes a permanent regression case.

Two rules make that mechanism honest:

- an empty or unreadable corpus directory is a failure, not an empty pass
  (`REQ-G1`);
- during implementation the corpus and the runner are read-only. Changing a
  fixture to make a check pass is the failure mode described in `R-018`.

## Adapter boundary

No adapter is required, and none may own a verdict.

A model may be used, outside the runner and outside the gate, for three things:
writing corpus files that imitate the four families; explaining a failure once
the runner has produced one — comparing the two versions through a reference
Markdown parser to name the construct responsible; and doing the implementation
work itself.

The one place where a semantic judge would genuinely extend coverage is
`REQ-D1`, paste: a model comparing pasted input against written output can find
losses no fixture anticipated. It runs as a discovery tool, on demand. Anything
it finds becomes a deterministic fixture, and the gate keeps asserting fixed
tokens.

## Audit boundary

**Mutations.** Derived from `references/mutation-catalog.md` and from this
repository's own history, since the known defects are better mutations than any
invented ones:

| Mutation | Expected failure |
| --- | --- |
| restore `.trimEnd()` in `serializeBlocks` | `REQ-A4` fails on every corpus file with a final newline |
| restore `formatMarkdownTable` in `parseBlocks` | `REQ-A6` fails on the ragged-table fixture |
| restore the hardcoded `"- "` marker in `serializeList` | `REQ-A7` fails on the asterisk-list fixture |
| restore `joinTextLines` collapsing soft breaks | `REQ-A3`, `REQ-B1`, `REQ-B2` fail on the hand-wrapped fixture |
| drop the fence info string again | `REQ-A8` fails |
| re-serialise the whole document on save | `REQ-A2` fails: lines change outside the edited one |
| normalise a mixed-terminator file to the majority convention | `REQ-A9` fails on the mixed fixture |
| indent one list item and renumber the rest | `REQ-A2` fails: lines change that the gesture cannot account for |
| point the browser path at a non-existent binary | the run fails; it must not skip and pass (`REQ-G1`) |
| make the WebDriver server unreachable | the run fails and names that engine; it must not pass on the strength of the other one (`REQ-G1`, `REQ-G2`) |
| empty the corpus directory | the run fails (`REQ-G1`) |

**Recording.** `.qa/reports/qa-audit.md`: the mutation applied, the failure
expected, the result observed, and any gap left open. A mutation that the suite
does not detect is evidence of a hole in the QA, not a passing result — and it
is recorded as such even when everything else is green.

**Turning a defect into a regression case.** When a real failure is found and is
stable, it is reduced to the smallest file that reproduces it, stripped of
anything private, and dropped into the corpus. No code changes. The risk it came
from gets its `verification_ids` updated in the register.

**Release-readiness rule.** Release readiness may not be claimed while any
blocking requirement fails, and may not be claimed on a green suite whose
mutations have not been run. Green without mutation evidence means the checks
were never shown to be capable of failing.
