//! Image content classification for the scoped document-resource protocol.
//! No HTML response or generic filesystem command is provided by this module.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug)]
pub struct Resource {
    pub path: PathBuf,
    pub mime: &'static str,
}

#[derive(Default)]
pub struct Store {
    generation: u64,
    serial: u64,
    document: Option<PathBuf>,
    resources: HashMap<String, Resource>,
}

impl Store {
    /// Called after a successful New/Open/SaveAs, never for a cancelled operation.
    pub fn replace_document(&mut self, document: Option<PathBuf>) {
        self.generation = self.generation.wrapping_add(1);
        self.document = document;
        self.resources.clear();
    }

    pub fn resolve_reference(&self, reference: &str) -> Result<PathBuf, String> {
        if reference.to_ascii_lowercase().starts_with("file:") {
            return tauri::Url::parse(reference)
                .map_err(|e| e.to_string())?
                .to_file_path()
                .map_err(|_| "Invalid local file URL.".to_string());
        }
        let value = reference.split(['?', '#']).next().unwrap_or("");
        let decoded = decode_path(value)?;
        let path = Path::new(&decoded);
        if path.is_absolute() {
            return Ok(path.to_owned());
        }
        if let Some((scheme, _)) = value.split_once(':') {
            if scheme.starts_with(|c: char| c.is_ascii_alphabetic())
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
            {
                return Err("This image reference is not a local path.".into());
            }
        }
        if decoded.is_empty() {
            return Err("An image path is required.".into());
        }
        let parent = self
            .document
            .as_deref()
            .and_then(Path::parent)
            .ok_or("A relative image needs a document path.")?;
        Ok(parent.join(path))
    }

    pub fn register(&mut self, path: &Path, bytes: &[u8]) -> Result<String, String> {
        let mime = image_mime(bytes).ok_or("The file is not a supported image.")?;
        self.serial = self
            .serial
            .checked_add(1)
            .ok_or("Image resource identifiers exhausted.")?;
        let id = format!("{:016x}{:016x}", self.generation, self.serial);
        self.resources.insert(
            id.clone(),
            Resource {
                path: path.to_owned(),
                mime,
            },
        );
        Ok(id)
    }

    /// Only exact identifiers from the current document map can be served.
    pub fn lookup(&self, id: &str) -> Option<Resource> {
        if id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        self.resources.get(id).cloned()
    }
}

fn decode_path(value: &str) -> Result<String, String> {
    let input = value.as_bytes();
    let mut output = Vec::with_capacity(input.len());
    let mut cursor = 0;
    while cursor < input.len() {
        if input[cursor] == b'%' {
            let hi = input
                .get(cursor + 1)
                .and_then(|c| (*c as char).to_digit(16));
            let lo = input
                .get(cursor + 2)
                .and_then(|c| (*c as char).to_digit(16));
            let byte = match (hi, lo) {
                (Some(hi), Some(lo)) => (hi * 16 + lo) as u8,
                _ => return Err("Invalid image path escape.".into()),
            };
            output.push(byte);
            cursor += 3;
        } else {
            output.push(input[cursor]);
            cursor += 1;
        }
    }
    if output.contains(&0) {
        return Err("Invalid image path character.".into());
    }
    String::from_utf8(output).map_err(|_| "Image path is not valid UTF-8.".into())
}

