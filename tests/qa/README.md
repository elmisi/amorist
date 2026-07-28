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

On Linux:

| What | Why | How |
| --- | --- | --- |
| `webkit2gtk-driver` | the engine the application ships inside | `sudo apt install webkit2gtk-driver` |
| a display | that engine needs one | `xvfb-run -a` where there is none |

On macOS:

| What | Why | How |
| --- | --- | --- |
| remote automation enabled | the system's driver refuses every session until an administrator turns it on | `sudo safaridriver --enable`, once per machine. On some configurations a separate switch in the browser's hidden web-developer settings is also needed; the failure message says so, and says where |
| a real graphical session | the engine will not run headless | already present on a desktop or a hosted runner |

Everywhere:

| What | Why |
| --- | --- |
| a Chromium-family browser | the stand-in engine; found by name on Linux and inside the application bundle on macOS |
| a Rust toolchain | the write-path checks are Rust |

A missing prerequisite fails the run and names itself. It never degrades to a
partial run that reports success.

## What is where

```
run.js                the entry point: discovery, orchestration, report, exit status
lib/engines.js        which engines belong to which platform, and the one skip that is allowed
lib/engine-webdriver.js the shared WebDriver client: one protocol, both shipping engines
lib/engine-webkitgtk.js the Linux shipping engine — how its server starts, and nothing else
lib/engine-safari.js  the macOS shipping engine — same, plus the enable-once instruction
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

## Engines are declared per platform

Every check in families A to D runs once per engine that belongs on the platform
it is running on, and must pass on all of them:

| Platform | Ships on | Plus |
| --- | --- | --- |
| Linux | WebKitGTK, through its own WebDriver server | a Chromium-family stand-in |
| macOS | Safari, through the system's WebDriver server | a Chromium-family stand-in |

Both shipping engines speak the same standard protocol over plain HTTP, so the
second platform reused the client rather than adding one. What differs between
them is confined to starting the server and opening a session.

**An engine that does not belong on this platform is skipped and recorded as
inapplicable — not as missing.** That is the only skip the suite permits
anywhere, and it is safe only because the platform-to-engine map lives in the
contract rather than being detected. A skip decided by detection would be the
silent pass arriving through the front door.

**A run on one platform is evidence about one platform.** The report says which
platform it covered and which published platforms it did not. Composing runs
across platforms is the release gate's job, not a single run's.

**No check may name an engine.** A check that branches on which engine it is
running under has stopped comparing the two, which is the only reason both are
run. The one seam is the driver object in `lib/`; above it, everything is engine
-blind.

The stand-in is kept even though it is not what ships: it starts faster and is
easier to debug, and a check that behaves differently on the two engines is
itself a finding — either an engine difference the user will meet, or a check
depending on something it should not.

**What stays uncovered is the embedding, on every platform — not one platform.**
Every run drives the shipping engine inside a test host: the small reference
browser that comes with the Linux driver, the system browser on macOS. The
application embeds the same engine in its own webview. So the engine is covered
everywhere and the embedding nowhere — window chrome, focus handling, and
whatever the embedding changes about editing behaviour. Named in every report,
together with the manual pass that stands in for it.

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
