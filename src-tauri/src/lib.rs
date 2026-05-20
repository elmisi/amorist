use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{App, Manager, State};
use tauri_plugin_cli::CliExt;

const MAX_MARKDOWN_BYTES: u64 = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["md", "markdown", "mdown"];

struct AppState {
    file_path: Mutex<Option<PathBuf>>,
    last_modified: Mutex<Option<std::time::SystemTime>>,
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
) -> Result<SaveResponse, String> {
    let guard = state.file_path.lock().unwrap();
    let path = guard.as_ref().ok_or("No file open.")?;

    if markdown.len() as u64 > MAX_MARKDOWN_BYTES {
        return Err("File is too large (max 10 MB).".into());
    }

    // Check for external modification
    {
        let saved_mtime = state.last_modified.lock().unwrap();
        if let Some(expected) = *saved_mtime {
            if let Ok(meta) = fs::metadata(path) {
                if let Ok(current) = meta.modified() {
                    if current != expected {
                        return Err("The file was modified outside amorist. Reload to see the latest version, or save again to overwrite.".into());
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
        .manage(AppState {
            file_path: Mutex::new(None),
            last_modified: Mutex::new(None),
        })
        .setup(|app| {
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
                    }
                }
                Ok(None) => {
                    eprintln!("Usage: amorist <file.md>");
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
