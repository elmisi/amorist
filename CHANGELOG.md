# Changelog

All notable changes to amorist are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.10] - 2026-05-26

### Added
- `build-appimage.sh`: build script for portable AppImage bundle, mirroring
  `build-install-deb.sh` without sudo/dpkg; prints the path and the
  `--install-desktop` one-liner after a successful build.

## [0.5.9] - 2026-05-26

### Fixed
- `run_uninstall_desktop()`: icon-removal errors are now surfaced as warnings on
  stderr instead of being silently swallowed; `removed` is only set to `true`
  when `fs::remove_file` actually succeeds, so a failed removal no longer causes
  a false "Removed amorist desktop entry and icons." message.

### Changed
- Added clarifying comment above `ICON_256` constant explaining why
  `128x128@2x.png` (the 256×256 px HiDPI asset) is the correct source for the
  `256x256` hicolor slot.
- Added comment in `run_install_desktop()` above the `install_icon` calls
  explaining why icons are always overwritten (no feasible ownership marker for
  PNG files; namespace collision on "amorist.png" is not realistic).
- Added comment in `exec_path()` explaining that `current_exe()` resolves
  `/proc/self/exe` through symlinks, making it safe for the `.desktop` Exec line.

## [0.5.8] - 2026-05-26

### Added
- `check_desktop_flags()` dispatcher in `src-tauri/src/lib.rs`: reads
  `--install-desktop` and `--uninstall-desktop` CLI flags via `app.cli().matches()`
  and delegates to `run_install_desktop()` / `run_uninstall_desktop()` on Linux.
  Returns an error on non-Linux platforms with a clear message directing users to
  the `.app` bundle. Wired into `setup()` immediately after `check_install_cli`,
  so both flags are handled before the window opens and the process exits cleanly
  (`std::process::exit(0)`) on success. Eliminates dead-code warnings for all
  previously-unreachable desktop integration functions.

## [0.5.7] - 2026-05-26

### Added
- `run_uninstall_desktop()` in `src-tauri/src/lib.rs` (Linux-only): symmetric
  uninstall for `run_install_desktop()`. Removes `amorist.desktop` from
  `$XDG_DATA_HOME/applications/` only if the file contains the
  `StartupWMClass=amorist` marker (i.e. was written by amorist). Removes the
  embedded PNG icons from the hicolor icon theme. Runs `update-desktop-database`
  and `gtk-update-icon-cache` best-effort. Not yet wired into `setup()` (Task 6).

## [0.5.6] - 2026-05-26

### Added
- `run_install_desktop()` in `src-tauri/src/lib.rs` (Linux-only): writes the
  freedesktop `.desktop` entry to `$XDG_DATA_HOME/applications/amorist.desktop`
  and installs embedded PNG icons (`128x128` and `256x256`) into the hicolor
  icon theme under `$XDG_DATA_HOME/icons/hicolor/`. Embedded via `include_bytes!`
  so the icons are available regardless of packaging (AppImage, deb, dev build).
  Respects `$APPIMAGE` for the `Exec=` path, falls back to `current_exe()`.
  Runs `update-desktop-database` and `gtk-update-icon-cache` best-effort.
  Not yet wired into `setup()` (Task 6).

## [0.5.5] - 2026-05-26

### Added
- `desktop_entry(exec)` pure builder function in `src-tauri/src/lib.rs`: generates
  the freedesktop `.desktop` file content with `Exec=%f`, `MimeType=text/markdown;`,
  `Categories=Office;TextEditor;Utility;`, `Icon=amorist`, and `StartupWMClass=amorist`.
  Covered by a unit test (`desktop_entry_includes_exec_with_file_placeholder`).

## [0.5.4] - 2026-05-26

### Added
- `tauri.conf.json`: declared `--install-desktop` and `--uninstall-desktop` CLI
  flags in `plugins.cli.args`. These config-only entries let `tauri-plugin-cli`
  parse the flags; Rust handlers will be wired in subsequent EL-171 tasks.

