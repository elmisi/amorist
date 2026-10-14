use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{App, Emitter, Manager, State};
use tauri_plugin_cli::CliExt;

mod recovery;
mod file_io;
mod document;
mod instances;
mod native_open;
mod settings;
mod image_resources;
mod links;

const MAX_MARKDOWN_BYTES: u64 = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS: &[&str] = &["md", "markdown", "mdown"];

struct AppState {
    file_path: Mutex<Option<PathBuf>>,
    last_modified: Mutex<Option<std::time::SystemTime>>,
    dirty: Mutex<bool>,
    force_close: Mutex<bool>,
    debug: Mutex<bool>,
    debug_log: Mutex<()>,
    recovery_session: Mutex<Option<recovery::Session>>,
    recovery_checked: Mutex<bool>,
    context_id: AtomicU64,
    saved_source: Mutex<String>,
    working_revision: Mutex<u64>,
    save_target: Mutex<Option<PendingSaveTarget>>,
    save_target_serial: AtomicU64,
    native_open: Mutex<native_open::Queue>,
    image_resources: Mutex<image_resources::Store>,
}

struct PendingSaveTarget { token: u64, context_id: u64, target: document::SaveTarget }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveTargetResponse { token: u64, path: String, exists: bool }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveAsResponse { context_id: Option<u64>, path: String, name: String, exists: bool,
    saved: bool, recovery_warning: Option<String> }

async fn run_io<T: Send + 'static>(app: tauri::AppHandle,
    operation: impl FnOnce(&tauri::AppHandle, &AppState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        operation(&app, &state)
    }).await.map_err(|e| e.to_string())?
}

fn require_context(state: &AppState, context_id: u64) -> Result<(), String> {
    if context_id != state.context_id.load(Ordering::SeqCst) {
        return Err("STALE_DOCUMENT: the document context has changed.".into());
    }
    Ok(())
}

// Called only with file_path held, after the read has succeeded.
fn install_read_context(state: &AppState, saved: &str, recovered: bool, path: Option<PathBuf>) -> u64 {
    state.image_resources.lock().unwrap().replace_document(path);
    *state.saved_source.lock().unwrap() = saved.into();
    *state.working_revision.lock().unwrap() = 0;
    let mut dirty = state.dirty.lock().unwrap();
    let context_id = state.context_id.fetch_add(1, Ordering::SeqCst) + 1;
    *dirty = recovered;
    context_id
}

#[tauri::command]
fn debug_enabled(state: State<AppState>) -> bool {
    *state.debug.lock().unwrap()
}

#[tauri::command]
async fn spawn_document_instance(app: tauri::AppHandle, path: Option<String>) -> Result<u32, String> {
    run_io(app, move |_app, state| {
        let file = path.map(|path| document::Prepared::open(std::path::Path::new(&path)).map(|doc| doc.path))
            .transpose()?.flatten();
        #[cfg(not(target_os = "linux"))]
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        let bundle = instances::macos_bundle(&executable);
        #[cfg(not(target_os = "macos"))]
        let bundle = None;
        #[cfg(target_os = "linux")]
        let executable = PathBuf::from(exec_path()?);
        instances::Launch::prepare(executable, bundle, file.as_deref(), *state.debug.lock().unwrap()).spawn()
    }).await
}

#[tauri::command]
async fn take_native_open_requests(app: tauri::AppHandle) -> Result<Vec<native_open::Request>, String> {
    run_io(app, |_app, state| {
        let batch = state.native_open.lock().unwrap().drain();
        Ok(batch.resolve())
    }).await
}

fn append_debug_record(path: &std::path::Path, report: &serde_json::Value, locks: &std::path::Path) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(report).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    file_io::append(locks, path, &bytes)
}

#[tauri::command]
async fn report_problem(app: tauri::AppHandle, report: serde_json::Value) -> Result<String, String> {
    run_io(app, move |app, state| report_problem_inner(app, state, report)).await
}

