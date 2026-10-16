use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

const INPUTS: &[&str] = &[
    "VERSION",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/build.rs",
    "src-tauri/build_identity.rs",
    "src-tauri/tauri.conf.json",
    "src-tauri/src",
    "src-tauri/capabilities",
    "src-tauri/icons",
    "src-tauri/linux",
    "web",
];

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8(output.stdout)
        .map_err(|e| e.to_string())?
        .trim()
        .into())
}

fn collect(path: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    println!("cargo:rerun-if-changed={}", path.display());
    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            collect(&entry.map_err(|e| e.to_string())?.path(), files)?;
        }
    } else if path.is_file() {
        files.push(path.to_owned());
    } else {
        return Err(format!("Missing build identity input: {}", path.display()));
    }
    Ok(())
}

fn hash(root: &Path, bytes: &[u8]) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(["hash-object", "--stdin"])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all(bytes)
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }
    let value = String::from_utf8(output.stdout)
        .map_err(|e| e.to_string())?
        .trim()
        .to_owned();
    if !matches!(value.len(), 40 | 64) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Invalid Git content fingerprint".into());
    }
    Ok(value)
}

fn append_entry(manifest: &mut Vec<u8>, name: &str, bytes: &[u8]) {
    manifest.extend((name.len() as u64).to_be_bytes());
    manifest.extend(name.as_bytes());
    manifest.extend((bytes.len() as u64).to_be_bytes());
    manifest.extend(bytes);
}

// CLI overrides are not necessarily repository files. Measure their contents,
// including decoder payloads, without making temporary host paths the identity.
fn append_bundle_config(manifest: &mut Vec<u8>, config: Option<&str>) -> Result<(), String> {
    let mut config: serde_json::Value = serde_json::from_str(config.unwrap_or("{}"))
        .map_err(|e| format!("Invalid effective Tauri configuration: {e}"))?;
    if !config.is_object() {
        return Err("Effective Tauri configuration must be an object".into());
    }
    config.sort_all_objects();
    for format in ["appimage", "deb", "rpm"] {
        let pointer = format!("/bundle/linux/{format}/files");
        if let Some(files) = config.pointer_mut(&pointer) {
            let files = files
                .as_object_mut()
                .ok_or("Bundle files must be a destination/source map")?;
            for (destination, source) in files.iter_mut() {
                let source_path =
                    PathBuf::from(source.as_str().ok_or("Bundle source must be a path")?);
                let mut paths = Vec::new();
                collect(&source_path, &mut paths)?;
                paths.sort();
                for path in paths {
                    let name = if source_path.is_dir() {
                        let relative =
                            path.strip_prefix(&source_path).map_err(|e| e.to_string())?;
                        format!(
                            "{pointer}/{destination}/{}",
                            relative
                                .to_str()
                                .ok_or("Non-UTF8 bundle destination path")?
                                .replace('\\', "/")
                        )
                    } else {
                        format!("{pointer}/{destination}")
                    };
                    append_entry(
                        manifest,
                        &name,
                        &fs::read(&path).map_err(|e| e.to_string())?,
                    );
                }
                *source = serde_json::Value::String(destination.clone());
            }
        }
    }
    append_entry(
        manifest,
        "effective-tauri-config",
        &serde_json::to_vec(&config).map_err(|e| e.to_string())?,
    );
    Ok(())
}

