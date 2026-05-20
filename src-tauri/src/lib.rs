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
