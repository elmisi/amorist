//! Image content classification for the scoped document-resource protocol.
//! No HTML response or generic filesystem command is provided by this module.
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
