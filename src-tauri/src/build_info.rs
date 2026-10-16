use serde::Serialize;
use std::{fs::OpenOptions, io::Write, path::Path};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    pub schema_version: u32,
    pub version: &'static str,
    pub build_id: &'static str,
    pub fingerprint: &'static str,
    pub commit: &'static str,
    pub target: &'static str,
    pub dirty: bool,
}

pub fn current() -> BuildInfo {
    BuildInfo {
        schema_version: 1,
        version: env!("AMORIST_VERSION"),
        build_id: env!("AMORIST_BUILD_ID"),
        fingerprint: env!("AMORIST_BUILD_FINGERPRINT"),
        commit: env!("AMORIST_BUILD_COMMIT"),
        target: env!("AMORIST_BUILD_TARGET"),
        dirty: env!("AMORIST_BUILD_DIRTY") == "true",
    }
}

pub fn write_new(path: &Path) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&current()).map_err(|e| e.to_string())?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("Cannot create build-info file {}: {e}", path.display()))?;
    file.write_all(&bytes)
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}
