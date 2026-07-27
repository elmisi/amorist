# The QA suite

This directory compiles `.qa/qa-contract.yaml` into something executable. The
contract is the source of truth; nothing here may be weakened to make a run go
green. Amend the contract first, have the amendment approved, then change the
check — a check changed without a contract amendment is a contract breach
whatever the suite reports.

## Running it

```bash
node tests/qa/run.js                    # everything, on both engines
node tests/qa/run.js --only A           # one family
node tests/qa/run.js --engine chromium  # one engine, for debugging only
```

The result lands in `.qa/reports/last-run.json`: a verdict per requirement per
engine, and for every failure the fixture, the byte offset or line number, and
the two values that differ. A failure that cannot name where it happened is not
a usable failure.

Exit status is non-zero if and only if a blocking requirement failed **or a
check could not run**. There is no third state.

### Prerequisites

| What | Why | How |
| --- | --- | --- |
| `webkit2gtk-driver` | the engine the Linux application ships inside | `sudo apt install webkit2gtk-driver` |
| a Chromium-family browser | the stand-in engine | usually already present |
| a display | the shipping engine needs one | `xvfb-run -a` where there is none |
| a Rust toolchain | the write-path checks are Rust | already needed to build the app |

A missing prerequisite fails the run and names itself. It never degrades to a
partial run that reports success.

## What is where

```
run.js                the entry point: discovery, orchestration, report, exit status
lib/engines.js        which engines exist, and why one being absent is fatal
lib/engine-webkit.js  the shipping engine, over its WebDriver server on plain HTTP
lib/engine-chromium.js the stand-in, over the DevTools protocol on a raw WebSocket
lib/keys.js           one symbolic key vocabulary, translated per engine
lib/page.js           the page-side API as a check sees it
lib/corpus.js         fixture loading; an empty directory is a failure
lib/fixtures.js       which fixtures a requirement applies to, by CONTENT not by name
lib/markdown-shape.js just enough structure reading to aim a check at the right line
lib/diff.js           failure localisation: byte offset, line, and what changed
lib/report.js         the structured result and the exit-status rule
lib/server.js         a static file server for the harness page — nothing else
page/harness.html     loads web/editor/ alone: no app shell, no backend
corpus/               17 synthetic Markdown fixtures
paste/                paste fixtures, each declaring the tokens that must survive
checks/               one file per family
```

## Two engines, one set of checks

Every check in families A to D runs twice: once on WebKitGTK, the engine the
Linux application actually runs inside, and once on a Chromium-family browser.
Both must pass.

**No check may name an engine.** A check that branches on which engine it is
running under has stopped comparing the two, which is the only reason both are
run. The one seam is the driver object in `lib/`; above it, everything is engine
-blind.

The stand-in is kept even though it is not what ships: it starts faster and is
easier to debug, and a check that behaves differently on the two engines is
itself a finding — either an engine difference the user will meet, or a check
depending on something it should not.

macOS is not covered. Its engine has no equivalent driver, so it is named in
every report together with the manual pass that stands in for it, rather than
being left to look like coverage.

## Adding a case

Drop a `.md` file into `corpus/`. That is the whole procedure — the checks
iterate over the directory and select by content, so every requirement whose
construct the new file contains starts covering it with no code change. This is
also how a real defect becomes a permanent regression case: reduce it to the
smallest file that reproduces it, strip anything private, drop it in.

For paste, add a `.json` file to `paste/` declaring `mustSurvive` — the tokens
that must reach the file — and optionally `mustBeOnSeparateLines`.

## What must never be done here

- **Weaken a check to make a run green.** The contract changes first.
- **Let something skip silently.** Every path that cannot do its job must exit
  non-zero and say which one it was. This is checked by breaking the suite on
  purpose; see `checks/family-g.js`.
- **Call a model.** The runner never does. A red result therefore always means
  the code is wrong, never that a service was unavailable — which is what makes
  the result usable as a gate. A model may be used *outside* the gate to
  discover new paste cases; anything it finds becomes a fixture here.
- **Add a dependency.** Node builtins and the Rust toolchain, nothing else.
