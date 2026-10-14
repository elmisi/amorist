use std::collections::HashSet;
use std::path::PathBuf;
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Queue {
    ready: bool,
    startup_file: Option<PathBuf>,
    pending: Vec<Request>,
}

pub struct Batch { startup: bool, startup_file: Option<PathBuf>, pending: Vec<Request> }

impl Queue {
    pub fn set_startup_file(&mut self, path: PathBuf) { self.startup_file = Some(path); }

    /// OS events may precede the webview listener. Retain them until it drains.
    #[cfg(any(target_os = "macos", test))]
    pub fn enqueue(&mut self, requests: impl IntoIterator<Item = Request>) -> bool {
        self.pending.extend(requests);
        self.ready
    }

    /// Called off the native event-loop thread. Deduplication is confined to
    /// startup; opening the same file again later must launch another instance.
    pub fn drain(&mut self) -> Batch {
        let startup = !self.ready;
        self.ready = true;
        Batch { startup, startup_file: self.startup_file.clone(), pending: std::mem::take(&mut self.pending) }
    }
}

impl Batch {
    pub fn resolve(self) -> Vec<Request> {
        let mut seen = HashSet::new();
        if self.startup {
            if let Some(path) = &self.startup_file {
                if let Ok(identity) = super::file_io::resolve(path) { seen.insert(identity.identity); }
            }
        }
        self.pending.into_iter().filter_map(|request| {
            let Some(path) = request.path.as_ref() else { return Some(request); };
            let prepared = match super::document::Prepared::open(std::path::Path::new(path)) {
                Ok(prepared) => prepared,
                Err(error) => return Some(Request { path: None, error: Some(format!("Could not open {path}: {error}")) }),
            };
            let path = prepared.path.unwrap();
            let identity = match super::file_io::resolve(&path) {
                Ok(identity) => identity,
                Err(error) => return Some(Request { path: None, error: Some(error) }),
            };
            if self.startup && !seen.insert(identity.identity) { return None; }
            Some(Request { path: Some(path.to_string_lossy().into_owned()), error: None })
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(path: &std::path::Path) -> Request { Request { path: Some(path.display().to_string()), error: None } }

    #[test]
    fn startup_keeps_order_deduplicates_cli_and_preserves_later_opens() {
        let dir = crate::tests::scratch_dir("native-open");
        let a = dir.join("a caffè.md"); let b = dir.join("b.md");
        std::fs::write(&a, "first").unwrap(); std::fs::write(&b, "second").unwrap();
        let mut queue = Queue::default(); queue.set_startup_file(a.clone());
        assert!(!queue.enqueue([request(&a), request(&b), request(&dir.join("./b.md"))]));
        let initial = queue.drain().resolve();
        assert_eq!(initial.len(), 1); assert_eq!(initial[0].path, Some(std::fs::canonicalize(&b).unwrap().display().to_string()));
        assert!(queue.enqueue([request(&a), request(&a)]));
        assert_eq!(queue.drain().resolve().len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn events_before_listener_survive_and_missing_files_are_errors_without_creation() {
        let dir = crate::tests::scratch_dir("native-open-errors");
        let missing = dir.join("missing.md"); let valid = dir.join("valid.md");
        std::fs::write(&valid, "valid").unwrap();
        let mut queue = Queue::default();
        queue.enqueue([request(&missing), request(&valid), Request { path: None, error: Some("Unsupported URL".into()) }]);
        let requests = queue.drain().resolve(); assert_eq!(requests.len(), 3);
        assert!(requests[0].error.is_some()); assert!(requests[0].path.is_none());
        assert_eq!(requests[1].path, Some(std::fs::canonicalize(&valid).unwrap().display().to_string()));
        assert_eq!(requests[2].error.as_deref(), Some("Unsupported URL"));
        assert!(!missing.exists()); assert!(queue.drain().resolve().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
