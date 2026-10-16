# Plan: Tauri 2 standalone app

## Context 2

amorist is a local-first Markdown editor: Python 3 HTTP server (`bin/amorist`, 335 LOC) + vanilla JavaScript browser frontend (`web/`, ~1650 LOC across 6 files). One file at a time, no build step, no bundler, no framework.

The current architecture has an inherent friction: the user launches a CLI command, a Python HTTP server starts on a random port, `xdg-open` opens a browser tab, and the server stays alive via a heartbeat mechanism that is fragile under browser tab throttling (see the 12s→120s timeout fix in 0.2.1). The browser tab is a transient, unsaved surface — there's no system integration (window title, file association, recent files).

The goal is to package amorist as a single standalone binary that opens a native window (system webview), keeps the existing vanilla JS editor unchanged, and replaces the Python server's file I/O with Rust commands via Tauri 2's IPC.

**What changes:**

- Python server → Rust backend (Tauri commands for read/save/version)
- Browser tab → native webview window
- HTTP fetch → `invoke()` IPC
- Token auth, heartbeat, close-beacon → removed (single-process, no HTTP)
- CLI arg handling → Tauri CLI plugin

**What stays identical:**

- All editor files (`web/editor/`: 5 JS modules + `amorist-editor.css`, 1317 LOC) — zero changes. The editor is a standalone embeddable component designed for reuse in other projects (e.g., editing Markdown fields in a database UI). This plan must not introduce any coupling between the editor and the Tauri app shell.
- HTML structure, CSS — minimal path adjustments
- Markdown-as-source-of-truth model, atomic writes, line ending preservation

**Design constraint — editor embeddability:** The `web/editor/` directory (5 JS + 1 CSS, 1317 LOC) is a self-contained component that reads/writes `window.AmoristInternals` and exports `window.AmoristEditor.create()`. It has zero knowledge of the app shell, the backend, or Tauri. This boundary must be preserved: no `invoke()` calls, no `__TAURI__` references, no app-shell state may leak into the editor files. All Tauri integration lives in `web/app.js` only.

**Relevant files at commit 0 (current HEAD of 1):**

| File                                   | LOC | Role                                               |
| -------------------------------------- | --- | -------------------------------------------------- |
| `bin/amorist`                          | 335 | Python HTTP server (to be superseded, not deleted) |
| `web/app.js`                           | 325 | App shell: save/reload, heartbeat, dirty tracking  |
| `web/index.html`                       | 41  | Entry point with `<script>` tags                   |
| `web/app.css`                          | 183 | App-level styling                                  |
| `web/editor/amorist-editor.js`         | 334 | Editor UI shell                                    |
| `web/editor/amorist-editing-policy.js` | 429 | Contenteditable shortcuts                          |
| `web/editor/amorist-markdown-codec.js` | 310 | Markdown parser/renderer/serializer                |
| `web/editor/amorist-table-codec.js`    | 218 | Pipe table parser                                  |
| `web/editor/amorist-text-utils.js`     | 26  | Normalize, escapeHtml, escapeAttr                  |
| `scripts/install.sh`                   | 128 | Shell installer (Python mode)                      |

## How to work with this plan

Read the entire plan before acting. Context, approach, edge cases, and open questions are all load-bearing.

For operational instructions (how to annotate, review, analyze impact, check quality): see the companion file `plan-tauri2-standalone-20260519-2334.ops.md` in the same directory.

## Approach

### Dual-mode frontend, single `web/` directory

The project's core principle is "no build tooling." Tauri 2 supports this via `"app.withGlobalTauri": true` in `tauri.conf.json`, which injects `window.__TAURI__` into the webview at runtime. The frontend detects this global and switches between Tauri IPC and HTTP fetch — no npm, no bundler, no import maps.

The `web/` directory stays the single source of truth for the frontend. The editor files (`web/editor/`) are untouched. `web/app.js` gains a backend abstraction layer that routes I/O through either `window.__TAURI__.core.invoke()` (standalone) or `fetch()` (Python server). The Python server (`bin/amorist`) is kept during the transition for development convenience but is being deprecated — once the Tauri app is stable, the HTTP backend, heartbeat, and token auth code will be removed in a follow-up cleanup.

### Asset path unification

Current `web/index.html` uses absolute paths prefixed with `/web/` (e.g. `/web/editor/amorist-editor.css`). This works because the Python server maps `/web/*` → `WEB_ROOT`. Tauri's asset serving sets `frontendDist` as the root, so the prefix would break.

**Solution:** Change `index.html` to use relative paths (`editor/amorist-editor.css` instead of `/web/editor/amorist-editor.css`). Update the Python server's `send_static()` to resolve paths from `WEB_ROOT` for requests that don't start with `web/`, so both modes work with the same HTML file.

