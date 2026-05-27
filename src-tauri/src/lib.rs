use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{App, Emitter, Manager, State};
use tauri_plugin_cli::CliExt;

const MAX_MARKDOWN_BYTES: u64 = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["md", "markdown", "mdown"];

struct AppState {
    file_path: Mutex<Option<PathBuf>>,
    last_modified: Mutex<Option<std::time::SystemTime>>,
    dirty: Mutex<bool>,
    force_close: Mutex<bool>,
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
    let guard = state.file_path.lock().unwrap();
    let path = guard.as_ref().ok_or("No file open.")?;

    if path.exists() {
        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        if metadata.len() > MAX_MARKDOWN_BYTES {
            return Err("File is too large (max 10 MB).".into());
        }

        let raw = fs::read(path).map_err(|e| e.to_string())?;
        let text = String::from_utf8(raw.clone())
            .map_err(|_| "Markdown files must be UTF-8 encoded.".to_string())?;
        let line_ending = detect_line_ending(&raw);
        let markdown = normalize_line_endings(&text);

        if let Ok(mtime) = metadata.modified() {
            *state.last_modified.lock().unwrap() = Some(mtime);
        }

        Ok(DocumentResponse {
            path: path.display().to_string(),
            name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            exists: true,
            line_ending,
            markdown,
        })
    } else {
        Ok(DocumentResponse {
            path: path.display().to_string(),
            name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            exists: false,
            line_ending: "lf".into(),
            markdown: String::new(),
        })
    }
}

#[tauri::command]
fn save_document(
    state: State<AppState>,
    markdown: String,
    line_ending: String,
    force: Option<bool>,
) -> Result<SaveResponse, String> {
    let guard = state.file_path.lock().unwrap();
    let path = guard.as_ref().ok_or("No file open.")?;

    if markdown.len() as u64 > MAX_MARKDOWN_BYTES {
        return Err("File is too large (max 10 MB).".into());
    }

    if !force.unwrap_or(false) {
        let saved_mtime = state.last_modified.lock().unwrap();
        if let Some(expected) = *saved_mtime {
            if let Ok(meta) = fs::metadata(path) {
                if let Ok(current) = meta.modified() {
                    if current != expected {
                        return Err("CONFLICT".into());
                    }
                }
            }
        }
    }

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp_path = path.with_file_name(format!(".{}.amorist-tmp", name));

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let contents = encode_line_endings(&markdown, &line_ending);
    if let Err(e) = fs::write(&tmp_path, contents.as_bytes()) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.to_string());
    }

    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e.to_string());
    }

    // Update last_modified after successful save
    if let Ok(meta) = fs::metadata(path) {
        if let Ok(mtime) = meta.modified() {
            *state.last_modified.lock().unwrap() = Some(mtime);
        }
    }

    Ok(SaveResponse {
        saved: true,
        path: path.display().to_string(),
    })
}

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn set_dirty(state: State<AppState>, dirty: bool) {
    *state.dirty.lock().unwrap() = dirty;
}

#[tauri::command]
fn force_close(app_handle: tauri::AppHandle) {
    // macOS: app_handle.exit(0) called from an IPC handler thread does not
    // terminate the Cocoa runloop. Route through the WindowEvent handler so
    // the exit happens on the event-loop thread instead.
    #[cfg(target_os = "macos")]
    {
        if let Some(state) = app_handle.try_state::<AppState>() {
            *state.force_close.lock().unwrap() = true;
        }
        if let Some(window) = app_handle.get_webview_window("main") {
            let _ = window.close();
        }
    }
    #[cfg(not(target_os = "macos"))]
    app_handle.exit(0);
}