fn report_problem_inner(app: &tauri::AppHandle, state: &AppState, mut report: serde_json::Value) -> Result<String, String> {
    if !*state.debug.lock().unwrap() { return Err("Problem reporting requires --debug.".into()); }
    if !report.is_object() || report.get("note").and_then(|v| v.as_str()).unwrap_or("").trim().is_empty() {
        return Err("Describe the problem before saving.".into());
    }
    report["filePath"] = serde_json::json!(state.file_path.lock().unwrap().as_ref().map(|p| p.display().to_string()));
    report["appVersion"] = serde_json::json!(env!("CARGO_PKG_VERSION"));
    report["platform"] = serde_json::json!(std::env::consts::OS);
    let directory = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join("problem-reports.jsonl");
    let _guard = state.debug_log.lock().unwrap();
    append_debug_record(&path, &report, &app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("locks"))?;
    Ok(path.display().to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkingCopy {
    path: String,
    saved_source: String,
    unsaved_source: String,
    revision: u64,
    #[serde(default)]
    boundary_state: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentResponse {
    context_id: u64,
    path: String,
    name: String,
    exists: bool,
    markdown: String,
    recovery_markdown: Option<String>,
    recovery_boundary_state: Option<serde_json::Value>,
    recovery_candidates: Vec<recovery::Record>,
    recovery_warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResponse {
    saved: bool,
    path: String,
    recovery_warning: Option<String>,
}

#[tauri::command]
async fn read_document(app: tauri::AppHandle) -> Result<DocumentResponse, String> {
    run_io(app, read_document_inner).await
}

fn read_document_inner(app: &tauri::AppHandle, state: &AppState) -> Result<DocumentResponse, String> {
    let guard = state.file_path.lock().unwrap();
    let Some(path) = guard.as_ref() else {
        let (record, candidates, warnings) = load_session_recovery(&app, &state, None, "")?;
        return Ok(DocumentResponse {
            context_id: install_read_context(state, "", record.is_some(), None),
            path: String::new(), name: "Untitled".into(), exists: false,
            markdown: String::new(),
            recovery_markdown: record.as_ref().map(|r| r.unsaved_source.clone()),
            recovery_boundary_state: record.and_then(|r| r.boundary_state),
            recovery_candidates: candidates, recovery_warnings: warnings,
        });
    };

    if path.exists() {
        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        if metadata.len() > MAX_MARKDOWN_BYTES {
            return Err("File is too large (max 10 MB).".into());
        }

        let raw = fs::read(path).map_err(|e| e.to_string())?;
        let text = String::from_utf8(raw.clone())
            .map_err(|_| "Markdown files must be UTF-8 encoded.".to_string())?;
        let markdown = text.clone();
        let (recovery, candidates, warnings) = load_session_recovery(&app, &state, Some(path), &text)?;

        if let Ok(mtime) = metadata.modified() {
            *state.last_modified.lock().unwrap() = Some(mtime);
        }

        Ok(DocumentResponse {
            context_id: install_read_context(state, &text, recovery.is_some(), Some(path.clone())),
            path: path.display().to_string(),
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            exists: true,
            markdown,
            recovery_markdown: recovery.as_ref().map(|record| record.unsaved_source.clone()),
            recovery_boundary_state: recovery.and_then(|record| record.boundary_state),
            recovery_candidates: candidates,
            recovery_warnings: warnings,
        })
    } else {
        if state.last_modified.lock().unwrap().is_some() {
            return Err("The open file no longer exists. Your editor was preserved.".into());
        }
        let (recovery, candidates, warnings) = load_session_recovery(&app, &state, Some(path), "")?;
        Ok(DocumentResponse {
            context_id: install_read_context(state, "", recovery.is_some(), Some(path.clone())),
            path: path.display().to_string(),
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            exists: false,
            markdown: String::new(),
            recovery_markdown: recovery.as_ref().map(|record| record.unsaved_source.clone()),
            recovery_boundary_state: recovery.and_then(|record| record.boundary_state),
            recovery_candidates: candidates,
            recovery_warnings: warnings,
        })
    }
}

#[tauri::command]
async fn save_document(app: tauri::AppHandle, markdown: String, force: Option<bool>, context_id: u64, revision: u64) -> Result<SaveResponse, String> {
    run_io(app, move |app, state| save_document_inner(app, state, markdown, force.unwrap_or(false), context_id, revision)).await
}

fn save_document_inner(app: &tauri::AppHandle, state: &AppState, markdown: String, force: bool, context_id: u64, revision: u64) -> Result<SaveResponse, String> {
    let (path, expected) = {
        let guard = state.file_path.lock().unwrap();
        require_context(state, context_id)?;
        let path = guard.as_ref().ok_or("No file open.")?.clone();
        let expected = state.last_modified.lock().unwrap().map(file_io::Expected::Modified).unwrap_or(file_io::Expected::Missing);
        (path, expected)
    };
    // Autosave has its own recovery target and must meet its interval even
    // while another instance holds the user's file lock for up to five seconds.
    file_io::write(&app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("locks"),
        &path, &markdown, expected, force)?;
    let _guard = state.file_path.lock().unwrap();
    if require_context(state, context_id).is_err() {
        return Ok(SaveResponse { saved: true, path: path.display().to_string(),
            recovery_warning: Some("The previous document was saved after its view changed; recovery was retained.".into()) });
    }
    if let Ok(meta) = fs::metadata(&path) {
        if let Ok(mtime) = meta.modified() { *state.last_modified.lock().unwrap() = Some(mtime); }
    }
    *state.saved_source.lock().unwrap() = markdown.clone();
    let recovery_warning = reconcile_saved_recovery(app, state, &markdown, revision).err();
    Ok(SaveResponse { saved: true, path: path.display().to_string(), recovery_warning })
}

fn reconcile_saved_recovery(app: &tauri::AppHandle, state: &AppState, saved: &str, revision: u64) -> Result<(), String> {
    let latest = *state.working_revision.lock().unwrap();
    let owner = state.recovery_session.lock().unwrap();
    if let Some(session) = owner.as_ref() {
        if latest > revision {
            if let Some(mut record) = recovery_store(app)?.read(session.id())? {
                if record.unsaved_source != saved {
                    record.saved_source = saved.into();
                    return session.persist(&record);
                }
            }
        }
        session.discard()?;
    }
    Ok(())
}

#[tauri::command]
async fn prepare_save_as(app: tauri::AppHandle, path: String, context_id: u64) -> Result<SaveTargetResponse, String> {
    run_io(app, move |_app, state| {
        require_context(state, context_id)?;
        let target = document::SaveTarget::prepare(std::path::Path::new(&path))?;
        let _guard = state.file_path.lock().unwrap();
        require_context(state, context_id)?;
        let token = state.save_target_serial.fetch_add(1, Ordering::SeqCst) + 1;
        let response = SaveTargetResponse { token, path: target.path.display().to_string(),
            exists: !matches!(target.expected, file_io::Expected::Missing) };
        *state.save_target.lock().unwrap() = Some(PendingSaveTarget { token, context_id, target });
        Ok(response)
    }).await
}

#[tauri::command]
async fn save_as_document(app: tauri::AppHandle, token: u64, context_id: u64, markdown: String, revision: u64) -> Result<SaveAsResponse, String> {
    run_io(app, move |app, state| {
        let pending = {
            let _guard = state.file_path.lock().unwrap();
            require_context(state, context_id)?;
            let mut pending = state.save_target.lock().unwrap();
            if !pending.as_ref().is_some_and(|p| p.token == token && p.context_id == context_id) {
                return Err("The Save As destination is no longer valid. Choose it again.".into());
            }
            pending.take().unwrap()
        };
        let path = &pending.target.path;
        // The user confirms replacement after preparation. No forced bypass of
        // its snapshot: a changed destination requires a new selection/confirmation.
        file_io::write(&app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("locks"),
            path, &markdown, pending.target.expected, false)?;
        let mut current_path = state.file_path.lock().unwrap();
        if require_context(state, context_id).is_err() {
            return Ok(SaveAsResponse { context_id: None, path: path.display().to_string(),
                name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), exists: true, saved: true,
                recovery_warning: Some("The copy was saved, but the current document changed; its identity was preserved.".into()) });
        }
        *current_path = Some(path.clone());
        state.image_resources.lock().unwrap().replace_document(Some(path.clone()));
        *state.last_modified.lock().unwrap() = fs::metadata(path).and_then(|m| m.modified()).ok();
        *state.saved_source.lock().unwrap() = markdown;
        *state.working_revision.lock().unwrap() = revision;
        let recovery_warning = discard_owned_recovery(state).err();
        let mut dirty = state.dirty.lock().unwrap();
        let id = state.context_id.fetch_add(1, Ordering::SeqCst) + 1;
        *dirty = false;
        Ok(SaveAsResponse { context_id: Some(id), path: path.display().to_string(),
            name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), exists: true,
            saved: true, recovery_warning })
    }).await
}

#[tauri::command]
async fn resolve_link(app: tauri::AppHandle, reference: String, context_id: u64) -> Result<links::Destination, String> {
    run_io(app, move |_app, state| {
        let document = {
            let path = state.file_path.lock().unwrap();
            require_context(state, context_id)?;
            path.clone()
        };
        let destination = links::resolve(&reference, document.as_deref())?;
        let _guard = state.file_path.lock().unwrap();
        require_context(state, context_id)?;
        Ok(destination)
    }).await
}

#[tauri::command]
async fn register_image(app: tauri::AppHandle, reference: String, context_id: u64) -> Result<String, String> {
    run_io(app, move |_app,state| {
        let path={
            let _guard=state.file_path.lock().unwrap();require_context(state,context_id)?;
            state.image_resources.lock().unwrap().resolve_reference(&reference)?
        };
        let bytes=fs::read(&path).map_err(|_| "Cannot read the referenced image.".to_string())?;
        let _guard=state.file_path.lock().unwrap();require_context(state,context_id)?;
        state.image_resources.lock().unwrap().register(&path,&bytes)
    }).await
}

#[tauri::command]
async fn load_settings(app: tauri::AppHandle) -> Result<settings::Loaded, String> {
    run_io(app, |app, _state| {
        Ok(settings::load(&app.path().app_local_data_dir().map_err(|e| e.to_string())?))
    }).await
}

#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: settings::Settings) -> Result<settings::Settings, String> {
    run_io(app, move |app, _state| {
        settings::save(&app.path().app_local_data_dir().map_err(|e| e.to_string())?, settings)
    }).await
}

#[tauri::command]
fn get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn set_dirty(state: State<AppState>, dirty: bool, context_id: u64) {
    let mut current = state.dirty.lock().unwrap();
    if require_context(&state, context_id).is_ok() { *current = dirty; }
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

/// Test adapter for the same production writer with an isolated lock directory.
#[cfg(test)]
fn write_document(path: &std::path::Path, markdown: &str,
    expected_mtime: Option<std::time::SystemTime>, force: bool) -> Result<(), String> {
    let locks = tests::scratch_dir("writer-locks");
    let expected = expected_mtime.map(file_io::Expected::Modified).unwrap_or(file_io::Expected::Any);
    let result = file_io::write(&locks, path, markdown, expected, force);
    let _ = fs::remove_dir_all(locks);
    result
}

fn app_data_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "linux")]
    let _ = app;
    #[cfg(target_os = "linux")]
    let base = data_home()?;
    #[cfg(not(target_os = "linux"))]
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = base.join("amorist");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn recovery_store(app: &tauri::AppHandle) -> Result<recovery::Store, String> {
    recovery::Store::new(app_data_home(app)?.join("recovery-sessions"))
}

