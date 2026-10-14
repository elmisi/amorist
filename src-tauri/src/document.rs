use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// A candidate has no effect on the current editor or its recovery record.
pub struct Prepared {
    pub path: Option<PathBuf>,
    pub source: String,
    pub modified: Option<SystemTime>,
}

impl Prepared {
    pub fn untitled() -> Self {
        Self {
            path: None,
            source: String::new(),
            modified: None,
        }
    }

    pub fn open(path: &Path) -> Result<Self, String> {
        let path = super::file_io::resolve(path)?.path;
        let extension = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !super::ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
            return Err("amorist only opens .md, .markdown, and .mdown files.".into());
        }
        let before = fs::metadata(&path).map_err(|e| e.to_string())?;
        if !before.is_file() {
            return Err("Choose a Markdown file, not a directory.".into());
        }
        if before.len() > super::MAX_MARKDOWN_BYTES {
            return Err("File is too large (max 10 MB).".into());
        }
        let modified = before.modified().map_err(|e| e.to_string())?;
        let source =
            fs::read_to_string(&path).map_err(|e| format!("Could not read UTF-8 Markdown: {e}"))?;
        let after = fs::metadata(&path).map_err(|e| e.to_string())?;
        if after.modified().map_err(|e| e.to_string())? != modified || after.len() != before.len() {
            return Err("The selected file changed while it was being opened. Try again.".into());
        }
        Ok(Self {
            path: Some(path),
            source,
            modified: Some(modified),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qa_req_e1_open_candidates_preserve_exact_source_and_never_create_missing_files() {
        let root = super::super::tests::scratch_dir("open-candidate");
        let path = root.join("caffè note.MD");
        let source = "# Heading\r\n\r\ntrailing spaces  \r\n😀\r";
        fs::write(&path, source).unwrap();
        let prepared = Prepared::open(&path).unwrap();
        assert_eq!(prepared.source, source);
        assert_eq!(prepared.path, Some(fs::canonicalize(&path).unwrap()));
        assert!(prepared.modified.is_some());
        let missing = root.join("missing.md");
        assert!(Prepared::open(&missing).is_err());
        assert!(!missing.exists());
        fs::write(&path, b"\xff\xfe").unwrap();
        assert!(Prepared::open(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"\xff\xfe");
        let untitled = Prepared::untitled();
        assert!(untitled.path.is_none());
        assert!(untitled.source.is_empty());
        assert!(untitled.modified.is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
