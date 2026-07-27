# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

amorist is a local-first Markdown editor with two runtime modes:

1. **Standalone app** (Tauri 2): Rust backend (`src-tauri/`) + native webview window. Single binary, no Python required.
2. **Browser mode** (deprecated): Python 3 HTTP server (`bin/amorist`) + browser tab.

Both modes share the same vanilla JavaScript frontend (`web/`). One file at a time, no build step, no bundler, no framework. Markdown is the source of truth — the editor roundtrips through Markdown on every mode switch.

## Commands

```bash
# Tauri standalone app (development)
cd src-tauri && cargo tauri dev
# Tauri standalone app (open a specific file)
cd src-tauri && cargo tauri dev -- -- notes.md
# Tauri release build
cd src-tauri && cargo tauri build

# Browser mode (deprecated, still works for development)
./bin/amorist --no-open file.md

# Contract-driven QA suite (the release gate)
node tests/qa/run.js                    # every requirement, on both engines
node tests/qa/run.js --only A           # one family
node tests/qa/run.js --engine chromium  # one engine, for debugging only
# Needs: sudo apt install webkit2gtk-driver   (and xvfb-run where there is no display)
# See tests/qa/README.md; the contract it compiles is .qa/qa-contract.yaml

# Regenerate the contract's generated companions after editing the contract
python3 .qa/tools/render-eval-matrix.py

# Unit tests
node tests/editor-table-codec.test.js
node tests/editor-markdown-codec.test.js
node tests/editor-history.test.js
python3 tests/test_runtime_server.py

# Browser smoke test (needs Chromium)
AMORIST_RUN_BROWSER_SMOKE=1 node tests/app-shell-smoke.test.js

# Syntax checks (all JS + Python + Bash)
python3 -m py_compile bin/amorist
node --check web/app.js
node --check web/editor/amorist-text-utils.js
node --check web/editor/amorist-table-codec.js
node --check web/editor/amorist-markdown-codec.js
node --check web/editor/amorist-editing-policy.js
node --check web/editor/amorist-editor.js
node --check tests/qa/run.js
bash -n scripts/install.sh
bash -n scripts/uninstall.sh
bash -n scripts/capture-screenshots.sh
```

No build step for the frontend. JS files are loaded as classic scripts in dependency order via `<script>` tags.

### Tauri prerequisites (Linux)

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
cargo install tauri-cli --version "^2"
```

## Architecture

**Tauri backend** (`src-tauri/src/lib.rs`, Rust): Three IPC commands (`read_document`, `save_document`, `get_version`). File path from CLI argument stored in `AppState`. Atomic writes via tmp+rename. Version baked at compile time from `VERSION` file.

**Python server** (`bin/amorist`, deprecated): `ThreadingHTTPServer` on `127.0.0.1:<random-port>`. Four API routes (`/api/document`, `/api/ping`, `/api/close`, `/api/version`) plus static asset serving. Token-authenticated per session.

**App shell** (`web/app.js`): Lifecycle orchestrator with backend abstraction. Detects `window.__TAURI__` at startup and routes I/O through either Tauri IPC (`invoke()`) or HTTP fetch. In Tauri mode: no heartbeat, no token, no close beacon. In HTTP mode: same fetch logic as before.

**Editor** (`web/editor/`): Five modules, all exporting to `window.AmoristInternals` via IIFE:

- `amorist-editor.js` — UI shell: toolbar, contenteditable surface, source textarea, mode toggle. Public API: `create()`, `getMarkdown()`, `setMarkdown()`, `destroy()`.
- `amorist-editing-policy.js` — Contenteditable behavior: WYSIWYG shortcuts (`# ` → heading, `- ` → list, triple-backtick → code block, `**x**` → bold, etc.), toolbar action dispatch, caret manipulation.
- `amorist-markdown-codec.js` — Markdown parser and HTML renderer. `parseBlocks()` returns typed block array; `renderMarkdown()` produces HTML with `data-source-line` attributes.
- `amorist-table-codec.js` — Pipe table parser and column aligner. Handles emoji visual width via `Intl.Segmenter`, escaped pipes, blank lines within tables.
- `amorist-text-utils.js` — `normalize()` (line endings), `escapeHtml()`, `escapeAttr()`.

Script load order matters: text-utils → table-codec → markdown-codec → editing-policy → editor.

**Data flow**: User edits in WYSIWYG (contenteditable) → on save or mode switch, HTML is serialized back to Markdown via the codec chain → Markdown POST to server → server writes atomically (tmp + rename), preserving original LF/CRLF.

## Testing

JS tests use `node:vm` to load classic browser scripts into a context with a minimal DOM shim. Python tests use `unittest` with a real server subprocess. No test framework — assertions are bare `assert` / `console.assert` calls.

## Conventions

- **No build tooling.** Plain `<script>` tags, plain CSS, Python stdlib only. Don't introduce bundlers, transpilers, or npm runtime dependencies.
- **Module pattern:** Every editor JS file wraps in an IIFE, reads/writes `window.AmoristInternals`, and guards with a dependency check at load time.
- **Atomic file writes:** Both servers save via write-to-tmp then rename. Preserve this pattern.
- **Line ending preservation:** the rule is now **per line, not per file** (contract decision D-027): every existing line keeps its own terminator byte for byte, and a line created by pressing Enter takes the terminator of the line the caret was on. No majority is computed and mixed files are not normalised. Today the backend still detects LF vs CRLF for the whole file and re-applies it; that is the behaviour the per-line rule replaces, and the editor component must stop normalising on input for it to be reachable at all.
- **Editor embeddability:** The `web/editor/` directory is a self-contained component. No `invoke()`, `__TAURI__`, or app-shell state may leak into editor files. All Tauri integration lives in `web/app.js` only.
- **The QA contract is the source of truth for correctness.** `.qa/qa-contract.yaml`
  says what "correct" means; `tests/qa/` compiles it. A check may not be weakened
  to make a run go green — amend the contract, get the amendment approved, then
  change the check. A check changed without a contract amendment is a contract
  breach whatever the suite reports.
- **Nothing may skip silently.** Anything in the suite that cannot do its job
  exits non-zero and names itself: a missing engine, an empty fixture directory,
  a requirement with no check, a gesture not exercised. A green result that
  measured nothing is the worst outcome available.
- **Semver:** `VERSION` file exists — update `VERSION` and `CHANGELOG.md` on every commit per the global semver rule.