fn load_session_recovery(
    app: &tauri::AppHandle,
    state: &AppState,
    path: Option<&std::path::Path>,
    saved: &str,
) -> Result<(Option<recovery::Record>, Vec<recovery::Record>, Vec<String>), String> {
    load_recovery_into(app, &state.recovery_session, &state.recovery_checked, path, saved)
}

fn load_recovery_into(app: &tauri::AppHandle, session: &Mutex<Option<recovery::Session>>,
    checked_state: &Mutex<bool>, path: Option<&std::path::Path>, saved: &str,
) -> Result<(Option<recovery::Record>, Vec<recovery::Record>, Vec<String>), String> {
    let store = recovery_store(app)?;
    let mut owner = session.lock().unwrap();
    if owner.is_none() { *owner = Some(store.create()?); }
    let path = path.map(|p| p.display().to_string());
    if let Some(record) = store.read(owner.as_ref().unwrap().id())? {
        if record.path == path && record.saved_source == saved && record.unsaved_source != saved {
            return Ok((Some(record), Vec::new(), Vec::new()));
        }
    }
    let mut checked = checked_state.lock().unwrap();
    if *checked { return Ok((None, Vec::new(), Vec::new())); }
    let mut warnings = Vec::new();
    if let Err(e) = store.import_legacy(&app_data_home(app)?.join("working-copy.json")) {
        warnings.push(format!("Legacy recovery was preserved: {e}"));
    }
    let listing = store.list()?;
    warnings.extend(listing.warnings);
    let mut candidates: Vec<_> = listing.candidates.into_iter()
        .filter(|c| !c.active && c.record.path == path && c.record.saved_source == saved
            && c.record.unsaved_source != saved)
        .map(|c| c.record).collect();
    if candidates.len() == 1 {
        let record = candidates.pop().unwrap();
        *owner = Some(store.claim(&record.session_id)?);
        *checked = true;
        return Ok((Some(record), Vec::new(), warnings));
    }
    *checked = true;
    Ok((None, candidates, warnings))
}