pub fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 16
        && &bytes[..4] == b"RIFF"
        && &bytes[8..12] == b"WEBP"
        && [b"VP8 ".as_slice(), b"VP8L", b"VP8X"].contains(&&bytes[12..16])
    {
        return Some("image/webp");
    }
    if bytes.len() >= 14 && bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
        let size = u32::from_be_bytes(bytes[..4].try_into().ok()?) as usize;
        if size >= 16 && size <= bytes.len() {
            let avif = |brand: &[u8]| brand == b"avif" || brand == b"avis";
            if avif(&bytes[8..12]) || bytes[16..size].chunks_exact(4).any(avif) {
                return Some("image/avif");
            }
        }
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let mut text = text.trim_start_matches('\u{feff}').trim_start();
    loop {
        if text.starts_with("<?xml") {
            text = text.split_once("?>")?.1.trim_start();
        } else if text.starts_with("<!--") {
            text = text.split_once("-->")?.1.trim_start();
        } else {
            break;
        }
    }
    if let Some(rest) = text.strip_prefix("<svg") {
        if rest.starts_with(|c: char| c.is_ascii_whitespace() || c == '>' || c == '/') {
            return Some("image/svg+xml");
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resources_are_opaque_and_old_document_ids_expire() {
        let mut store = Store::default();
        assert!(store.resolve_reference("images/photo.png").is_err());
        store.replace_document(Some(PathBuf::from("project/notes.md")));
        assert_eq!(
            store.resolve_reference("../images/λ.png").unwrap(),
            PathBuf::from("project/../images/λ.png")
        );
        let id = store
            .register(Path::new("project/images/λ.png"), b"\x89PNG\r\n\x1a\n")
            .unwrap();
        assert!(!id.contains("images"));
        let resource = store.lookup(&id).unwrap();
        assert_eq!(resource.mime, "image/png");
        assert_eq!(resource.path, PathBuf::from("project/images/λ.png"));
        assert!(store.lookup("../../private.txt").is_none());
        store.replace_document(Some(PathBuf::from("elsewhere/notes.md")));
        assert!(store.lookup(&id).is_none());
        let next = store
            .register(Path::new("elsewhere/photo.png"), b"\x89PNG\r\n\x1a\n")
            .unwrap();
        assert_ne!(id, next);
        store.replace_document(None);
        assert!(store.lookup(&next).is_none());
    }

    #[test]
    fn local_references_decode_paths_and_reject_remote_schemes() {
        let mut store = Store::default();
        store.replace_document(Some(PathBuf::from("project/notes.md")));
        assert_eq!(
            store
                .resolve_reference("../images/my%20%CE%BB%23photo.png#view")
                .unwrap(),
            PathBuf::from("project/../images/my λ#photo.png")
        );
        assert!(store
            .resolve_reference("https://example.test/photo.png")
            .is_err());
        assert!(store
            .resolve_reference("data:image/png;base64,AAAA")
            .is_err());
        assert!(store.resolve_reference("image%ZZ.png").is_err());
        assert!(store.resolve_reference("image%00.png").is_err());
        assert!(store.resolve_reference("image%FF.png").is_err());
        assert_eq!(
            store.resolve_reference("images/my%3Aphoto.png").unwrap(),
            PathBuf::from("project/images/my:photo.png")
        );
        #[cfg(unix)]
        assert_eq!(
            store
                .resolve_reference("file:///tmp/my%20photo.png")
                .unwrap(),
            PathBuf::from("/tmp/my photo.png")
        );
        #[cfg(windows)]
        assert_eq!(
            store.resolve_reference("C:/images/my%20photo.png").unwrap(),
            PathBuf::from("C:/images/my photo.png")
        );
    }

    #[test]
    fn recognizes_image_signatures_without_trusting_extensions() {
        for (bytes, mime) in [
            (b"\x89PNG\r\n\x1a\n".as_slice(), "image/png"),
            (b"\xff\xd8\xff", "image/jpeg"),
            (b"GIF89a", "image/gif"),
            (b"RIFF0000WEBPVP8X", "image/webp"),
            (b"BM000000000000", "image/bmp"),
            (b"\0\0\0\x18ftypmif1\0\0\0\0avifmif1", "image/avif"),
            (b"<?xml version=\"1.0\"?><!-- comment --><svg xmlns=\"http://www.w3.org/2000/svg\"/>", "image/svg+xml"),
        ] { assert_eq!(image_mime(bytes), Some(mime)); }
    }
    #[test]
    fn rejects_html_unknown_or_malformed_headers() {
        for bytes in [
            b"<html><svg></svg></html>".as_slice(),
            b"<script>alert(1)</script>",
            b"<svgscript>",
            b"RIFF0000WAVEfmt ",
            b"\0\0\xff\xffftypavif0000",
            b"<!-- unfinished",
            b"text",
        ] {
            assert_eq!(image_mime(bytes), None);
        }
    }
}
