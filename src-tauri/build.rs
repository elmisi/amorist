fn main() {
    let version = std::fs::read_to_string("../VERSION")
        .unwrap_or_else(|_| "0.0.0".to_string())
        .trim()
        .to_string();
    println!("cargo:rustc-env=CARGO_PKG_VERSION={}", version);
    sync_tauri_conf_version(&version);
    tauri_build::build()
}

fn sync_tauri_conf_version(version: &str) {
    let path = "tauri.conf.json";
    let Ok(content) = std::fs::read_to_string(path) else { return };
    let expected = format!("\"version\": \"{}\"", version);
    if content.contains(&expected) {
        return;
    }
    if let Some(start) = content.find("\"version\":") {
        let rest = &content[start..];
        if let Some(q1) = rest.find(": \"") {
            let val_start = start + q1 + 3;
            if let Some(q2) = content[val_start..].find('"') {
                let mut updated = String::with_capacity(content.len());
                updated.push_str(&content[..val_start]);
                updated.push_str(version);
                updated.push_str(&content[val_start + q2..]);
                let _ = std::fs::write(path, updated.as_bytes());
            }
        }
    }
}