#[derive(Serialize)]
struct RecoveryInspection { copies: Vec<recovery::Record>, warnings: Vec<String> }

#[tauri::command]
async fn inspect_open_document(app: tauri::AppHandle, path: String, context_id: u64) -> Result<RecoveryInspection, String> {
    run_io(app, move |app, state| {
        require_context(state, context_id)?;
        let prepared = document::Prepared::open(std::path::Path::new(&path))?;
        let store = recovery_store(app)?;
        let mut warnings = Vec::new();
        if let Err(e) = store.import_legacy(&app_data_home(app)?.join("working-copy.json")) {
            warnings.push(format!("Legacy recovery was preserved: {e}"));
        }
        let listing = store.list()?;
        warnings.extend(listing.warnings);
        let expected = prepared.path.as_ref().map(|p| p.display().to_string());
        let copies = listing.candidates.into_iter().filter(|c| !c.active && c.record.path == expected
            && c.record.saved_source == prepared.source && c.record.unsaved_source != prepared.source)
            .map(|c| c.record).collect();
        Ok(RecoveryInspection { copies, warnings })
    }).await
}

#[tauri::command]
async fn create_document(app: tauri::AppHandle, context_id: u64, discard: bool) -> Result<DocumentResponse, String> {
    run_io(app, move |app, state| transition_document(app, state, document::Prepared::untitled(), context_id, discard, None)).await
}

#[tauri::command]
async fn open_document(app: tauri::AppHandle, path: String, context_id: u64, discard: bool, recovery_choice: Option<String>) -> Result<DocumentResponse, String> {
    run_io(app, move |app, state| {
        require_context(state, context_id)?;
        let prepared = document::Prepared::open(std::path::Path::new(&path))?;
        transition_document(app, state, prepared, context_id, discard, recovery_choice)
    }).await
}

