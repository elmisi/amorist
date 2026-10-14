//! Classify destinations before any external application is invoked.
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub enum Destination {
    Anchor(String),
    Url(String),
    Markdown {
        path: PathBuf,
        anchor: Option<String>,
    },
    File(PathBuf),
}

pub fn resolve(reference: &str, document: Option<&Path>) -> Result<Destination, String> {
    if reference.is_empty() || reference.chars().any(char::is_control) {
        return Err("A valid link destination is required.".into());
    }
    if let Some(anchor) = reference.strip_prefix('#') {
        return Ok(Destination::Anchor(super::image_resources::decode_path(
            anchor,
        )?));
    }
    if let Ok(url) = tauri::Url::parse(reference) {
        if matches!(url.scheme(), "http" | "https" | "mailto") {
            return Ok(Destination::Url(url.to_string()));
        }
    }
    let mut store = super::image_resources::Store::default();
    store.replace_document(document.map(Path::to_owned));
    let path = store.resolve_reference(reference)?;
    let path = path
        .canonicalize()
        .map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if !path.is_file() {
        return Err(format!(
            "The link does not refer to a file: {}",
            path.display()
        ));
    }
    let anchor = reference
        .split_once('#')
        .map(|(_, fragment)| super::image_resources::decode_path(fragment))
        .transpose()?;
    if document.and_then(|path| path.canonicalize().ok()).as_ref() == Some(&path) {
        if let Some(anchor) = anchor {
            return Ok(Destination::Anchor(anchor));
        }
    }
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            super::ALLOWED_EXTENSIONS
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
        })
    {
        Ok(Destination::Markdown { path, anchor })
    } else {
        Ok(Destination::File(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_supported_urls_and_decodes_heading_fragments() {
        assert_eq!(
            resolve("#Hello%20%CE%BB", None).unwrap(),
            Destination::Anchor("Hello λ".into())
        );
        for url in [
            "https://example.test/a",
            "http://example.test",
            "mailto:person@example.test",
        ] {
            assert!(matches!(resolve(url, None).unwrap(), Destination::Url(_)));
        }
        for url in [
            "javascript:alert(1)",
            "data:text/html,hello",
            "custom:run",
            "#bad%00",
            "",
        ] {
            assert!(resolve(url, None).is_err(), "{url}");
        }
    }
    #[test]
    fn local_files_preserve_unicode_and_missing_targets_are_not_created() {
        let root = std::env::temp_dir().join(format!(
            "amorist-links-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("source.md");
        let target = root.join("other λ.MD");
        std::fs::write(&source, "# Source").unwrap();
        std::fs::write(&target, "# Target").unwrap();
        assert_eq!(
            resolve("other%20%CE%BB.MD#Target", Some(&source)).unwrap(),
            Destination::Markdown {
                path: target.canonicalize().unwrap(),
                anchor: Some("Target".into())
            }
        );
        assert_eq!(
            resolve("source.md#Source", Some(&source)).unwrap(),
            Destination::Anchor("Source".into())
        );
        assert!(resolve("missing.md", Some(&source)).is_err());
        assert!(!root.join("missing.md").exists());
        assert!(resolve("other.md", None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