## [0.5.3] - 2026-05-26

### Fixed
- Linux `.desktop` template: `StartupWMClass` is now the hardcoded logical name
  `amorist` instead of `{{exec}}`, so taskbar grouping works correctly when the
  binary is launched from an absolute path (AppImage, dev). `MimeType` line now
  carries a trailing semicolon as required by the freedesktop spec.

## [0.5.2] - 2026-05-26

### Fixed
- Linux `.desktop` entry now includes `%f` in the `Exec` line, so launching
  amorist via "Open with" or double-click in a file manager correctly passes the
  file path. The freedesktop categories (`Office;TextEditor;Utility;`) are also
  populated, replacing the empty default.

## [0.5.1] - 2026-05-25

### Fixed
- Bold (or italic, or a link) wrapping an inline-code span is no longer corrupted
  on save. Nested inline constructs such as `**`code`**` were serialized as the
  literal `**0**`, silently destroying content; they now round-trip intact. The
  fix is general to any inline nesting (bold/italic/link around code or links).

### Changed
- Internal: inline rendering placeholders are now handled by a single
  `createInlineTokenizer` helper with one named sentinel constant, and expansion
  repeats until no placeholders remain so nested tokens always resolve.

## [0.5.0] - 2026-05-20

### Added
- macOS `.dmg` build: universal binary (Intel + Apple Silicon) produced by CI on
  every push to `main` and attached to the GitHub release alongside the Linux `.deb`.
- `src-tauri/icons/icon.icns` for macOS bundling, generated from `icon.png`.
- README: macOS install section with prebuilt `.dmg` instructions, Gatekeeper note
  for the unsigned bundle, and source-build commands for universal binaries.

### Changed
- CI workflow `build-deb.yml` replaced by `build.yml`: matrix build across
  `ubuntu-latest` (deb) and `macos-latest` (universal dmg), with a dedicated
  release job that publishes both artifacts under the same `v$VERSION` tag.
- `tauri.conf.json` `bundle.icon` now includes `icons/icon.icns`.

### Fixed
- macOS: closing the window now quits the process instead of leaving a
  background app with no UI. Cocoa keeps the app alive after the last
  window closes by default; the `CloseRequested` handler now calls
  `app_handle.exit(0)` explicitly on macOS, and the `force_close` IPC
  command routes through the same path. Linux behavior is unchanged
  (`#[cfg(target_os = "macos")]`).
- macOS: confirm dialogs now appear when closing a modified document,
  when reloading with unsaved changes, and when saving a file modified
  externally. WKWebView on macOS silently drops `window.confirm`; all
  three call sites now use `tauri-plugin-dialog`, which shows a native
  NSAlert on macOS and a native GTK dialog on Linux. `window.confirm`
  remains the fallback for the deprecated HTTP/browser mode.
- macOS: window now takes focus on launch instead of opening behind the
  terminal. `window.set_focus()` is invoked after `set_title` in the
  setup callback.

### Changed
- Webview devtools enabled in release builds (`devtools` feature on the
  `tauri` crate). Right-click → Inspect (or Cmd+Opt+I) now works in
  shipped binaries to make diagnosing webview-specific issues possible.

### Added
- `amorist --install-cli` flag: creates a symlink at `~/.local/bin/amorist`
  pointing to the current binary, so users who installed the macOS `.dmg`
  can invoke `amorist file.md` from any shell. Detects whether the
  directory is on `PATH` and prints the missing `export` line otherwise.
  Idempotent and refuses to overwrite a non-symlink file. Unix only.

## [0.4.0] - 2026-05-20

### Added
- Undo/redo with markdown-level history stack (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z).
  Tracks markdown snapshots with 500ms debounce, survives mode switches, 100-entry
  cap with ~50M UTF-16 code unit memory limit.