fn transition_document(app: &tauri::AppHandle, state: &AppState, prepared: document::Prepared,
    context_id: u64, discard: bool, recovery_choice: Option<String>) -> Result<DocumentResponse, String> {
    require_context(state, context_id)?;
    // Stage recovery separately: failed preparation must not touch the old lease.
    let store = recovery_store(app)?;
    let mut staged_owner = store.create()?;
    let mut recovery = None;
    if let Some(id) = recovery_choice {
        let claimed = store.claim(&id)?;
        let record = store.read(&id)?.ok_or("The recovery copy is no longer available.")?;
        let expected_path = prepared.path.as_ref().map(|p| p.display().to_string());
        if record.path != expected_path || record.saved_source != prepared.source {
            return Err("The file or recovery copy changed during selection. Try again.".into());
        }
        staged_owner = claimed;
        recovery = Some(record);
    }
    let mut path = state.file_path.lock().unwrap();
    require_context(state, context_id)?;
    if *state.dirty.lock().unwrap() && !discard {
        return Err("Unsaved changes require Save, Discard or Cancel.".into());
    }
    // Only now, with a valid candidate and unchanged context, remove our old copy.
    discard_owned_recovery(state)?;
    *path = prepared.path.clone();
    *state.last_modified.lock().unwrap() = prepared.modified;
    *state.recovery_session.lock().unwrap() = Some(staged_owner);
    *state.recovery_checked.lock().unwrap() = true;
    let id = install_read_context(state, &prepared.source, recovery.is_some(), prepared.path.clone());
    Ok(DocumentResponse {
        context_id: id,
        path: prepared.path.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
        name: prepared.path.as_ref().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into()),
        exists: prepared.path.is_some(), markdown: prepared.source,
        recovery_markdown: recovery.as_ref().map(|r| r.unsaved_source.clone()),
        recovery_boundary_state: recovery.and_then(|r| r.boundary_state),
        recovery_candidates: Vec::new(), recovery_warnings: Vec::new(),
    })
}

#[tauri::command]
async fn select_recovery(app: tauri::AppHandle, session_id: String, context_id: u64) -> Result<recovery::Record, String> {
    run_io(app, move |app, state| select_recovery_inner(app, state, session_id, context_id)).await
}

fn select_recovery_inner(app: &tauri::AppHandle, state: &AppState, session_id: String, context_id: u64) -> Result<recovery::Record, String> {
    if *state.dirty.lock().unwrap() { return Err("Cannot replace unsaved work with recovery.".into()); }
    let path = state.file_path.lock().unwrap();
    require_context(state, context_id)?;
    let expected_path = path.as_ref().map(|p| p.display().to_string());
    let saved = match path.as_ref() {
        Some(path) if path.exists() => fs::read_to_string(path).map_err(|e| e.to_string())?,
        _ => String::new(),
    };
    let store = recovery_store(&app)?;
    let session = store.claim(&session_id)?;
    let record = store.read(&session_id)?.ok_or("Recovery copy is no longer available.")?;
    if record.path != expected_path || record.saved_source != saved {
        return Err("Recovery belongs to another document or the saved file changed.".into());
    }
    *state.recovery_session.lock().unwrap() = Some(session);
    *state.dirty.lock().unwrap() = true;
    Ok(record)
}

#[cfg(test)]
fn load_recovery_file(
    file: &std::path::Path,
    path: &std::path::Path,
    saved_source: &str,
) -> Option<String> {
    load_recovery_record_file(file, path, saved_source).map(|record| record.unsaved_source)
}

#[cfg(test)]
fn load_recovery_record_file(
    file: &std::path::Path,
    path: &std::path::Path,
    saved_source: &str,
) -> Option<WorkingCopy> {
    let record: WorkingCopy = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    if record.path == path.display().to_string()
        && record.saved_source == saved_source
        && record.unsaved_source != saved_source
    {
        Some(record)
    } else {
        None
    }
}

#[tauri::command]
async fn persist_working_copy(app: tauri::AppHandle, saved_source: String, unsaved_source: String,
    revision: u64, boundary_state: Option<serde_json::Value>, context_id: u64) -> Result<(), String> {
    run_io(app, move |app, state| persist_working_copy_inner(app, state, saved_source, unsaved_source, revision, boundary_state, context_id)).await
}

fn persist_working_copy_inner(app: &tauri::AppHandle, state: &AppState, saved_source: String, unsaved_source: String,
    revision: u64, boundary_state: Option<serde_json::Value>, context_id: u64) -> Result<(), String> {
    if unsaved_source.len() as u64 > MAX_MARKDOWN_BYTES
        || saved_source.len() as u64 > MAX_MARKDOWN_BYTES
    {
        return Err("File is too large (max 10 MB).".into());
    }
    let guard = state.file_path.lock().unwrap();
    require_context(state, context_id)?;
    let mut latest_revision = state.working_revision.lock().unwrap();
    if revision < *latest_revision { return Ok(()); }
    // A save may complete while this callback waits. Its authoritative base
    // belongs to the same context and is paired with the captured unsaved source.
    let saved_source = state.saved_source.lock().unwrap().clone();
    let mut owner = state.recovery_session.lock().unwrap();
    if owner.is_none() { *owner = Some(recovery_store(&app)?.create()?); }
    let session = owner.as_ref().unwrap();
    let record = recovery::Record {
        schema_version: 1,
        session_id: session.id().into(),
        path: guard.as_ref().map(|p| p.display().to_string()),
        saved_source, unsaved_source, revision, boundary_state,
        legacy_import: false,
    };
    if record.unsaved_source == record.saved_source { session.discard()?; }
    else { session.persist(&record)?; }
    *latest_revision = revision;
    Ok(())
}

