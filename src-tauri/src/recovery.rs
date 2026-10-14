//! Private recovery records. A lease prevents two live editors from owning one
//! record; independent sessions never share a writer or a discard target.
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

static SERIAL: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub schema_version: u32,
    pub session_id: String,
    pub path: Option<String>,
    pub saved_source: String,
    pub unsaved_source: String,
    pub revision: u64,
    pub boundary_state: Option<serde_json::Value>,
    #[serde(default)]
    pub legacy_import: bool,
}

pub struct Store {
    root: PathBuf,
}

pub struct Session {
    id: String,
    directory: PathBuf,
    _lease: File,
    writes: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub record: Record,
    pub active: bool,
}

#[derive(Default, Serialize)]
pub struct Listing {
    pub candidates: Vec<Candidate>,
    pub warnings: Vec<String>,
}

impl Store {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(Self { root })
    }

    pub fn create(&self) -> Result<Session, String> {
        loop {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| e.to_string())?
                .as_nanos();
            let id = format!(
                "s-{stamp:x}-{:x}-{:x}",
                std::process::id(),
                SERIAL.fetch_add(1, Ordering::Relaxed)
            );
            match fs::create_dir(self.root.join(&id)) {
                Ok(()) => return self.claim(&id),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
    }

    pub fn claim(&self, id: &str) -> Result<Session, String> {
        let directory = self.directory(id)?;
        if !directory.is_dir() {
            return Err("Recovery session does not exist.".into());
        }
        let lease = lock_file(&directory.join("session.lock"))?;
        lease
            .try_lock()
            .map_err(|_| "Recovery session is already open in another editor.".to_string())?;
        Ok(Session {
            id: id.into(),
            directory,
            _lease: lease,
            writes: Mutex::new(()),
        })
    }

    fn directory(&self, id: &str) -> Result<PathBuf, String> {
        if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') {
            return Err("Invalid recovery session identifier.".into());
        }
        Ok(self.root.join(id))
    }

    pub fn read(&self, id: &str) -> Result<Option<Record>, String> {
        let file = self.directory(id)?.join("record.json");
        let bytes = match fs::read(file) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        let record: Record = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if record.schema_version != 1 || record.session_id != id {
            return Err("Invalid recovery record identity or schema.".into());
        }
        Ok(Some(record))
    }

    pub fn list(&self) -> Result<Listing, String> {
        let mut listing = Listing::default();
        for entry in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            match self.read(&id) {
                Ok(Some(record)) => {
                    let active = match self.claim(&id) {
                        Ok(_) => false,
                        Err(_) => true,
                    };
                    listing.candidates.push(Candidate { record, active });
                }
                Ok(None) => {}
                Err(e) => listing.warnings.push(format!(
                    "Recovery {id} was preserved but could not be read: {e}"
                )),
            }
        }
        listing
            .candidates
            .sort_by(|a, b| a.record.session_id.cmp(&b.record.session_id));
        Ok(listing)
    }

    /// Import is serialized across processes. The fixed import identity makes
    /// retry after a crash idempotent. An exact receipt suppresses repeat imports
    /// after discard. The old file stays intact, including concurrent old writes.
    pub fn import_legacy(&self, file: &Path) -> Result<(), String> {
        let guard = lock_file(&self.root.join("legacy-import.lock"))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            match guard.try_lock() {
                Ok(()) => break,
                Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Err(e) => return Err(format!("Could not lock legacy recovery import: {e}")),
            }
        }
        let bytes = match fs::read(file) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.to_string()),
        };
        let receipt = self.root.join("legacy-imported-source.json");
        match fs::read(&receipt) {
            Ok(imported) if imported == bytes => return Ok(()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        let legacy: super::WorkingCopy =
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let mut record = Record {
            schema_version: 1,
            session_id: "legacy".into(),
            path: Some(legacy.path),
            saved_source: legacy.saved_source,
            unsaved_source: legacy.unsaved_source,
            revision: legacy.revision,
            boundary_state: legacy.boundary_state,
            legacy_import: true,
        };
        let directory = self.directory("legacy")?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut session = None;
        for candidate in self.list()?.candidates {
            if candidate.active || !candidate.record.legacy_import {
                continue;
            }
            let mut expected = record.clone();
            expected.session_id = candidate.record.session_id.clone();
            if expected != candidate.record {
                continue;
            }
            if let Ok(claimed) = self.claim(&expected.session_id) {
                if self.read(claimed.id())?.as_ref() == Some(&expected) {
                    session = Some(claimed);
                    break;
                }
            }
        }
        let session = match session {
            Some(session) => session,
            None if self.read("legacy")?.is_none() => match self.claim("legacy") {
                Ok(session) => session,
                Err(_) => self.create()?,
            },
            None => self.create()?,
        };
        record.session_id = session.id().into();
        if self.read(session.id())?.is_none() {
            session.persist(&record)?;
        }
        write_atomic(&self.root, "legacy-imported-source.json", &bytes)
    }
}

impl Session {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn persist(&self, record: &Record) -> Result<(), String> {
        if record.session_id != self.id || record.schema_version != 1 {
            return Err("Recovery write belongs to another session.".into());
        }
        let _guard = self.writes.lock().map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec(record).map_err(|e| e.to_string())?;
        write_atomic(&self.directory, "record.json", &bytes)
    }