Verification: `web/index.html` has 9 asset references (3 CSS/icon links + 6 script tags) — all use the `/web/` prefix. The Python server's `send_static()` at `bin/amorist:203-221` only accepts paths starting with `web/`. Both need updating.

### Project layout

```
amorist/
├── src-tauri/
│   ├── Cargo.toml
│   ├── build.rs
│   ├── tauri.conf.json
│   ├── capabilities/
│   │   └── default.json
│   ├── icons/                # Generated by `cargo tauri icon`
│   └── src/
│       ├── main.rs           # Entry point (Windows subsystem config)
│       └── lib.rs            # Tauri builder, commands, state
├── bin/amorist               # Python server (deprecated, kept for transition)
├── web/                      # Shared frontend
│   ├── index.html            # Updated: relative paths
│   ├── app.js                # Updated: backend abstraction
│   ├── app.css               # Unchanged
│   ├── favicon.ico           # Unchanged
│   └── editor/               # Unchanged (5 JS modules + CSS)
├── scripts/                  # Kept (Python-mode installers)
├── tests/                    # Kept + new Tauri-specific tests
├── VERSION                   # Read by both Python and Rust
└── CHANGELOG.md
```

`src-tauri/tauri.conf.json` points `frontendDist` to `"../web"`, so the webview serves files directly from the existing `web/` directory with no copy step.

---

## Detailed Changes

### 1. Scaffold Tauri 2 project

Create the `src-tauri/` directory with the minimal Tauri 2 structure. Install `cargo-tauri` as a Cargo subcommand (`cargo install tauri-cli --version "^2"`) — no npm, no `package.json`, no Node.js required at runtime. All Tauri commands run from `src-tauri/`: `cd src-tauri && cargo tauri dev` / `cargo tauri build`. This avoids needing a workspace `Cargo.toml` in root and keeps the Rust tooling isolated in `src-tauri/`.

**0:**

```
[package]
name = "amorist"
version = "0.0.0"  # overridden at build time from VERSION file
edition = "2021"

[lib]
name = "amorist_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-cli = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
strip = true
lto = true
codegen-units = 1
```

**0** (initial, replaced by version-aware build in change 6):

```
fn main() {
    tauri_build::build()
}
```

**0** (key fields):

```
{
  "productName": "amorist",
  "version": "0.0.0",
  "identifier": "dev.elmisi.amorist",
  "build": {
    "frontendDist": "../web"
  },
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "amorist",
        "width": 960,
        "height": 720,
        "minWidth": 480,
        "minHeight": 360
      }
    ]
  },
  "plugins": {
    "cli": {
      "description": "Local Markdown editor",
      "args": [
        {
          "name": "file",
          "index": 1,
          "takesValue": true,
          "required": false
        }
      ]
    }
  }
}
```

**0:**

```
{
  "identifier": "default",
  "description": "Default capabilities for amorist",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "cli:default"
  ]
}
```

Note: we do NOT use `tauri-plugin-fs`. File I/O goes through custom Rust commands that enforce the "one file at a time" model and preserve atomic-write + line-ending semantics. The FS plugin's sandbox model would add permission complexity for no benefit, since the file path is known at startup from the CLI argument. `tauri-plugin-dialog` stays out of the baseline scope and is introduced only if Task 18 proves `window.confirm()` does not work in the Tauri WebKitGTK webview.

**0:**

```
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    amorist_lib::run()
}
```