#[cfg(test)]
fn persist_working_copy_file(file: &std::path::Path, record: &WorkingCopy) -> Result<(), String> {
    let encoded = serde_json::to_string(record).map_err(|e| e.to_string())?;
    // Recovery must survive a crash during the recovery write itself. Reuse
    // the same adjacent-temp-and-rename path as an explicit document save, but
    // target only Amorist's private app-data file.
    write_document(file, &encoded, None, false)
}

#[tauri::command]
async fn discard_working_copy(app: tauri::AppHandle, context_id: u64) -> Result<(), String> {
    run_io(app, move |_app, state| {
        let _guard = state.file_path.lock().unwrap();
        require_context(state, context_id)?;
        discard_owned_recovery(state)
    }).await
}

fn discard_owned_recovery(state: &AppState) -> Result<(), String> {
    if let Some(session) = state.recovery_session.lock().unwrap().as_ref() {
        session.discard()?;
    }
    Ok(())
}

#[cfg(test)]
fn discard_working_copy_file(file: &std::path::Path) -> Result<(), String> {
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(ref e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(val) = u8::from_str_radix(&String::from_utf8_lossy(&bytes[i + 1..i + 3]), 16)
            {
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
    fs::create_dir_all(&bin_dir).map_err(|e| format!("create {}: {e}", bin_dir.display()))?;
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
    let dir = data.join("icons").join("hicolor").join(size).join("apps");
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
        .register_asynchronous_uri_scheme_protocol("amorist-image", |context, request, responder| {
            let app=context.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let content=if request.method()==tauri::http::Method::GET {
                    app.try_state::<AppState>().and_then(|state| image_resources::read_resource(
                        &state.image_resources,request.uri().path().trim_start_matches('/')))
                }else {None};
                let (status,mime,body)=match content {
                    Some((bytes,mime))=>(200,mime,bytes),
                    None=>(404,"text/plain",b"Image resource not found.".to_vec()),
                };
                let response=tauri::http::Response::builder().status(status)
                    .header("Content-Type",mime).header("X-Content-Type-Options","nosniff")
                    .header("Cache-Control","no-store")
                    .header("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'")
                    .body(body).expect("static image response headers");
                responder.respond(response);
            });
        })
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .manage(AppState {
            file_path: Mutex::new(None),
            last_modified: Mutex::new(None),
            dirty: Mutex::new(false),
            force_close: Mutex::new(false),
            debug: Mutex::new(false),
            debug_log: Mutex::new(()),
            recovery_session: Mutex::new(None),
            recovery_checked: Mutex::new(false),
            context_id: AtomicU64::new(0),
            saved_source: Mutex::new(String::new()),
            working_revision: Mutex::new(0),
            save_target: Mutex::new(None),
            save_target_serial: AtomicU64::new(0),
            native_open: Mutex::new(native_open::Queue::default()),
            image_resources: Mutex::new(image_resources::Store::default()),
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
            let matches = app.cli().matches()?;
            *app.state::<AppState>().debug.lock().unwrap() = matches.args.get("debug")
                .map(|arg| arg.value.as_bool().unwrap_or(false)).unwrap_or(false);
            let fresh_document = matches.args.get("new-document").is_some_and(|arg| arg.occurrences > 0);
            if fresh_document { *app.state::<AppState>().recovery_checked.lock().unwrap() = true; }
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
                    if fresh_document { return Err("--new-document cannot be combined with a file.".into()); }
                    let state: State<AppState> = app.state();
                    *state.file_path.lock().unwrap() = Some(path.clone());
                    state.native_open.lock().unwrap().set_startup_file(path.clone());
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
            spawn_document_instance,
            take_native_open_requests,
            create_document,
            open_document,
            inspect_open_document,
            save_document,
            prepare_save_as,
            save_as_document,
            persist_working_copy,
            discard_working_copy,
            select_recovery,
            register_image,
            resolve_link,
            load_settings,
            save_settings,
            get_version,
            debug_enabled,
            report_problem,
            set_dirty,
            force_close,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let requests = urls.into_iter().map(|url| match url.to_file_path() {
                    Ok(path) => match path.into_os_string().into_string() {
                        Ok(path) => native_open::Request { path: Some(path), error: None },
                        Err(_) => native_open::Request { path: None, error: Some("The Finder filename is not valid Unicode.".into()) },
                    },
                    Err(_) => native_open::Request { path: None, error: Some("Finder can only open local Markdown files.".into()) },
                });
                let ready = app.state::<AppState>().native_open.lock().unwrap().enqueue(requests);
                if ready { let _ = app.emit("native-open-available", ()); }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_reports_append_complete_json_records_without_overwriting() {
        let dir = scratch_dir("debug-reports");
        let path = dir.join("reports.jsonl");
        let first = serde_json::json!({"note": "first\nproblem", "markdown": "# Original"});
        let second = serde_json::json!({"note": "second", "markdown": "# Unsaved"});
        append_debug_record(&path, &first, &dir.join("locks")).unwrap();
        let original = fs::read(&path).unwrap();
        append_debug_record(&path, &second, &dir.join("locks")).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(&original));
        let records: Vec<serde_json::Value> = std::str::from_utf8(&bytes).unwrap().lines()
            .map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(records, vec![first, second]);
        fs::remove_dir_all(dir).unwrap();
    }

    // ---------------------------------------------------------------- family F
    //
    // The write path, verified over real temporary files. Both requirements
    // here describe behaviour that is CORRECT TODAY: they exist so that it
    // cannot quietly regress while the save path is rewritten to preserve the
    // source. A regression check earns its keep before the change, not after.

    pub(super) fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "amorist-qa-{}-{}-{:?}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temporary_files_in(dir: &std::path::Path) -> Vec<String> {
        fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("amorist-tmp"))
            .collect()
    }

    #[test]
    fn qa_req_f1_a_successful_save_leaves_no_temporary_file_behind() {
        let dir = scratch_dir("f1-ok");
        let file = dir.join("nota.md");
        fs::write(&file, b"# prima\n").unwrap();

        write_document(&file, "# dopo\n", None, false).unwrap();

        assert_eq!(fs::read(&file).unwrap(), b"# dopo\n");
        assert!(
            temporary_files_in(&dir).is_empty(),
            "a temporary file survived a successful save: {:?}",
            temporary_files_in(&dir)
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn qa_req_f1_a_failed_write_leaves_the_original_intact_and_no_debris() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch_dir("f1-fail");
        let file = dir.join("nota.md");
        let original: &[u8] = b"# non deve cambiare\n\ncontenuto originale\n";
        fs::write(&file, original).unwrap();

        // Make the directory unwritable so the temporary file cannot be created.
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o555)).unwrap();
        let outcome = write_document(&file, "# sovrascritto\n", None, false);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();

        // Running as root would defeat the read-only directory. Say so rather
        // than reporting a pass that measured nothing.
        assert!(
            outcome.is_err(),
            "the write succeeded into a read-only directory; this test measures \
             nothing when run with privileges that ignore permissions"
        );
        assert_eq!(
            fs::read(&file).unwrap(),
            original,
            "a failed save modified the original file"
        );
        assert!(
            temporary_files_in(&dir).is_empty(),
            "a failed save left debris behind: {:?}",
            temporary_files_in(&dir)
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(windows)]
    #[test]
    fn qa_req_f1_a_failed_write_leaves_the_original_intact_and_no_debris() {
        use std::process::Command;

        let dir = scratch_dir("f1-fail");
        let file = dir.join("nota.md");
        let original = b"# non deve cambiare\n\ncontenuto originale\n";
        fs::write(&file, original).unwrap();
        let identity = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command",
                "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"])
            .output().expect("query the current Windows identity");
        assert!(identity.status.success(), "identity lookup failed: {identity:?}");
        let sid = String::from_utf8(identity.stdout).unwrap();
        let sid = sid.trim();
        assert!(sid.starts_with("S-1-"), "unexpected identity: {sid}");
        let denied = Command::new("icacls.exe").arg(&dir)
            .args(["/deny", &format!("*{sid}:(WD)")]).output().unwrap();
        assert!(denied.status.success(), "cannot deny directory writes: {denied:?}");

        let outcome = write_document(&file, "# sovrascritto\n", None, false);
        let restored = Command::new("icacls.exe").arg(&dir)
            .args(["/remove:d", &format!("*{sid}")]).output().unwrap();
        assert!(restored.status.success(), "cannot restore test directory: {restored:?}");
        assert!(outcome.is_err(), "save bypassed the directory write denial");
        assert_eq!(fs::read(&file).unwrap(), original,
            "a failed save modified the original file");
        assert!(temporary_files_in(&dir).is_empty(),
            "a failed save left temporary debris");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn qa_req_f2_a_file_changed_outside_is_not_overwritten() {
        let dir = scratch_dir("f2-conflict");
        let file = dir.join("nota.md");
        fs::write(&file, b"# aperta qui\n").unwrap();
        let opened_at = fs::metadata(&file).unwrap().modified().unwrap();

        // Another program edits the file while it is open here. The sleep is
        // not decoration: on a filesystem with coarse timestamps two writes
        // inside the same tick carry the same modification time, and the
        // conflict would go unnoticed. That limitation is recorded against
        // REQ-F2 in the contract.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(&file, b"# cambiata da un altro programma\n").unwrap();

        let outcome = write_document(&file, "# sovrascritta\n", Some(opened_at), false);

        assert_eq!(outcome, Err("CONFLICT".to_string()));
        assert_eq!(
            fs::read(&file).unwrap(),
            b"# cambiata da un altro programma\n",
            "the other program's work was overwritten"
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn qa_req_f2_a_forced_save_overwrites_only_when_asked() {
        let dir = scratch_dir("f2-force");
        let file = dir.join("nota.md");
        fs::write(&file, b"# aperta qui\n").unwrap();
        let opened_at = fs::metadata(&file).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(&file, b"# cambiata altrove\n").unwrap();

        write_document(&file, "# forzata\n", Some(opened_at), true).unwrap();

        assert_eq!(fs::read(&file).unwrap(), b"# forzata\n");
        assert!(temporary_files_in(&dir).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn qa_req_e1_working_copy_survives_a_restart_with_exact_source() {
        let dir = scratch_dir("e1-restart");
        let document = dir.join("nota.md");
        let copy = dir.join("working-copy.json");
        let saved = "# Titolo\r\n\r\nprima  \r\n";
        let unsaved = "# Titolo\r\n\r\nprima  \r\naggiunta 👨‍👩‍👧\r\n";
        fs::write(&document, saved.as_bytes()).unwrap();
        let record = WorkingCopy {
            path: document.display().to_string(),
            saved_source: saved.to_string(),
            unsaved_source: unsaved.to_string(),
            revision: 7,
            boundary_state: None,
        };

        persist_working_copy_file(&copy, &record).unwrap();
        // Loading from disk through a new call is the storage boundary that a
        // terminated and restarted process crosses.
        assert_eq!(
            load_recovery_file(&copy, &document, saved),
            Some(unsaved.to_string())
        );
        assert_eq!(fs::read(&document).unwrap(), saved.as_bytes());
        assert!(temporary_files_in(&dir).is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn recovery_preserves_boundary_metadata_and_accepts_legacy_records() {
        let dir = scratch_dir("recovery-metadata");
        let document = dir.join("nota.md");
        let copy = dir.join("working-copy.json");
        let metadata = serde_json::json!({
            "schemaVersion": 1,
            "offsetEncoding": "utf16",
            "automaticBreaks": [{"marker": 2, "escapes": []}]
        });
        let record = WorkingCopy {
            path: document.display().to_string(),
            saved_source: "😀".into(),
            unsaved_source: "😀\\\r\n".into(),
            revision: 3,
            boundary_state: Some(metadata.clone()),
        };
        persist_working_copy_file(&copy, &record).unwrap();
        let restored = load_recovery_record_file(&copy, &document, "😀").unwrap();
        assert_eq!(restored.unsaved_source, record.unsaved_source);
        assert_eq!(restored.boundary_state, Some(metadata));
        assert!(load_recovery_record_file(&copy, &document, "changed base").is_none());
        assert!(load_recovery_record_file(&copy, &dir.join("other.md"), "😀").is_none());

        let mut legacy = serde_json::to_value(&record).unwrap();
        legacy.as_object_mut().unwrap().remove("boundaryState");
        fs::write(&copy, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let restored = load_recovery_record_file(&copy, &document, "😀").unwrap();
        assert_eq!(restored.unsaved_source, record.unsaved_source);
        assert_eq!(restored.boundary_state, None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn qa_req_e1_discard_recovery_removes_the_copy_and_is_idempotent() {
        let dir = scratch_dir("recovery-discard");
        let copy = dir.join("working-copy.json");
        fs::write(&copy, br#"{\"unsavedSource\":\"da scartare\"}"#).unwrap();

        discard_working_copy_file(&copy).unwrap();
        assert!(!copy.exists(), "discard left the recovery copy in place");
        discard_working_copy_file(&copy).unwrap();

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn qa_req_e2_persisting_recovery_never_writes_the_user_document() {
        let dir = scratch_dir("e2-no-user-write");
        let document = dir.join("nota.md");
        let copy = dir.join("working-copy.json");
        let saved = "# Originale\n";
        fs::write(&document, saved.as_bytes()).unwrap();
        let before = fs::metadata(&document).unwrap().modified().unwrap();
        let record = WorkingCopy {
            path: document.display().to_string(),
            saved_source: saved.to_string(),
            unsaved_source: "# Modifica non salvata\n".to_string(),
            revision: 1,
            boundary_state: None,
        };

        persist_working_copy_file(&copy, &record).unwrap();

        assert_eq!(fs::read(&document).unwrap(), saved.as_bytes());
        assert_eq!(fs::metadata(&document).unwrap().modified().unwrap(), before);
        assert!(copy.exists(), "the separate recovery file was not written");
        fs::remove_dir_all(&dir).ok();
    }

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
