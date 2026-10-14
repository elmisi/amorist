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
        manifest.extend((relative.len() as u64).to_be_bytes());
        manifest.extend(relative.as_bytes());
        manifest.extend((bytes.len() as u64).to_be_bytes());
        manifest.extend(bytes);
    }
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
