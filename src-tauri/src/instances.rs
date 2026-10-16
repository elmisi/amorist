use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug)]
pub struct Launch {
    pub executable: PathBuf,
    pub arguments: Vec<OsString>,
    wait_for_launcher: bool,
}

impl Launch {
    pub fn prepare(executable: PathBuf, bundle: Option<PathBuf>, file: Option<&Path>, debug: bool) -> Self {
        let mut arguments = Vec::new();
        let wait_for_launcher = bundle.is_some();
        let executable = if let Some(bundle) = bundle {
            arguments.extend([OsString::from("-n"), bundle.into_os_string(), OsString::from("--args")]);
            PathBuf::from("/usr/bin/open")
        } else { executable };
        if debug { arguments.push("--debug".into()); }
        // End option parsing before any user-controlled filename.
        if let Some(file) = file {
            arguments.push("--".into());
            arguments.push(file.as_os_str().into());
        } else {
            arguments.push("--new-document".into());
        }
        Self { executable, arguments, wait_for_launcher }
    }

    pub fn with_anchor(mut self, anchor: Option<&str>) -> Self {
        if let Some(anchor) = anchor {
            let at = self.arguments.iter().position(|arg| arg == "--").unwrap_or(self.arguments.len());
            self.arguments.splice(at..at, [OsString::from("--heading-anchor"), OsString::from(anchor)]);
        }
        self
    }

    pub fn spawn(self) -> Result<u32, String> {
        let mut command = Command::new(&self.executable);
        command.args(&self.arguments).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x00000008 | 0x00000200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        }
        let mut child = command.spawn().map_err(|e| format!("Could not open a new window: {e}"))?;
        let pid = child.id();
        if self.wait_for_launcher {
            let status = child.wait().map_err(|e| format!("Could not check the macOS launcher: {e}"))?;
            if !status.success() { return Err(format!("The macOS launcher could not open a new window: {status}")); }
            return Ok(pid);
        }
        // Reap exited children without tying their lifetime to this window.
        std::thread::spawn(move || { let _ = child.wait(); });
        Ok(pid)
    }
}

#[cfg(any(target_os = "macos", test))]
pub fn macos_bundle(executable: &Path) -> Option<PathBuf> {
    let macos = executable.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    (macos.file_name()? == "MacOS" && contents.file_name()? == "Contents"
        && bundle.extension()? == "app").then(|| bundle.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_keeps_filename_as_one_argument_and_uses_bundle_when_present() {
        let filename = Path::new("/tmp/--nota è $(touch nope).md");
        let bundle = PathBuf::from("/Applications/amorist test.app");
        let plan = Launch::prepare("/unused".into(), Some(bundle.clone()), Some(filename), true);
        assert_eq!(plan.executable, PathBuf::from("/usr/bin/open"));
        assert_eq!(plan.arguments, vec![OsString::from("-n"), bundle.into_os_string(), "--args".into(),
            "--debug".into(), "--".into(), filename.as_os_str().into()]);
        let anchored = Launch::prepare("/tmp/amorist".into(), None, Some(filename), false).with_anchor(Some("heading λ"));
        assert_eq!(anchored.arguments, vec![OsString::from("--heading-anchor"), OsString::from("heading λ"), OsString::from("--"), filename.as_os_str().into()]);
        let plain = Launch::prepare("/tmp/amorist".into(), None, None, false);
        assert_eq!(plain.arguments, vec![OsString::from("--new-document")]);
        assert_eq!(macos_bundle(Path::new("/Applications/Test.app/Contents/MacOS/amorist")), Some("/Applications/Test.app".into()));
        assert!(macos_bundle(Path::new("/tmp/target/debug/amorist")).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn child_lives_independently_and_launch_errors_are_returned() {
        let dir = crate::tests::scratch_dir("instance-launch");
        let marker = dir.join("child finished");
        let launch = Launch { executable: "/bin/sh".into(), arguments: vec!["-c".into(),
            "sleep 0.1; printf independent > \"$1\"".into(), "probe".into(), marker.as_os_str().into()], wait_for_launcher: false };
        assert!(launch.spawn().unwrap() > 0);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while !marker.exists() && std::time::Instant::now() < deadline { std::thread::sleep(std::time::Duration::from_millis(20)); }
        assert_eq!(std::fs::read_to_string(marker).unwrap(), "independent");
        assert!(Launch::prepare(dir.join("missing"), None, None, false).spawn().is_err());
        let failed_launcher = Launch { executable: "/bin/sh".into(), arguments: vec!["-c".into(), "exit 7".into()], wait_for_launcher: true };
        assert!(failed_launcher.spawn().unwrap_err().contains("could not open a new window"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
