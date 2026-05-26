# EL-171 — Desktop integration (Linux) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make amorist appear in the Linux "Open with" menu for `.md` files (passing the file path correctly), ship a portable AppImage, and add a user-level `amorist --install-desktop` flag that registers a `.desktop` entry + icon without sudo. Verify macOS file-association/icon via the existing `.app` bundle.

**Architecture:** (1) Override Tauri's freedesktop `.desktop` template so `Exec` includes `%f` and `Categories` is populated. (2) Add an AppImage build script. (3) Add `--install-desktop`/`--uninstall-desktop` in `src-tauri/src/lib.rs`, twin of the existing `--install-cli`, embedding icon PNGs via `include_bytes!`. (4) macOS is handled by the bundled `.app`/`Info.plist` — verification only.

**Tech Stack:** Rust (Tauri 2.11), `tauri.conf.json`, bash, freedesktop `.desktop`/icon spec.

**Spec:** `docs/superpowers/specs/2026-05-26-el171-desktop-integration-design.md`

---

### Task 1: Custom `.desktop` template for the deb (fix `Exec %f`)

**Files:**
- Create: `src-tauri/linux/amorist.desktop`
- Modify: `src-tauri/tauri.conf.json` (`bundle.linux.deb.desktopTemplate`)

- [ ] **Step 1: Create the template**

`src-tauri/linux/amorist.desktop`:

```
[Desktop Entry]
Categories=Office;TextEditor;Utility;
Comment=Local Markdown editor
Exec={{exec}} %f
StartupWMClass={{exec}}
Icon={{icon}}
Name={{name}}
Terminal=false
Type=Application
{{#if mime_type}}
MimeType={{mime_type}}
{{/if}}
```

- [ ] **Step 2: Point Tauri at it**

In `src-tauri/tauri.conf.json`, add a `linux` block inside `bundle` (alongside `icon` and `fileAssociations`):

```json
    "linux": {
      "deb": {
        "desktopTemplate": "linux/amorist.desktop"
      }
    }
```

- [ ] **Step 3: Validate config JSON**

Run: `python3 -c "import json;json.load(open('src-tauri/tauri.conf.json'))"`
Expected: no error.

- [ ] **Step 4: Build the deb and inspect the generated entry**

Run: `cd src-tauri && cargo tauri build --bundles deb --config '{"version":"0.0.0"}'`
Then inspect:
`grep -E 'Exec|Categories|MimeType' src-tauri/target/release/bundle/deb/amorist_0.0.0_amd64/data/usr/share/applications/amorist.desktop`
Expected:
```
Categories=Office;TextEditor;Utility;
Exec=amorist %f
MimeType=text/markdown
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/linux/amorist.desktop src-tauri/tauri.conf.json
git commit -m "EL-171: custom .desktop template so Open-with passes the file (%f)"
```

---

### Task 2: Declare the new CLI args

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`plugins.cli.args`)

- [ ] **Step 1: Add the args**

In `plugins.cli.args`, append after the existing `install-cli` entry:

```json
        {
          "name": "install-desktop",
          "takesValue": false,
          "description": "Register a user-level .desktop entry + icon so amorist appears in 'Open with' for Markdown files, then exit. (Linux)"
        },
        {
          "name": "uninstall-desktop",
          "takesValue": false,
          "description": "Remove the user-level .desktop entry and icons installed by --install-desktop, then exit. (Linux)"
        }
```

- [ ] **Step 2: Validate config JSON**

Run: `python3 -c "import json;json.load(open('src-tauri/tauri.conf.json'))"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "EL-171: declare --install-desktop / --uninstall-desktop CLI args"
```

---

### Task 3: Pure `.desktop` content builder (TDD)

**Files:**
- Modify: `src-tauri/src/lib.rs` (add `desktop_entry` fn + `#[cfg(test)]` module)

- [ ] **Step 1: Write the failing test**

