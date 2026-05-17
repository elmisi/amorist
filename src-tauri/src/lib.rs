use std::fs;
use std::path::Path;

const MAX_MARKDOWN_BYTES: u64 = 10 * 1024 * 1024;

#[derive(serde::Serialize)]
struct MarkdownFileInfo {
    size: u64,
}

#[tauri::command]
fn stat_markdown_file(path: String) -> Result<MarkdownFileInfo, String> {
    validate_markdown_path(&path)?;
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    Ok(MarkdownFileInfo {
        size: metadata.len(),
    })
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<String, String> {
    validate_markdown_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err("file is larger than 10 MB".into());
    }

    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_markdown_file(path: String, contents: String) -> Result<(), String> {
    validate_markdown_path(&path)?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn validate_markdown_path(path: &str) -> Result<(), String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());

    match extension.as_deref() {
        Some("md" | "markdown" | "mdown") => Ok(()),
        _ => Err("unsupported markdown extension".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_cli::init())
        .invoke_handler(tauri::generate_handler![
            stat_markdown_file,
            read_markdown_file,
            write_markdown_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