- In-editor find bar (Ctrl+F) with case-insensitive search, real-time highlighting,
  Enter/Shift+Enter match navigation, Escape to close, and "N of M" match counter.
- WYSIWYG find uses TreeWalker + `<mark>` wrapping with automatic cleanup before
  serialization to prevent markdown corruption.
- Source mode find uses textarea selection range for match highlighting.
- Find bar persists across WYSIWYG/source mode switches.
- Unit tests for MarkdownHistory and browser smoke tests for undo/find.

## [0.3.0] - 2026-05-20

### Added
- Tauri 2 standalone app: native webview window with Rust backend, replacing the
  Python HTTP server + browser tab architecture. Single binary, no Python required.
- Rust IPC commands (`read_document`, `save_document`, `get_version`) with atomic
  writes, UTF-8 validation, line ending preservation, and 10 MB file size limit.
- Backend abstraction in `web/app.js`: detects `window.__TAURI__` at startup and
  routes I/O through Tauri IPC or HTTP fetch transparently.
- CLI file argument with extension validation (`.md`, `.markdown`, `.mdown`),
  `file://` URI handling, and absolute path resolution.
- Linux `.desktop` file association for `.md`/`.markdown`/`.mdown` files.
- Version baked at compile time from `VERSION` file via `build.rs`.
- App icon (1024x1024 source) with generated icon set for all platforms.

### Changed
- `web/index.html` uses relative asset paths (works in both Tauri and Python modes).
- `bin/amorist` `send_static()` serves both `/web/`-prefixed and relative paths.
- Python server mode marked as deprecated in README and CLAUDE.md.

## [0.2.2] - 2026-05-19

### Added
- Horizontal rule shortcut triggers on Space too (type `---`, `***`, or `___`
  then Space or Enter).
- H4–H6 heading support: parser, renderer, serializer, `#### ` shortcut, and
  editor CSS.

### Changed
- Code block styling uses a light background (`#f3f6f7`) with dark text instead
  of white-on-dark, matching the surrounding editor aesthetic.

## [0.2.1] - 2026-05-19

### Fixed
- Save fails with "Failed to fetch" after browser tab is idle for several minutes.
  Server heartbeat timeout increased from 12 s to 120 s to tolerate browser
  throttling; client shows a warning banner after 3 consecutive ping failures.
- Lists gain empty blank lines when switching to source mode. List items are now
  serialized as a single block instead of separate entries joined by double
  newlines.
- `---` (and `***`, `___`) not rendered as horizontal rule. Added full `hr` block
  type: parser, renderer, serializer, Enter shortcut, and editor CSS.

### Changed
- Save and reload use a 10-second fetch timeout (AbortController) instead of
  waiting for the browser default.
- Save automatically retries once on network error or timeout before showing
  an error.
- Server returns structured JSON errors on file-write failures (disk full,
  permission denied) and cleans up orphaned temp files.
- Notice banner distinguishes warnings (amber) from errors (red) so ping-loss
  warnings don't mask save/reload errors.

## [0.2.0] - 2026-05-18

### Changed
- Installer runs without a confirmation prompt and prints a shorter action/result
  summary.
- Installer no longer escalates privileges or invokes a package manager.
  Scope is chosen from `EUID`: root installs system-wide to `/opt/amorist`
  + `/usr/local/bin/amorist`; non-root installs user-locally to
  `$XDG_DATA_HOME/amorist` (default `~/.local/share/amorist`) +
  `~/.local/bin/amorist`.
- Uninstaller mirrors the same scope rule.

### Removed
- `apt-get` invocation and Ubuntu/Debian-only `/etc/os-release` detection from
  `scripts/install.sh`.
- Automatic installation of `python3` and `xdg-utils`. `python3` is now a
  hard prerequisite the installer checks for; `xdg-open` remains optional
  (the launcher already prints the URL when `xdg-open` is absent, see
  `bin/amorist:258-267`).