Add at the end of `src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_entry_includes_exec_with_file_placeholder() {
        let entry = desktop_entry("/home/u/.local/bin/amorist");
        assert!(entry.contains("Exec=/home/u/.local/bin/amorist %f"));
        assert!(entry.contains("MimeType=text/markdown;"));
        assert!(entry.contains("Categories=Office;TextEditor;Utility;"));
        assert!(entry.contains("Icon=amorist"));
        assert!(entry.contains("StartupWMClass=amorist"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test desktop_entry_includes_exec`
Expected: FAIL — `cannot find function desktop_entry`.

- [ ] **Step 3: Implement `desktop_entry`**

Add near `run_install_cli` in `src-tauri/src/lib.rs`:

```rust
fn desktop_entry(exec: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=amorist\n\
         Comment=Local Markdown editor\n\
         Exec={exec} %f\n\
         Icon=amorist\n\
         Categories=Office;TextEditor;Utility;\n\
         MimeType=text/markdown;\n\
         Terminal=false\n\
         StartupWMClass=amorist\n"
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test desktop_entry_includes_exec`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "EL-171: add tested desktop_entry builder"
```

---

### Task 4: Implement `run_install_desktop` (write entry + icons)

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement the function**

Add after `run_install_cli` in `src-tauri/src/lib.rs`. Icons are embedded so they are available regardless of packaging (AppImage mount vs deb vs dev):

```rust
#[cfg(target_os = "linux")]
const ICON_128: &[u8] = include_bytes!("../icons/128x128.png");
#[cfg(target_os = "linux")]
const ICON_256: &[u8] = include_bytes!("../icons/128x128@2x.png");

#[cfg(target_os = "linux")]
fn data_home() -> Result<PathBuf, String> {
    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        if !xdg.is_empty() {
            return Ok(PathBuf::from(xdg));
        }
    }
    let home = std::env::var("HOME").map_err(|e| format!("HOME unset: {e}"))?;
    Ok(PathBuf::from(home).join(".local").join("share"))
}

#[cfg(target_os = "linux")]
fn exec_path() -> Result<String, String> {
    // Inside an AppImage, $APPIMAGE points at the .AppImage file itself,
    // which is the correct thing to launch. Otherwise use the real binary.
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        if !appimage.is_empty() {
            return Ok(appimage);
        }
    }
    std::env::current_exe()
        .map(|p| p.display().to_string())
        .map_err(|e| format!("current_exe: {e}"))
}