**Success criteria:** `cd src-tauri && cargo tauri dev` opens a native window showing the amorist editor UI (with broken I/O — the Rust commands aren't wired yet).

---

### 2. Rust backend commands

**0** — three commands replace the Python server's API:

```
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use serde::Serialize;
use tauri::{App, AppHandle, Manager, State};

struct AppState {
    file_path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentResponse {
    path: String,
    name: String,
    exists: bool,
    line_ending: String,
    markdown: String,
}

#[derive(Serialize)]
struct SaveResponse {
    saved: bool,
    path: String,
}

#[tauri::command]
fn read_document(state: State<AppState>) -> Result<DocumentResponse, String> {
    // Read file_path from state
    // If file exists: read bytes, detect LF vs CRLF, normalize to LF, return JSON
    // If file doesn't exist: return { path, name, exists: false, lineEnding: "lf", markdown: "" }
    // On error: return Err(error.to_string())
}

#[tauri::command]
fn save_document(
    state: State<AppState>,
    markdown: String,
    line_ending: String,
) -> Result<SaveResponse, String> {
    // Atomic write: mkdir parents, write to .amorist-tmp, rename to target
    // Encode line endings (LF→CRLF if needed)
    // On error: clean up tmp file, return Err with OS error message
    // On success: return { saved: true, path }
}

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
```

**Command argument naming:** Use the default Tauri command naming convention. Do not add `#[tauri::command(rename_all = "...")]` to these commands. The JS side sends camelCase keys, so `invoke("save_document", { markdown, lineEnding })` maps to the Rust parameters `markdown` and `line_ending`. This follows Tauri 2's documented default: Rust snake_case arguments are called from JavaScript with camelCase keys.

**UTF-8 validation:** `read_document` must validate UTF-8 encoding before processing. If the file contains invalid UTF-8 bytes, return `Err("Markdown files must be UTF-8 encoded.")` — the same message used by the Python server (`bin/amorist` line 138). The file must not be modified on read failure. This matches the behavior verified in `tests/test_runtime_server.py::test_invalid_utf8_read_returns_415_and_preserves_file`.

**Line ending logic** (ported 1:1 from `bin/amorist` lines 250-264):

- `detect_line_ending`: if raw bytes contain `\r\n` → `"crlf"`, else `"lf"`
- `normalize_line_endings`: replace `\r\n` and `\r` with `\n`
- `encode_line_endings`: if `"crlf"`, replace `\n` with `\r\n`

**Atomic write** (ported from `bin/amorist` lines 174-179):

- `let name = path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default();`

`let tmp_path = path.with_file_name(format!(".{}.amorist-tmp", name));`   If `file_name()` returns `None` (path is `/` or empty), `read_document` / `save_document` should already have returned `Err` from the extension validation check (see below).

- Create parent dirs, write to tmp, rename tmp to target
- On error: attempt to remove tmp, return error

**Builder setup:**

```
const ALLOWED_EXTENSIONS: &[&str] = &["md", "markdown", "mdown"];

fn resolve_file_arg(app: &App) -> Result<Option<PathBuf>, String> {
    let matches = app
        .cli()
        .matches()
        .map_err(|error| format!("CLI argument parsing failed: {error}"))?;
    let Some(file_arg) = matches.args.get("file") else {
        return Ok(None);
    };
    let Some(raw) = file_arg.value.as_str() else {
        return Ok(None);
    };

    // Desktop file associations may pass file:// URIs
    let path_str = if raw.starts_with("file://") {
        url_to_path(raw)?
    } else {
        raw.to_string()
    };

    let path = std::fs::canonicalize(&path_str)
        .unwrap_or_else(|_| std::env::current_dir().unwrap().join(&path_str));

    let ext = path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err("amorist only opens .md, .markdown, and .mdown files.".into());
    }

    Ok(Some(path))
}

fn url_to_path(uri: &str) -> Result<String, String> {
    let stripped = uri.strip_prefix("file://").unwrap_or(uri);
    Ok(percent_decode(stripped))
}
// percent_decode: replace %XX sequences with the corresponding byte

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .manage(AppState {
            file_path: Mutex::new(None),
        })
        .setup(|app| {
            match resolve_file_arg(app) {
                Ok(Some(path)) => {
                    let state: State<AppState> = app.state();
                    *state.file_path.lock().unwrap() = Some(path.clone());
                    if let Some(window) = app.get_webview_window("main") {
                        let name = path.file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let _ = window.set_title(&format!("amorist — {}", name));
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    #[cfg(debug_assertions)]
                    eprintln!("{error}");
                    return Err(error.into());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_document,
            save_document,
            get_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`resolve_file_arg()` intentionally returns `Result<Option<PathBuf>, String>` instead of `Option<PathBuf>`. `Ok(None)` is the valid "no file argument" launch path; `Err(...)` is a CLI parsing/configuration failure and should fail setup after logging in debug builds, so malformed arguments do not silently become the empty-state path.

**File path resolution:** If the user passes a relative path (`amorist notes.md`), `canonicalize()` resolves it to absolute. If the file doesn't exist yet, `canonicalize()` fails — the fallback in the `setup()` snippet must use `std::env::current_dir().unwrap().join(path_str)` to ensure the stored path is always absolute. Corrected snippet for the fallback:

```
let path = std::fs::canonicalize(path_str)
    .unwrap_or_else(|_| std::env::current_dir().unwrap().join(path_str));
```

This matches the Python server's `Path(args.file).expanduser().resolve()` at `bin/amorist` line 43.

**10 MB limit:** Enforced in `read_document` before reading (check `fs::metadata().len()`) and in `save_document` before writing (check `markdown.len()`). Matches `MAX_MARKDOWN_BYTES = 10 * 1024 * 1024` from `bin/amorist` line 21.

**Extension validation:** The `setup()` hook must validate the file extension against the allowed set (`.md`, `.markdown`, `.mdown`) before storing the path in `AppState`. If the extension is invalid, show an error dialog or exit with a clear message: "amorist only opens .md, .markdown, and .mdown files." This matches the Python server's check at `bin/amorist` lines 44-46. The validation runs in `setup()`, not in `read_document` — rejecting early avoids loading the UI for an invalid file.

**Success criteria:** `invoke('read_document')` returns the same JSON shape as the Python server's `GET /api/document`. `invoke('save_document', { markdown, lineEnding })` performs an atomic write with line ending preservation, identical to the Python server.

---

### 3. Update `web/index.html` — relative asset paths

Change all 9 asset references from `/web/`-prefixed absolute paths to relative paths:

```
<!-- Before -->
<link rel="icon" href="/web/favicon.ico" sizes="any" />
<link rel="stylesheet" href="/web/editor/amorist-editor.css" />
<link rel="stylesheet" href="/web/app.css" />
<script src="/web/editor/amorist-text-utils.js"></script>
<script src="/web/editor/amorist-table-codec.js"></script>
<script src="/web/editor/amorist-markdown-codec.js"></script>
<script src="/web/editor/amorist-editing-policy.js"></script>
<script src="/web/editor/amorist-editor.js"></script>
<script src="/web/app.js"></script>

<!-- After -->
<link rel="icon" href="favicon.ico" sizes="any" />
<link rel="stylesheet" href="editor/amorist-editor.css" />
<link rel="stylesheet" href="app.css" />
<script src="editor/amorist-text-utils.js"></script>
<script src="editor/amorist-table-codec.js"></script>
<script src="editor/amorist-markdown-codec.js"></script>
<script src="editor/amorist-editing-policy.js"></script>
<script src="editor/amorist-editor.js"></script>
<script src="app.js"></script>
```

**Success criteria:** Same HTML file works in both Tauri (assets served from `frontendDist: "../web"`) and Python server (after the `send_static` update in change 4).

---

### 4. Update `bin/amorist` — serve relative asset paths

Modify `send_static()` (`bin/amorist` lines 203-221) to also resolve paths directly from `WEB_ROOT` when the request doesn't start with `web/`:

```
def send_static(self, request_path: str) -> None:
    relative = request_path.lstrip("/")
    if relative.startswith("web/"):
        path = APP_ROOT / relative
    else:
        path = WEB_ROOT / relative

    # ... rest of path validation unchanged
```

The existing security check (`resolved == web_root or web_root in resolved.parents`) continues to prevent path traversal — it validates against `WEB_ROOT` regardless of which branch resolved the path.

**Verification:** `grep -n 'web_root' bin/amorist` shows the security check at lines 217-218 uses `web_root = WEB_ROOT.resolve()`. Both the `web/`-prefixed and direct resolution paths produce a file under `WEB_ROOT`, so the check covers both.

**Success criteria:** `http://localhost:PORT/editor/amorist-editor.css` serves the same file as `http://localhost:PORT/web/editor/amorist-editor.css`. All existing tests pass.

---

### 5. Refactor `web/app.js` — backend abstraction

Replace the monolithic app shell with a backend detection layer. The core change: at the top of the IIFE, detect `window.__TAURI__` and build the appropriate I/O functions. The rest of the app calls these functions without knowing which backend is active.

**Backend interface:**

```
// Returns one of these two implementations
function createBackend() {
  if (window.__TAURI__) return createTauriBackend();
  return createHttpBackend();
}

// Tauri backend: invoke() IPC, no auth, no heartbeat
function createTauriBackend() {
  const { invoke } = window.__TAURI__.core;
  const { getCurrentWebviewWindow } = window.__TAURI__.webviewWindow;
  return {
    async loadDocument() {
      return invoke("read_document");
    },
    async saveDocument(markdown, lineEnding) {
      return invoke("save_document", { markdown, lineEnding });
    },
    async getVersion() {
      return invoke("get_version");
    },
    async registerCloseGuard(isDirty) {
      await getCurrentWebviewWindow().onCloseRequested((event) => {
        if (isDirty()) event.preventDefault();
      });
    },
    async setWindowTitle(name) {
      if (name) await getCurrentWebviewWindow().setTitle(`amorist — ${name}`);
    },
    startHeartbeat() {},      // no-op: no server to keep alive
    notifyClose() {},         // no-op: Tauri handles window lifecycle
  };
}

// HTTP backend: fetch + token auth + heartbeat (current behavior)
function createHttpBackend() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  return {
    async loadDocument() { /* existing fetch logic */ },
    async saveDocument(markdown, lineEnding) { /* existing fetch logic */ },
    async getVersion() { /* existing fetch logic */ },
    registerCloseGuard(isDirty) {
      window.addEventListener("beforeunload", (event) => {
        if (!isDirty()) return;
        event.preventDefault();
        event.returnValue = "";
      });
    },
    async setWindowTitle(_name) {}, // browser tab title stays as today
    startHeartbeat() { /* existing ping loop with failure tracking */ },
    notifyClose() { /* existing sendBeacon logic */ },
    isHttpMode: true,
  };
}
```

**What gets removed from the top-level IIFE:**

- `const token = params.get("token") || ""` — moves into `createHttpBackend`
- `fetchWithTimeout()`, `extractErrorDetail()` — move into `createHttpBackend`
- `startHeartbeat()` — moves into `createHttpBackend`
- `notifyTabClosing()` — moves into `createHttpBackend`
- Token-missing check (`if (!token)`) — only runs when `backend.isHttpMode` is true (Tauri mode has no token)
- `handleBeforeUnload()` — replaced by `backend.registerCloseGuard(() => state.dirty)`, so the app shell does not branch on Tauri directly
- `screenshotMode` and `loadDemo()` stay in the top-level IIFE. They are HTTP/docs-only: `scripts/capture-screenshots.sh` loads `?screenshot=source` / `?screenshot=empty` through the Python server. In Tauri mode `window.location.search` is empty, so demo mode is inert and does not need standalone support.

**What stays in the top-level IIFE:**

- All DOM element references, state, demo mode
- `reloadDocument()`, `saveDocument()` — refactored to call `backend.loadDocument()` / `backend.saveDocument()`
- `mountEditor()`, `handleKeyDown()`, `setDirty()`, `showError()`, `showWarning()`, `hideNotice()`
- `noticeSource` and `showWarning()` stay during dual-mode transition. They are only exercised by the HTTP heartbeat path; in Tauri mode they are dead code by design and should be removed in the follow-up Python-deprecation cleanup together with heartbeat/token support.
- `backend.registerCloseGuard(() => state.dirty)` is called once during initialization. In HTTP mode it registers the existing `beforeunload` warning. In Tauri mode it registers `onCloseRequested` through `createTauriBackend`; this shows no dialog and simply prevents the window from closing while dirty. The user must save or discard first.

**Dialog compatibility gate:** `reloadDocument()` keeps using `window.confirm("Discard unsaved changes and reload the file?")` in both modes. The editor also uses `window.prompt("URL")` inside `web/editor/amorist-editing-policy.js` for link creation; because that call lives inside the editor boundary, this plan cannot replace it with Tauri-specific code without breaking embeddability. Task 18 must verify both `window.confirm` and `window.prompt` in the Tauri WebKitGTK webview. If `window.confirm` fails but `window.prompt` works, add `tauri-plugin-dialog` only for app-shell confirmations. If `window.prompt` fails, stop the zero-editor-change approach and decide between an app-provided prompt abstraction or disabling the link shortcut in standalone mode.

**Error handling in Tauri mode:** `invoke()` rejects with a string (the `Err(String)` from Rust). No timeout/retry logic needed — IPC is local and near-instant. Add a shared error normalization helper used by both backends:

```
function errorMessage(error, fallback) {
  if (typeof error === "string") return error;
  if (error && error.message) return error.message;
  return fallback;
}
```

All `showError` calls use `errorMessage(error, "The document could not be saved.")` instead of `error.message` directly. This prevents `[object Object]` in the banner when Tauri's invoke rejects with a plain string.

**Window title:** After `loadDocument()` succeeds, call `backend.setWindowTitle(document.name || "")`. The Tauri backend updates the native window title via `getCurrentWebviewWindow().setTitle(...)`; the HTTP backend is a no-op. Outside `createTauriBackend()`, `web/app.js` must not read `window.__TAURI__` directly.

**Success criteria:**

- Tauri mode: `invoke()` calls replace all `fetch()` calls. No heartbeat, no token, no close beacon.
- App shell mode branching is encapsulated in `createBackend()`; no direct `window.__TAURI__` checks remain outside `createTauriBackend()`.
- HTTP mode: identical behavior to current code (same fetch logic, same error handling, same heartbeat).
- Both: same user-visible editor behavior.

---

### 6. Version synchronization

The Python server reads `VERSION` at runtime. The Tauri binary should bake its version at compile time.

**Approach:** Three version surfaces must agree: runtime (`get_version()`), Cargo package, and Linux bundle/installer.

Note: `build.rs` runs with its working directory set to `src-tauri/` (the package root), so `../VERSION` resolves correctly to the repo-root `VERSION` file.

```
// src-tauri/build.rs
fn main() {
    let version = std::fs::read_to_string("../VERSION")
        .unwrap_or_else(|_| "0.0.0".to_string())
        .trim()
        .to_string();
    // Runtime: env!("CARGO_PKG_VERSION") in get_version()
    println!("cargo:rustc-env=CARGO_PKG_VERSION={}", version);
    tauri_build::build()
}
```

**Cargo.toml version:** Keep `version = "0.0.0"` in `Cargo.toml` — the `build.rs` override controls the runtime version. Cargo metadata (for `crates.io`) is irrelevant since this isn't published.

**Bundle version:** Tauri reads the version for `.deb` packaging from `tauri.conf.json`'s `"version"` field, NOT from `Cargo.toml`. Strategy: add a pre-build step (Makefile target or shell one-liner) that patches `tauri.conf.json` before `cargo tauri build`:

```
VERSION=$(cat ../VERSION) && \
  sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" tauri.conf.json && \
  cargo tauri build
```

Alternatively, keep `tauri.conf.json` at `"version": "0.0.0"` and accept that the `.deb` package version is always `0.0.0` until a proper release pipeline is set up. For this plan, use the `sed` approach — it's simple and correct.

**Success criteria:** `get_version()` returns the same string as `cat VERSION`.

---

### 7. App icons

Tauri requires icon files in multiple formats for packaging. The existing `web/favicon.ico` was generated by Claude and is too small for Tauri's requirements (needs 1024x1024 PNG as source).

**Steps:**

1. Generate a new 1024x1024 PNG icon for amorist (same visual identity as the current favicon but at high resolution). Save as `src-tauri/icons/icon.png`.
2. Run `cd src-tauri && cargo tauri icon icons/icon.png` to generate all required formats (`icon.ico`, `icon.icns`, and various PNG sizes) into `src-tauri/icons/`.
3. Also replace `web/favicon.ico` with the new icon for consistency between browser mode and standalone.

**Success criteria:** `cargo tauri build` produces a binary with a visible app icon. `web/favicon.ico` matches the standalone icon.

---

### 8. File associations (Linux)

Register amorist as a handler for `.md`, `.markdown`, and `.mdown` files on Linux.

**0 addition** (inside `"bundle"`, not `"app"` — Tauri 2 schema places file associations under the bundle configuration):

```
"fileAssociations": [
  {
    "ext": ["md", "markdown", "mdown"],
    "mimeType": "text/markdown",
    "description": "Markdown document"
  }
]
```

Tauri 2 on Linux generates a `.desktop` file during `cargo tauri build` that includes the `MimeType=text/markdown` entry. After installation (via the `.deb` package), `xdg-mime` picks up the association and the user can open `.md` files by double-clicking.

**Handling the file argument from the OS:** When the OS opens a file via association, it passes the file path through the `.desktop` `Exec=... %f` entry. The same `"file"` positional arg already configured in the CLI plugin (change 1) receives that value. `setup()` must accept both plain paths and `file://` URIs: if the string starts with `file://`, parse it as a file URI and percent-decode it before `canonicalize()` / `current_dir().join(...)`. Task 19 verifies that the generated `.desktop` file passes a value captured by `matches.args["file"]` and that double-clicking a `.md` opens the intended path.

**Success criteria:** After installing the `.deb`, right-clicking a `.md` file → "Open With" shows amorist. Double-clicking opens the file in amorist.

---

### 9. Delete stale `dist/` directory

The `dist/` directory contains artifacts from a previous Vite/React experiment (`index.html` with `<div id="root">`, bundled JS/CSS). It is not used by the current project and would confuse contributors.

**Action:** `git rm -rf dist/` to remove from the repo. `.gitignore` already contains `dist/` (verified), so no gitignore change needed.

**Success criteria:** `dist/` no longer exists in the repo.

---

### 10. Build and development commands

**Development:**

```
cd src-tauri && cargo tauri dev
```

Opens the app with hot-reload of Rust changes. Frontend changes (web/) are picked up on page reload in the webview (no hot-reload — acceptable for the current no-bundler setup).

**Build:**

```
cd src-tauri && cargo tauri build
```

Produces platform-specific installers in `src-tauri/target/release/bundle/`.

**Prerequisites (Linux):**

```
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

**Update CLAUDE.md** to document:

- `cargo tauri dev` for Tauri development
- `cargo tauri build` for release builds
- Prerequisites for each platform
- That `./bin/amorist --no-open file.md` continues to work for browser-mode development

**Success criteria:** A fresh clone can build and run the Tauri app following only the instructions in CLAUDE.md.

---

## Edge Cases and Risks

### Risk 1: System webview version differences across Linux distros

- **Likelihood:** Medium — WebKitGTK versions vary across Ubuntu 22.04 (WebKit 2.38), 24.04 (2.42), Fedora, Arch.
- **Impact:** JS features available to the editor may differ. Contenteditable behavior is particularly sensitive to WebKit version.
- **Mitigation:** amorist uses only basic DOM APIs — no Shadow DOM, no Web Components, no CSS Grid subgrid. The most exotic API is `Intl.Segmenter` (in `amorist-table-codec.js` for emoji width). `Intl.Segmenter` is available in WebKitGTK since 2.40 (Ubuntu 23.04+). On older WebKitGTK, table column alignment falls back to character-count width (acceptable degradation, already handles this case — see `amorist-table-codec.js` line 134: `if (!Intl.Segmenter)`).
- **Exit clause:** If specific WebKit versions break contenteditable behavior, the workaround is to ship with a pinned Chromium via Electron or WRY's Chromium embedding (significant binary size increase — 150 MB+).

### Risk 2: No file argument → empty state

- **Likelihood:** High — users may double-click the app binary without a file argument, or OS file associations may not pass args correctly.
- **Impact:** The app opens with no file loaded. `read_document` would fail with "No file open".
- **Mitigation:** When no CLI argument is provided, show the empty-state screen (the `web/app.js` demo already has this pattern at line 172). Message for standalone mode: "Open a Markdown file from the terminal or by double-clicking a .md file." No drag-and-drop or File → Open menu in this iteration — those require `tauri-plugin-dialog` and drop event handling, which are out of scope. The architecture supports adding them later.
- **Exit clause:** If the empty state is confusing, add the dialog plugin and auto-show a file picker on empty launch.

### Risk 3: File permissions on save

- **Likelihood:** Low — most user files are writable.
- **Impact:** Save fails silently or with an unclear error.
- **Mitigation:** Already handled — the Rust `save_document` command returns the OS error string (e.g., "Permission denied"), which the JS shows via `showError()`. This mirrors the error handling added in v0.2.1 for the Python server.
- **Exit clause:** N/A — already covered.

### Risk 4: Binary size on Linux

- **Likelihood:** Low — Tauri binaries are typically 3-8 MB.
- **Impact:** None for functionality, but worth tracking. The current Python mode has zero binary overhead (just a script).
- **Mitigation:** `Cargo.toml` profile already sets `strip = true, lto = true, codegen-units = 1`.
- **Exit clause:** If binary exceeds 15 MB, investigate which dependencies are pulling weight.

### Risk 5: `withGlobalTauri` deprecation

- **Likelihood:** Low — it's a documented Tauri 2 feature. Assumed: Tauri maintains this feature in 2.x.
- **Impact:** Would require adding a build step or module script.
- **Mitigation:** If deprecated in a future Tauri 2.x release, vendor the `@tauri-apps/api` module locally as `web/vendor/tauri-api.js` and import via a `<script type="module">` tag. No CDN — the project is local-first with no network dependency at runtime. The backend abstraction encapsulates the invoke call, so only the import line changes.
- **Exit clause:** Switch to the vendored ES module approach described above.

---

## Failure Modes and Degradation

### File doesn't exist at startup

- **What happens:** User passes `amorist new-file.md` where `new-file.md` doesn't exist.
- **Degraded behavior:** `read_document` returns `{ exists: false, markdown: "" }`. Editor mounts with empty content. First save creates the file. This is identical to the current Python server behavior (`bin/amorist` line 140-142).
- **Thresholds:** N/A.
- **Fallback:** None needed.

### File deleted while editor is open

- **What happens:** User deletes the file externally, then clicks Save.
- **Degraded behavior:** `save_document` calls `mkdir(parents=true)` before writing, so it recreates the parent directory if needed. The save succeeds. If the parent path is fundamentally invalid (e.g., a mount point that disappeared), the OS error surfaces via `showError()`.
- **Thresholds:** N/A.
- **Fallback:** User sees the OS error message and can copy content from the editor (it's still in the DOM).

### WebKitGTK missing on Linux

- **What happens:** The Tauri binary can't find `libwebkit2gtk-4.1.so`.
- **Degraded behavior:** The binary prints an error and exits. No window opens.
- **Thresholds:** Immediate failure at startup.
- **Fallback:** WebKitGTK is a hard prerequisite. The `.deb` package declares it as a dependency, so `apt install` resolves it automatically. For manual installs, document `apt install libwebkit2gtk-4.1-0` in the README. During the transition period, the Python server (`./bin/amorist file.md`) still works as a fallback on systems without WebKitGTK.

---

## Open Questions

All resolved (owner decisions, 2026-05-19):

1. ~~**Icon resolution:**~~ Create a new 1024x1024 icon from scratch. The current favicon was AI-generated and is too small. Handled in change 7.
2. ~~**File associations:**~~ Yes, register `.md`/`.markdown`/`.mdown` on Linux. Handled in change 8.
3. ~~**macOS and Windows builds:**~~ Linux only for this iteration. Owner has a physical Mac and Windows VM for follow-up work.
4. ~~**0 directory cleanup:**~~ Delete it. Handled in change 9.
5. ~~**Python server coexistence:**~~ The Python server will be deprecated. Kept during transition but not maintained long-term. The HTTP backend in `app.js` will be removed in a follow-up cleanup once Tauri is stable.

---

## Task Breakdown

**Scaffold and cleanup:**

- [ ] Task 1: Delete stale `dist/` directory
- [ ] Task 2: Create `src-tauri/` structure: `Cargo.toml`, `build.rs`, `tauri.conf.json` (with CLI plugin + file associations), `capabilities/default.json`, `src/main.rs`, `src/lib.rs` (empty builder)
- [ ] Task 3: Verify `cargo tauri dev` opens a window showing the editor (broken I/O is expected)

**Rust backend:**

- [ ] Task 4: Implement `AppState`, `read_document`, `save_document`, `get_version` commands in `lib.rs`
- [ ] Task 5: Implement `resolve_file_arg()` with extension validation, `file://` URI handling, and absolute path resolution; wire into `setup()` with window title
- [ ] Task 6: Implement version synchronization in `build.rs` — read `VERSION` file at compile time

**Frontend adaptation:**

- [ ] Task 7: Update `web/index.html` — change 9 asset references from `/web/`-prefixed to relative paths
- [ ] Task 8: Update `bin/amorist` `send_static()` — resolve non-`web/`-prefixed paths from `WEB_ROOT` (transition compatibility)
- [ ] Task 9: Refactor `web/app.js` — extract backend abstraction (`createTauriBackend` / `createHttpBackend`), wire up `invoke()` for Tauri mode

**Icons and packaging:**

- [ ] Task 10: Generate new 1024x1024 app icon, run `cargo tauri icon`, replace `web/favicon.ico`
- [ ] Task 11: Test `cargo tauri build` — verify the binary launches, opens the editor, can read/save a file

**Documentation:**

- [ ] Task 12: Update `CLAUDE.md` with Tauri build/dev commands and prerequisites
- [ ] Task 13: Update `README.md` — add standalone app section, mark Python server mode as deprecated

**Verification:**

- [ ] Task 14: Run existing Python server tests (`test_runtime_server.py`) — verify `send_static` change doesn't break anything
- [ ] Task 15: Run existing JS tests (`editor-markdown-codec.test.js`, `editor-table-codec.test.js`) — verify no regressions
- [ ] Task 16: Run browser smoke test in HTTP mode (`AMORIST_RUN_BROWSER_SMOKE=1 node tests/app-shell-smoke.test.js`) — verify `app.js` refactor doesn't break save/reload/dirty tracking. Note: this test exercises the Python server path only (spawns `./bin/amorist`); the Tauri IPC path has no automated smoke equivalent — Task 17 covers the mock-level check and Task 18 covers the manual end-to-end
- [ ] Task 17: Add a lightweight `node:vm` test for the Tauri backend path: load `app.js` with a mock `window.__TAURI__` global, verify `createTauriBackend` calls `invoke("read_document")`, `invoke("save_document", { markdown, lineEnding })`, `invoke("get_version")`, `getCurrentWebviewWindow().onCloseRequested(...)`, and `setTitle(...)`, verify no heartbeat/token/fetch code executes, and verify string rejections from `invoke()` render as user-facing error text
- [ ] Task 18: Manual test: build Tauri binary, launch with a `.md` file, edit, save, reload, verify file on disk, verify `window.confirm` on reload-with-dirty-content, verify link creation still opens `window.prompt`, and verify dirty window close is blocked by `onCloseRequested`
- [ ] Task 19: Verify file association: install `.deb`, inspect the generated `.desktop` `Exec` and `MimeType` entries, double-click a `.md` file, confirm the CLI plugin receives the path (plain path or `file://` URI) and amorist opens the intended file

Dependencies: Task 1 is independent. Task 2 → Task 3. Tasks 4-6 are independent. Task 7 → Task 8 (index.html changes must match server changes). Task 9 depends on Tasks 4 and 7. Task 10 → Task 11. Task 11 depends on Tasks 4-9. Tasks 14-16 depend on Tasks 7-9. Task 17 depends on Task 9. Tasks 18-19 depend on Task 11.