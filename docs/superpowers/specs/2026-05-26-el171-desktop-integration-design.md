# EL-171 — Desktop integration (Linux)

**Card:** EL-171-desktop-integration · label `amorist`
**Branch:** `feature/el171-desktop-integration`
**Date:** 2026-05-26

## Problem

On Ubuntu/Linux the user wants amorist to:
- appear in the "Open with" menu for Markdown files;
- be installable as a portable AppImage (no sudo);
- register itself at user level.

Explicitly **not** wanted: forcing amorist as the system-wide *default* `.md` handler.

### Root cause found

Tauri 2.11's stock freedesktop template is:

```
Exec={{exec}}
StartupWMClass={{exec}}
Categories={{categories}}
```

The generated `.desktop` therefore emits `Exec=amorist` with **no `%f`/`%F` placeholder** and an **empty `Categories=`**. Consequence: launching amorist via "Open with" or double-click does **not** pass the file path, so nothing opens. Verified against `tauri-bundler` source in the cargo cache (`main.desktop` template) for the version in use (2.11.2).

amorist's CLI already accepts a positional file argument (`resolve_file_arg` in `src-tauri/src/lib.rs`), so once a path is passed it opens correctly. The gap is purely in how the launcher invokes the binary.

## Approach

Three independent pieces, all additive (the existing `build-install-deb.sh` system flow stays in parallel).

### 1. Custom `.desktop` template for the `.deb`

- Add `src-tauri/linux/amorist.desktop` (handlebars template) with:
  - `Exec={{exec}} %f` — `%f` (single local file), because amorist opens one file at a time; `%F` would hand multiple files to a single-file app.
  - `Categories=Office;TextEditor;Utility;`
  - `MimeType={{mime_type}}` (unchanged — keeps `text/markdown`).
  - Keep `StartupWMClass`, `Icon`, `Name`, `Terminal=false`, `Type=Application`.
- Point Tauri at it via `bundle.linux.deb.desktopTemplate` in `src-tauri/tauri.conf.json`.

### 2. AppImage build

- Add `appimage` as a build target. New `build-appimage.sh` running `cargo tauri build --bundles appimage` (mirrors `build-install-deb.sh` structure, **without** sudo/dpkg).
- The AppImage is portable; desktop registration is handled by the `--install-desktop` flag below, not by the AppImage itself.

### 3. `amorist --install-desktop` flag (Linux)

A twin of the existing `--install-cli`, living in `src-tauri/src/lib.rs`. This is a **Linux** concern — see the macOS note below.

- Writes `~/.local/share/applications/amorist.desktop` with:
  - `Exec=<exec> %f`, where `<exec>` is `$APPIMAGE` when running from an AppImage, otherwise `std::env::current_exe()`.
  - Same `Categories` / `MimeType` as the deb template.
  - `Icon=amorist`.
- **Installs the icon** so the entry and file thumbnails are recognizable:
  - Embed the PNG icon(s) in the binary with `include_bytes!` (e.g. `icons/128x128.png`, `icons/128x128@2x.png`) so the icon is always available regardless of packaging (AppImage mount path vs deb vs dev).
  - Write them to `~/.local/share/icons/hicolor/<size>/apps/amorist.png`.
  - Run `gtk-update-icon-cache -f ~/.local/share/icons/hicolor` (best-effort; warn, don't fail, if missing).
- Runs `update-desktop-database ~/.local/share/applications` (best-effort; warn, don't fail, if the tool is missing).
- Prints the installed paths and a note that the entry is now available in "Open with".
- Add `--uninstall-desktop` that removes the `.desktop` + installed icons and refreshes both caches.
- Mirror the safety posture of `run_install_cli`: refuse to clobber a non-amorist file at the target path.

`--install-cli` stays a separate flag (user chose distinct flags, not a merged one).

### macOS

File association, default-open behaviour, and the app icon on macOS come from the bundled `.app` / `Info.plist`, which Tauri already generates from `bundle.fileAssociations` and `bundle.icon` (`.icns`). `--install-desktop` is **Linux-only** (like `--install-cli` being Unix-only). The macOS work item here is to **verify** that the `.dmg`/`.app` registers with Launch Services and shows the correct icon + "Open with → amorist" after install — no `.desktop` machinery applies. If the icon/association is missing on macOS, that is a `bundle.icon` / `Info.plist` config fix, tracked under this card's macOS verification step.

## Out of scope

- Setting amorist as the system *default* handler (`xdg-mime default`).
- `--install-desktop` on non-Linux platforms (macOS uses the `.app`/`Info.plist`; see macOS section).

## Components touched

| Component | Change |
|-----------|--------|
| `src-tauri/tauri.conf.json` | `bundle.linux.deb.desktopTemplate` pointer |
| `src-tauri/linux/amorist.desktop` | new custom template (`Exec %f`, Categories) |
| `src-tauri/src/lib.rs` | `--install-desktop` / `--uninstall-desktop` + embedded icon (`include_bytes!`) + CLI arg defs |
| `src-tauri/tauri.conf.json` (`plugins.cli.args`) | add `install-desktop`, `uninstall-desktop` args |
| `build-appimage.sh` | new build script |
| `README.md` / docs | document AppImage + `--install-desktop` |

## Testing / verification

- Build the `.deb`; inspect generated `usr/share/applications/amorist.desktop` → confirm `Exec=amorist %f` and populated `Categories`.
- Install deb; from a file manager, "Open with → amorist" on a `.md` → file opens.
- Build AppImage; run `./amorist*.AppImage --install-desktop`; confirm `~/.local/share/applications/amorist.desktop` written with `Exec=$APPIMAGE %f`, icon written under `~/.local/share/icons/hicolor`, and the entry appears in "Open with" **with the amorist icon**.
- `--uninstall-desktop` removes `.desktop` + icons cleanly.
- **macOS:** install the `.dmg`, confirm Launch Services shows amorist (correct icon) under "Open with" for a `.md` file and double-click opens it.
- Per global rule: final launch verification under a real PTY where a CLI path is involved.

## Versioning

MINOR bump (new user-facing capability). Update `VERSION` + `CHANGELOG.md`.