    pub fn discard(&self) -> Result<(), String> {
        let _guard = self.writes.lock().map_err(|e| e.to_string())?;
        match fs::remove_file(self.directory.join("record.json")) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

fn lock_file(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())
}

fn write_atomic(directory: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let (temporary, mut file) = loop {
        let temporary = directory.join(format!(
            "write-{stamp:x}-{:x}-{:x}.tmp",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
        {
            Ok(file) => break (temporary, file),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    };
    let result = (|| {
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, directory.join(name)).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(session: &Session, path: Option<&str>, text: &str) -> Record {
        Record {
            schema_version: 1,
            session_id: session.id().into(),
            path: path.map(str::to_owned),
            saved_source: String::new(),
            unsaved_source: text.into(),
            revision: 1,
            boundary_state: None,
            legacy_import: false,
        }
    }

    #[test]
    fn simultaneous_sessions_and_untitled_recovery_remain_independent() {
        let root = super::super::tests::scratch_dir("recovery-sessions");
        let store = Store::new(root.clone()).unwrap();
        let first = store.create().unwrap();
        let second = store.create().unwrap();
        let untitled = store.create().unwrap();
        first
            .persist(&record(&first, Some("same.md"), "first"))
            .unwrap();
        second
            .persist(&record(&second, Some("same.md"), "second"))
            .unwrap();
        untitled
            .persist(&record(&untitled, None, "untitled 😀\r\n"))
            .unwrap();
        assert!(store.claim(first.id()).is_err());
        assert!(second
            .persist(&record(&first, Some("same.md"), "wrong owner"))
            .is_err());
        assert_eq!(store.list().unwrap().candidates.len(), 3);
        assert!(store.list().unwrap().candidates.iter().all(|c| c.active));
        first.discard().unwrap();
        assert_eq!(
            store.read(second.id()).unwrap().unwrap().unsaved_source,
            "second"
        );
        assert_eq!(
            store.read(untitled.id()).unwrap().unwrap().unsaved_source,
            "untitled 😀\r\n"
        );
        let second_id = second.id().to_string();
        drop(second);
        let resumed = store.claim(&second_id).unwrap();
        resumed
            .persist(&record(&resumed, Some("same.md"), "updated"))
            .unwrap();
        assert_eq!(
            store.read(&second_id).unwrap().unwrap().unsaved_source,
            "updated"
        );
        drop((first, untitled, resumed));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn updated_legacy_source_is_imported_without_overwriting_an_open_copy() {
        let root = super::super::tests::scratch_dir("recovery-legacy-update");
        let store = Store::new(root.join("sessions")).unwrap();
        let file = root.join("working-copy.json");
        fs::write(
            &file,
            br#"{"path":"old.md","savedSource":"saved","unsavedSource":"first","revision":1}"#,
        )
        .unwrap();
        store.import_legacy(&file).unwrap();
        let owner = store.claim("legacy").unwrap();
        let second =
            br#"{"path":"old.md","savedSource":"saved","unsavedSource":"second","revision":2}"#;
        fs::write(&file, second).unwrap();
        store.import_legacy(&file).unwrap();
        assert_eq!(fs::read(&file).unwrap(), second);
        assert_eq!(
            store.read(owner.id()).unwrap().unwrap().unsaved_source,
            "first"
        );
        let listing = store.list().unwrap();
        assert_eq!(listing.candidates.len(), 2);
        assert!(listing
            .candidates
            .iter()
            .any(|c| c.record.unsaved_source == "second" && !c.active));
        store.import_legacy(&file).unwrap();
        assert_eq!(store.list().unwrap().candidates.len(), 2);
        drop(owner);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_import_is_retryable_and_corruption_never_deletes_source() {
        let root = super::super::tests::scratch_dir("recovery-import");
        let store = Store::new(root.join("sessions")).unwrap();
        let file = root.join("working-copy.json");
        let bytes =
            br#"{"path":"old.md","savedSource":"saved","unsavedSource":"unsaved","revision":2}"#;
        fs::write(&file, bytes).unwrap();
        store.import_legacy(&file).unwrap();
        assert_eq!(fs::read(&file).unwrap(), bytes);
        assert_eq!(
            store.read("legacy").unwrap().unwrap().unsaved_source,
            "unsaved"
        );
        fs::write(&file, bytes).unwrap();
        store.import_legacy(&file).unwrap();
        assert_eq!(fs::read(&file).unwrap(), bytes);
        let imported = store.claim("legacy").unwrap();
        imported.discard().unwrap();
        drop(imported);
        store.import_legacy(&file).unwrap();
        assert!(store.read("legacy").unwrap().is_none());
        fs::write(&file, b"not valid JSON").unwrap();
        assert!(store.import_legacy(&file).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"not valid JSON");
        assert_eq!(store.list().unwrap().candidates.len(), 0);
        assert!(store.claim("../outside").is_err());
        fs::write(root.join("sessions/legacy/record.json"), b"broken").unwrap();
        let listing = store.list().unwrap();
        assert_eq!(listing.warnings.len(), 1);
        assert!(root.join("sessions/legacy/record.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
