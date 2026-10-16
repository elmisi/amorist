//! Five global preferences, shared through a complete atomic file replacement.
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

pub const COLORS: &[&str] = &["#eef1f4", "#e8f2ff", "#e9f5ed", "#fff6d8", "#faedf2"];
pub const SCALES: &[f64] = &[0.75, 0.875, 1.0, 1.125, 1.25, 1.5];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub highlight_current_line: bool,
    pub highlight_color: String,
    pub base_font_size: u8,
    pub table_scale: f64,
    pub code_scale: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            highlight_current_line: false,
            highlight_color: COLORS[0].into(),
            base_font_size: 16,
            table_scale: 0.875,
            code_scale: 1.0,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !(12..=24).contains(&self.base_font_size)
            || !COLORS.contains(&self.highlight_color.as_str())
            || !SCALES.contains(&self.table_scale)
            || !SCALES.contains(&self.code_scale)
        {
            return Err(
                "Invalid settings: choose a declared font size, scale and palette color.".into(),
            );
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
pub struct Loaded {
    pub settings: Settings,
    pub warning: Option<String>,
}

pub fn load(root: &Path) -> Loaded {
    let path = root.join("settings.json");
    let result = match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice::<Settings>(&bytes)
            .map_err(|e| e.to_string())
            .and_then(|settings| {
                settings.validate()?;
                Ok(settings)
            }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(error) => Err(error.to_string()),
    };
    match result {
        Ok(settings) => Loaded {
            settings,
            warning: None,
        },
        Err(error) => Loaded {
            settings: Settings::default(),
            warning: Some(
                format!(
            "Cannot load settings; defaults are active. The original file was preserved: {error}"),
            ),
        },
    }
}

pub fn save(root: &Path, settings: Settings) -> Result<Settings, String> {
    settings.validate()?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())? + "\n";
    super::file_io::write(
        &root.join("locks"),
        &root.join("settings.json"),
        &json,
        super::file_io::Expected::Any,
        true,
    )?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    fn scratch() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "amorist-settings-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn defaults_validation_and_corrupt_file_preservation() {
        let root = scratch();
        assert_eq!(load(&root).settings, Settings::default());
        assert!(load(&root).warning.is_none());
        let original = b"{ broken settings";
        fs::write(root.join("settings.json"), original).unwrap();
        assert!(load(&root).warning.is_some());
        assert_eq!(fs::read(root.join("settings.json")).unwrap(), original);
        let mut invalid = Settings::default();
        invalid.base_font_size = 25;
        assert!(save(&root, invalid).is_err());
        let mut invalid = Settings::default();
        invalid.highlight_color = "red".into();
        assert!(save(&root, invalid).is_err());
        let mut invalid = Settings::default();
        invalid.table_scale = 0.9;
        assert!(save(&root, invalid).is_err());
        assert_eq!(fs::read(root.join("settings.json")).unwrap(), original);
        let mut valid = Settings::default();
        valid.highlight_current_line = true;
        valid.base_font_size = 24;
        valid.code_scale = 1.5;
        assert_eq!(save(&root, valid.clone()).unwrap(), valid);
        assert_eq!(load(&root).settings, valid);
        assert!(load(&root).warning.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_writers_and_readers_observe_complete_valid_settings() {
        let root = Arc::new(scratch());
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = [12, 24]
            .into_iter()
            .map(|size| {
                let root = root.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    for _ in 0..12 {
                        let mut value = Settings::default();
                        value.base_font_size = size;
                        save(&root, value).unwrap();
                    }
                })
            })
            .collect();
        barrier.wait();
        for _ in 0..50 {
            let value = load(&root);
            assert!(value.warning.is_none());
            value.settings.validate().unwrap();
        }
        for handle in handles {
            handle.join().unwrap();
        }
        assert!([12, 24].contains(&load(&root).settings.base_font_size));
        fs::remove_dir_all(root.as_ref()).unwrap();
    }
}