fn detect_line_ending(raw: &[u8]) -> String {
    if raw.windows(2).any(|w| w == b"\r\n") {
        "crlf".into()
    } else {
        "lf".into()
    }
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn encode_line_endings(markdown: &str, line_ending: &str) -> String {
    let normalized = normalize_line_endings(markdown);
    if line_ending == "crlf" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(
                &String::from_utf8_lossy(&bytes[i + 1..i + 3]),
                16,
            ) {
                out.push(val);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn url_to_path(uri: &str) -> Result<String, String> {
    let stripped = uri.strip_prefix("file://").unwrap_or(uri);
    Ok(percent_decode(stripped))
}

#[allow(dead_code)]
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

#[cfg(unix)]
fn run_install_cli() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let home = std::env::var("HOME").map_err(|e| format!("HOME unset: {e}"))?;
    let bin_dir = PathBuf::from(&home).join(".local").join("bin");
    fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("create {}: {e}", bin_dir.display()))?;
    let link = bin_dir.join("amorist");

    if let Ok(meta) = link.symlink_metadata() {
        if !meta.file_type().is_symlink() {
            return Err(format!(
                "{} exists and is not a symlink; refusing to overwrite. Remove it manually and retry.",
                link.display()
            ));
        }
        fs::remove_file(&link).map_err(|e| format!("remove existing link: {e}"))?;
    }

    std::os::unix::fs::symlink(&exe, &link)
        .map_err(|e| format!("symlink {} -> {}: {e}", link.display(), exe.display()))?;

    println!("Installed: {}", link.display());
    println!("Target:    {}", exe.display());

    let path_env = std::env::var("PATH").unwrap_or_default();
    let in_path = path_env
        .split(':')
        .any(|p| std::path::Path::new(p) == bin_dir.as_path());
    if !in_path {
        println!();
        println!("Note: {} is not on your PATH.", bin_dir.display());
        println!("Add this line to your shell rc (e.g. ~/.zshrc or ~/.bashrc):");
        println!("    export PATH=\"$HOME/.local/bin:$PATH\"");
        println!("Then restart the shell or `source` the rc file.");
    }
    Ok(())
}

#[cfg(target_os = "linux")]
const ICON_128: &[u8] = include_bytes!("../icons/128x128.png");
// 128x128@2x.png is the 256×256 px HiDPI variant; no separate 256x256.png
// asset exists, so it is the correct source for the 256x256 hicolor slot.
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
    // current_exe() resolves /proc/self/exe to the real binary (following any
    // symlink such as one created by --install-cli); for deb/AppImage installs
    // this is a stable path, which is what we want in the .desktop Exec line.
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

    // No ownership marker is feasible for PNG files, so icons are always
    // overwritten. The hicolor app-icon directory is a shared namespace, but a
    // name collision on "amorist.png" with another package is not realistic.
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
            if let Err(e) = fs::remove_file(&icon) {
                eprintln!("Warning: could not remove {}: {e}", icon.display());
            } else {
                removed = true;
            }
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

fn check_install_cli(app: &App) -> Result<bool, String> {
    let matches = app
        .cli()
        .matches()
        .map_err(|e| format!("CLI argument parsing failed: {e}"))?;
    let requested = matches
        .args
        .get("install-cli")
        .map(|a| a.occurrences > 0)
        .unwrap_or(false);
    if !requested {
        return Ok(false);
    }
    #[cfg(unix)]
    {
        run_install_cli()?;
        Ok(true)
    }
    #[cfg(not(unix))]
    {
        Err("--install-cli is only supported on Unix systems.".into())
    }
}

fn resolve_file_arg(app: &App) -> Result<Option<PathBuf>, String> {
    let matches = app
        .cli()
        .matches()
        .map_err(|e| format!("CLI argument parsing failed: {e}"))?;
    let Some(file_arg) = matches.args.get("file") else {
        return Ok(None);
    };
    let Some(raw) = file_arg.value.as_str() else {
        return Ok(None);
    };

    let path_str: String = if raw.starts_with("file://") {
        url_to_path(raw)?
    } else {
        raw.to_string()
    };

    let path = fs::canonicalize(&path_str)
        .unwrap_or_else(|_| std::env::current_dir().unwrap().join(&path_str));

    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err("amorist only opens .md, .markdown, and .mdown files.".into());
    }

    Ok(Some(path))
}

pub fn run() {
    // WebKitGTK tries to create a GL context for accelerated compositing and
    // prints a noisy "Disabled hardware acceleration ... Unable to create a GL
    // context" warning when that fails (headless/VM/remote-X machines without
    // usable GL). amorist is a lightweight text UI, so accelerated compositing
    // brings no perceptible benefit; disable it on Linux to keep startup clean.
    // Guarded so an explicit user-set value still wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            file_path: Mutex::new(None),
            last_modified: Mutex::new(None),
            dirty: Mutex::new(false),
            force_close: Mutex::new(false),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state: State<AppState> = window.state();
                let force = *state.force_close.lock().unwrap();
                if !force && *state.dirty.lock().unwrap() {
                    api.prevent_close();
                    let _ = window.emit("confirm-close", ());
                    return;
                }
                // macOS: Cocoa keeps the process alive after the last window
                // closes by default, leaving a zombie with no UI. Exit
                // explicitly to match Linux/GTK behavior. On other platforms
                // we let the runloop close the window naturally — that's the
                // behavior that has been validated on Linux.
                #[cfg(target_os = "macos")]
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            match check_install_cli(app) {
                Ok(true) => std::process::exit(0),
                Ok(false) => {}
                Err(e) => {
                    eprintln!("install-cli failed: {e}");
                    std::process::exit(1);
                }
            }
            match check_desktop_flags(app) {
                Ok(true) => std::process::exit(0),
                Ok(false) => {}
                Err(e) => {
                    eprintln!("desktop integration failed: {e}");
                    std::process::exit(1);
                }
            }
            match resolve_file_arg(app) {
                Ok(Some(path)) => {
                    let state: State<AppState> = app.state();
                    *state.file_path.lock().unwrap() = Some(path.clone());
                    if let Some(window) = app.get_webview_window("main") {
                        let name = path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default();
                        let _ = window.set_title(&format!("amorist — {}", name));
                        // macOS doesn't steal focus by default when an app
                        // launches; for a CLI-invoked editor we always want
                        // the window in front of the terminal.
                        let _ = window.set_focus();
                    }
                }
                Ok(None) => {
                    eprintln!("Usage: amorist <file.md>");
                    eprintln!("       amorist --install-cli   (install shell command into ~/.local/bin)");
                    #[cfg(target_os = "linux")]
                    eprintln!("       amorist --install-desktop   (register in 'Open with' for .md files)");
                    std::process::exit(1);
                }
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
            set_dirty,
            force_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

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