pub fn emit(version: &str) -> Result<(), String> {
    let root = Path::new("..");
    let mut files = Vec::new();
    for input in INPUTS {
        collect(&root.join(input), &mut files)?;
    }
    files.sort();
    let mut manifest = Vec::new();
    for path in files {
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .to_str()
            .ok_or("Non-UTF8 build input path")?
            .replace('\\', "/");
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        append_entry(&mut manifest, &relative, &bytes);
    }
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    let config = std::env::var("TAURI_CONFIG").ok();
    append_bundle_config(&mut manifest, config.as_deref())?;
    let fingerprint = hash(root, &manifest)?;
    for variable in ["AMORIST_BUILD_COMMIT", "AMORIST_BUILD_DIRTY"] {
        println!("cargo:rerun-if-env-changed={variable}");
    }
    let release = std::env::var("PROFILE").unwrap_or_default() == "release";
    let commit = git(root, &["rev-parse", "HEAD"])
        .or_else(|_| std::env::var("AMORIST_BUILD_COMMIT").map_err(|e| e.to_string()));
    let commit = match commit {
        Ok(value) if value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit()) => value,
        _ if !release => "unknown".into(),
        _ => {
            return Err("Release requires a measured source commit or AMORIST_BUILD_COMMIT".into())
        }
    };
    let mut status_args = vec!["status", "--porcelain", "--untracked-files=all", "--"];
    status_args.extend(INPUTS);
    let dirty = match git(root, &status_args) {
        Ok(status) => !status.is_empty(),
        Err(_) => match std::env::var("AMORIST_BUILD_DIRTY").as_deref() {
            Ok("true") => true,
            Ok("false") => false,
            _ if !release => true,
            _ => {
                return Err(
                    "Release source snapshot requires AMORIST_BUILD_DIRTY provenance".into(),
                )
            }
        },
    };
    for reference in ["HEAD", "index", "packed-refs", "refs"] {
        if let Ok(path) = git(root, &["rev-parse", "--git-path", reference]) {
            println!("cargo:rerun-if-changed={}", root.join(path).display());
        }
    }
    let target = std::env::var("TARGET").map_err(|e| e.to_string())?;
    for (key, value) in [
        ("AMORIST_BUILD_COMMIT", commit),
        ("AMORIST_BUILD_FINGERPRINT", fingerprint.clone()),
        ("AMORIST_BUILD_TARGET", target.clone()),
        ("AMORIST_BUILD_DIRTY", dirty.to_string()),
        (
            "AMORIST_BUILD_ID",
            format!("{version}:{target}:{fingerprint}"),
        ),
    ] {
        println!("cargo:rustc-env={key}={value}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_bundle_payload_identity_uses_bytes_not_host_paths() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "amorist-build-identity-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&directory).unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(directory.clone());
        let first = directory.join("one.so");
        let second = directory.join("two.so");
        fs::write(&first, b"decoder one").unwrap();
        fs::write(&second, b"decoder one").unwrap();
        let measure = |path: &Path| {
            let config = serde_json::json!({"bundle":{"linux":{"appimage":{"files":{"usr/lib/decoder.so":path}}}}});
            let mut manifest = Vec::new();
            append_bundle_config(&mut manifest, Some(&config.to_string())).unwrap();
            manifest
        };
        let baseline = measure(&first);
        assert_eq!(
            baseline,
            measure(&second),
            "Relocating identical payload must preserve identity"
        );
        fs::write(&second, b"decoder two").unwrap();
        assert_ne!(
            baseline,
            measure(&second),
            "Changed decoder bytes must change identity"
        );
        let mut absent = Vec::new();
        append_bundle_config(&mut absent, None).unwrap();
        assert_ne!(
            baseline, absent,
            "Omitting the decoder must change identity"
        );
        let config = serde_json::json!({"bundle":{"linux":{"appimage":{"files":{"usr/lib/decoder.so":directory.join("missing.so")}}}}});
        assert!(append_bundle_config(&mut Vec::new(), Some(&config.to_string())).is_err());
    }

    #[test]
    fn effective_config_changes_are_measured_and_malformed_config_is_rejected() {
        let measure = |config: &str| {
            let mut manifest = Vec::new();
            append_bundle_config(&mut manifest, Some(config)).unwrap();
            manifest
        };
        assert_eq!(
            measure(r#"{"version":"1","identifier":"test"}"#),
            measure(r#"{ "identifier": "test", "version": "1" }"#)
        );
        assert_ne!(measure(r#"{"version":"1"}"#), measure(r#"{"version":"2"}"#));
        for invalid in [
            "not JSON",
            "[]",
            r#"{"bundle":{"linux":{"appimage":{"files":[]}}}}"#,
        ] {
            assert!(append_bundle_config(&mut Vec::new(), Some(invalid)).is_err());
        }
    }
}