#[cfg(target_os = "linux")]
fn install_icon(data: &std::path::Path, size: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = data
        .join("icons")
        .join("hicolor")
        .join(size)
        .join("apps");
    fs::create_dir_all(&dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    let path = dir.join("amorist.png");
    fs::write(&path, bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(path)
}

#[cfg(target_os = "linux")]
fn run_install_desktop() -> Result<(), String> {
    let data = data_home()?;
    let exec = exec_path()?;

    let apps_dir = data.join("applications");
    fs::create_dir_all(&apps_dir).map_err(|e| format!("create {}: {e}", apps_dir.display()))?;
    let entry_path = apps_dir.join("amorist.desktop");

    if let Ok(meta) = entry_path.symlink_metadata() {
        // Only refuse if it exists and was clearly not written by us.
        let existing = fs::read_to_string(&entry_path).unwrap_or_default();
        if meta.len() > 0 && !existing.contains("StartupWMClass=amorist") {
            return Err(format!(
                "{} exists and was not created by amorist; refusing to overwrite.",
                entry_path.display()
            ));
        }
    }

    fs::write(&entry_path, desktop_entry(&exec))
        .map_err(|e| format!("write {}: {e}", entry_path.display()))?;

    let icon_128 = install_icon(&data, "128x128", ICON_128)?;
    let icon_256 = install_icon(&data, "256x256", ICON_256)?;

    // Best-effort cache refresh; do not fail if the tools are absent.
    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps_dir)
        .status();
    let _ = std::process::Command::new("gtk-update-icon-cache")
        .arg("-f")
        .arg(data.join("icons").join("hicolor"))
        .status();

    println!("Installed desktop entry: {}", entry_path.display());
    println!("Installed icon:          {}", icon_128.display());
    println!("Installed icon:          {}", icon_256.display());
    println!("Exec:                    {exec} %f");
    println!();
    println!("amorist should now appear under 'Open with' for Markdown files.");
    Ok(())
}
```

- [ ] **Step 2: Compile check**

Run: `cd src-tauri && cargo build`
Expected: builds (warnings about an unused `run_install_desktop` are fine until Task 6 wires it).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "EL-171: implement run_install_desktop with embedded icons"
```

---

### Task 5: Implement `run_uninstall_desktop`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement the function**

Add after `run_install_desktop`:

```rust
#[cfg(target_os = "linux")]
fn run_uninstall_desktop() -> Result<(), String> {
    let data = data_home()?;
    let apps_dir = data.join("applications");
    let entry_path = apps_dir.join("amorist.desktop");

    let mut removed = false;
    if entry_path.exists() {
        let existing = fs::read_to_string(&entry_path).unwrap_or_default();
        if existing.contains("StartupWMClass=amorist") {
            fs::remove_file(&entry_path)
                .map_err(|e| format!("remove {}: {e}", entry_path.display()))?;
            removed = true;
        } else {
            return Err(format!(
                "{} was not created by amorist; leaving it untouched.",
                entry_path.display()
            ));
        }
    }

    for size in ["128x128", "256x256"] {
        let icon = data
            .join("icons")
            .join("hicolor")
            .join(size)
            .join("apps")
            .join("amorist.png");
        if icon.exists() {
            let _ = fs::remove_file(&icon);
            removed = true;
        }
    }

    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps_dir)
        .status();
    let _ = std::process::Command::new("gtk-update-icon-cache")
        .arg("-f")
        .arg(data.join("icons").join("hicolor"))
        .status();

    if removed {
        println!("Removed amorist desktop entry and icons.");
    } else {
        println!("Nothing to remove.");
    }
    Ok(())
}
```

- [ ] **Step 2: Compile check**

Run: `cd src-tauri && cargo build`
Expected: builds.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "EL-171: implement run_uninstall_desktop"
```

---

### Task 6: Wire the flags into `setup()`

**Files:**
- Modify: `src-tauri/src/lib.rs` (`check_install_cli` sibling dispatch + `setup`)

- [ ] **Step 1: Add a dispatcher for the desktop flags**

Add near `check_install_cli`:

```rust
fn check_desktop_flags(app: &App) -> Result<bool, String> {
    let matches = app
        .cli()
        .matches()
        .map_err(|e| format!("CLI argument parsing failed: {e}"))?;
    let requested = |name: &str| {
        matches
            .args
            .get(name)
            .map(|a| a.occurrences > 0)
            .unwrap_or(false)
    };

    #[cfg(target_os = "linux")]
    {
        if requested("install-desktop") {
            run_install_desktop()?;
            return Ok(true);
        }
        if requested("uninstall-desktop") {
            run_uninstall_desktop()?;
            return Ok(true);
        }
        Ok(false)
    }
    #[cfg(not(target_os = "linux"))]
    {
        if requested("install-desktop") || requested("uninstall-desktop") {
            return Err("--install-desktop / --uninstall-desktop are Linux-only. On macOS the .app bundle registers file associations automatically.".into());
        }
        Ok(false)
    }
}
```

- [ ] **Step 2: Call it in `setup()`**

In `setup(|app| { ... })`, immediately after the existing `check_install_cli` match block, add:

```rust
            match check_desktop_flags(app) {
                Ok(true) => std::process::exit(0),
                Ok(false) => {}
                Err(e) => {
                    eprintln!("desktop integration failed: {e}");
                    std::process::exit(1);
                }
            }
```

- [ ] **Step 3: Build and test the install flag end-to-end**

Run (real terminal/PTY): `cd src-tauri && cargo run -- --install-desktop`
Expected: prints installed paths; then:
`grep Exec ~/.local/share/applications/amorist.desktop` → `Exec=<binary> %f`
`ls ~/.local/share/icons/hicolor/128x128/apps/amorist.png` → exists.

- [ ] **Step 4: Test uninstall**

Run: `cd src-tauri && cargo run -- --uninstall-desktop`
Expected: "Removed amorist desktop entry and icons."; the `.desktop` and icons are gone.

- [ ] **Step 5: Run the Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: `desktop_entry_includes_exec_with_file_placeholder` passes.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "EL-171: wire --install-desktop / --uninstall-desktop into setup"
```

---

### Task 7: AppImage build script

**Files:**
- Create: `build-appimage.sh`

- [ ] **Step 1: Create the script**

`build-appimage.sh` (mirrors `build-install-deb.sh`, no sudo/dpkg):

```bash
#!/bin/bash
set -e
VERSION=$(tr -d '[:space:]' < VERSION)
echo "Building amorist $VERSION AppImage..."
cd src-tauri && cargo tauri build --bundles appimage --config "{\"version\": \"$VERSION\"}"
APPIMAGE=$(ls -1 target/release/bundle/appimage/amorist_${VERSION}_amd64.AppImage 2>/dev/null | head -1)
echo ""
echo "Built: src-tauri/$APPIMAGE"
echo "Register it in 'Open with' with:"
echo "    \"src-tauri/$APPIMAGE\" --install-desktop"
```

- [ ] **Step 2: Make executable + syntax check**

Run: `chmod +x build-appimage.sh && bash -n build-appimage.sh`
Expected: no output.

- [ ] **Step 3: Build the AppImage**

Run: `./build-appimage.sh`
Expected: an `.AppImage` is produced under `src-tauri/target/release/bundle/appimage/`.
(Requires the Tauri Linux prerequisites listed in CLAUDE.md.)

- [ ] **Step 4: Commit**

```bash
git add build-appimage.sh
git commit -m "EL-171: add AppImage build script"
```

---

### Task 8: Verification + docs + version bump

**Files:**
- Modify: `README.md`, `VERSION`, `CHANGELOG.md`

- [ ] **Step 1: Linux "Open with" end-to-end (AppImage)**

- Run `"<path>/amorist_*_amd64.AppImage" --install-desktop`.
- In a file manager, right-click a `.md` file → "Open with" → amorist appears **with its icon** → opens the file.

- [ ] **Step 2: Linux deb path**

- `./build-install-deb.sh`; confirm `/usr/share/applications/amorist.desktop` has `Exec=amorist %f`; "Open with → amorist" opens the file.

- [ ] **Step 3: macOS verification**

- Build the dmg (existing macOS build flow); install the `.app`.
- Confirm Finder shows amorist under "Open With" for `.md` with the correct icon, and double-click opens the file. (Icon/association come from `bundle.icon` `.icns` + `Info.plist` generated from `fileAssociations` — no `.desktop` involved.)
- If missing, fix `bundle.icon`/`fileAssociations` config (no Rust change needed).

- [ ] **Step 4: Document**

Add a "Linux desktop integration" section to `README.md`: AppImage download + `--install-desktop`, and the deb alternative. Note macOS works out of the box after installing the dmg.

- [ ] **Step 5: Version bump + changelog**

Update `VERSION` (MINOR) and `CHANGELOG.md`. Commit per the semver skill.

```bash
git add README.md VERSION CHANGELOG.md
git commit -m "EL-171: docs + version bump for desktop integration"
```

---

## Self-Review notes

- Spec coverage: `.desktop` `%f` fix (Task 1), CLI args (Task 2), tested entry builder (Task 3), install (Task 4), uninstall (Task 5), wiring (Task 6), AppImage (Task 7), icons (Tasks 4/8), macOS verification (Task 8). All spec items covered.
- Type consistency: `desktop_entry`, `data_home`, `exec_path`, `install_icon`, `run_install_desktop`, `run_uninstall_desktop`, `check_desktop_flags` referenced consistently; all Linux-gated with `#[cfg(target_os = "linux")]` and a non-Linux fallback in the dispatcher.
- No placeholders.
- Risk: the deb build (Task 1 Step 4) and AppImage build are slow (LTO release). They are the only way to verify generated bundle metadata; pure logic is covered by `cargo test` (Task 3).
