//! Shared filesystem operations. Locks live in app data, never beside the
//! document, and remain on disk so waiting processes keep the same inode.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

static SERIAL: AtomicU64 = AtomicU64::new(0);
const LOCK_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum Expected {
    Any,
    Missing,
    Modified(SystemTime),
}

#[derive(Debug)]
pub struct ResolvedPath {
    pub path: PathBuf,
    pub(super) identity: String,
}

pub struct Lock {
    _file: File,
    #[cfg(test)]
    path: PathBuf,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LockIdentity {
    schema_version: u32,
    canonical_path: String,
    identity: String,
}

pub fn resolve(path: &Path) -> Result<ResolvedPath, String> {
    let absolute = std::path::absolute(path).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let verbatim = matches!(absolute.components().next(), Some(Component::Prefix(p)) if p.kind().is_verbatim());
    let mut resolved = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => resolved.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            Component::Normal(name) => {
                #[cfg(windows)]
                let name = windows_component(name, verbatim)?;
                resolved.push(name);
                match fs::symlink_metadata(&resolved) {
                    Ok(_) => resolved = fs::canonicalize(&resolved).map_err(|e| e.to_string())?,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(format!("Cannot resolve file identity: {e}")),
                }
            }
        }
    }
    let canonical = resolved
        .to_str()
        .ok_or("File identity is not valid Unicode.")?;
    let mut parent = resolved.parent().ok_or("A file path is required.")?;
    while !parent.exists() {
        parent = parent
            .parent()
            .ok_or("Cannot resolve the parent directory.")?;
    }
    if !parent.is_dir() {
        return Err("The file's parent is not a directory.".into());
    }
    let identity = normalize_identity(canonical, parent)?;
    Ok(ResolvedPath {
        path: resolved,
        identity,
    })
}

pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
    }
    hash
}

pub fn acquire(root: &Path, resolved: &ResolvedPath) -> Result<Lock, String> {
    acquire_key(
        root,
        resolved,
        fnv1a(resolved.identity.as_bytes()),
        LOCK_TIMEOUT,
    )
}

fn acquire_key(
    root: &Path,
    resolved: &ResolvedPath,
    key: u64,
    timeout: Duration,
) -> Result<Lock, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;
    for suffix in 0u64.. {
        let name = if suffix == 0 {
            format!("{key:016x}.lock")
        } else {
            format!("{key:016x}-{suffix}.lock")
        };
        let path = root.join(name);
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        loop {
            match file.try_lock() {
                Ok(()) => break,
                Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20))
                }
                Err(std::fs::TryLockError::WouldBlock) => {
                    return Err("LOCK_TIMEOUT: another instance is using this file.".into())
                }
                Err(e) => return Err(e.to_string()),
            }
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.is_empty() {
            let record = LockIdentity {
                schema_version: 1,
                canonical_path: resolved
                    .path
                    .to_str()
                    .ok_or("File identity is not valid Unicode.")?
                    .into(),
                identity: resolved.identity.clone(),
            };
            let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
        } else {
            match serde_json::from_slice::<LockIdentity>(&bytes) {
                Ok(record)
                    if record.schema_version == 1
                        && record.identity == resolved.identity
                        && Path::new(&record.canonical_path).is_absolute()
                        && resolve(Path::new(&record.canonical_path))
                            .is_ok_and(|stored| stored.identity == resolved.identity) => {}
                // Preserve unknown/corrupt headers and hash collisions. Under
                // the lock, choose another slot rather than overwrite them.
                _ => continue,
            }
        }
        return Ok(Lock {
            _file: file,
            #[cfg(test)]
            path,
        });
    }
    Err("Could not allocate a file lock.".into())
}

fn validate(path: &Path, expected: Expected, force: bool) -> Result<(), String> {
    if force || matches!(expected, Expected::Any) {
        return Ok(());
    }
    let metadata = match fs::metadata(path) {
        Ok(metadata) => Some(metadata),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    match (expected, metadata) {
        (Expected::Missing, None) => Ok(()),
        (Expected::Modified(time), Some(metadata))
            if metadata.modified().map_err(|e| e.to_string())? == time =>
        {
            Ok(())
        }
        _ => Err("CONFLICT".into()),
    }
}

pub fn write(
    root: &Path,
    path: &Path,
    source: &str,
    expected: Expected,
    force: bool,
) -> Result<(), String> {
    if source.len() as u64 > super::MAX_MARKDOWN_BYTES {
        return Err("File is too large (max 10 MB).".into());
    }
    let resolved = resolve(path)?;
    let _guard = acquire(root, &resolved)?;
    validate(&resolved.path, expected, force)?;
    atomic_replace(&resolved.path, source.as_bytes(), expected, force)
}

fn atomic_replace(
    path: &Path,
    bytes: &[u8],
    expected: Expected,
    force: bool,
) -> Result<(), String> {
    let parent = path.parent().ok_or("A file path is required.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let permissions = match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => return Err("A file path is required.".into()),
        Ok(metadata) => Some(metadata.permissions()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    if permissions.as_ref().is_some_and(|p| p.readonly()) {
        return Err("The file is read-only.".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let name = path
        .file_name()
        .ok_or("A file name is required.")?
        .to_string_lossy();
    let names = (0u64..).map(|_| {
        parent.join(format!(
            ".{name}.amorist-tmp-{stamp:x}-{:x}-{:x}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ))
    });
    let (temporary, mut file) = reserve(names)?;
    let result = (|| {
        #[cfg(unix)]
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)
                .map_err(|e| e.to_string())?;
        }
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file); // Do not hold the destination or replacement open on Windows.
        validate(path, expected, force)?;
        if matches!(expected, Expected::Missing) && !force {
            rename_new(&temporary, path)?;
        } else {
            fs::rename(&temporary, path).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn reserve(names: impl IntoIterator<Item = PathBuf>) -> Result<(PathBuf, File), String> {
    for path in names {
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("No temporary file could be reserved.".into())
}

pub fn append(root: &Path, path: &Path, bytes: &[u8]) -> Result<(), String> {
    let resolved = resolve(path)?;
    let _guard = acquire(root, &resolved)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(&resolved.path)
        .map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 0 {
        file.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
        let mut last = [0u8; 1];
        file.read_exact(&mut last).map_err(|e| e.to_string())?;
        if last[0] != b'\n' {
            file.write_all(b"\n").map_err(|e| e.to_string())?;
        }
    }
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn normalize_identity(path: &str, _parent: &Path) -> Result<String, String> {
    Ok(path.into())
}

#[cfg(target_os = "macos")]
fn normalize_identity(path: &str, parent: &Path) -> Result<String, String> {
    use std::ffi::{c_void, CStr, CString};
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            bytes: *const i8,
            encoding: u32,
        ) -> *const c_void;
        fn CFStringCreateMutableCopy(
            allocator: *const c_void,
            capacity: isize,
            string: *const c_void,
        ) -> *mut c_void;
        fn CFStringNormalize(string: *mut c_void, form: isize);
        fn CFStringFold(string: *mut c_void, flags: usize, locale: *const c_void);
        fn CFStringGetLength(string: *const c_void) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(
            string: *const c_void,
            buffer: *mut i8,
            size: isize,
            encoding: u32,
        ) -> u8;
        fn CFRelease(object: *const c_void);
    }
    extern "C" {
        fn pathconf(path: *const i8, name: i32) -> i64;
    }
    let directory = CString::new(parent.to_str().ok_or("Invalid directory name.")?)
        .map_err(|e| e.to_string())?;
    // _PC_CASE_SENSITIVE = 11 in the Darwin SDK's sys/unistd.h.
    let sensitive = unsafe { pathconf(directory.as_ptr(), 11) };
    if sensitive < 0 {
        return Err("Cannot resolve filesystem case sensitivity.".into());
    }
    let bytes = CString::new(path).map_err(|e| e.to_string())?;
    const UTF8: u32 = 0x08000100;
    unsafe {
        let original = CFStringCreateWithCString(std::ptr::null(), bytes.as_ptr(), UTF8);
        if original.is_null() {
            return Err("Cannot normalize file identity.".into());
        }
        let string = CFStringCreateMutableCopy(std::ptr::null(), 0, original);
        CFRelease(original);
        if string.is_null() {
            return Err("Cannot normalize file identity.".into());
        }
        CFStringNormalize(string, 0); // Canonical decomposition (Form D).
        if sensitive == 0 {
            CFStringFold(string, 1, std::ptr::null());
        }
        let size = CFStringGetMaximumSizeForEncoding(CFStringGetLength(string), UTF8) + 1;
        if size <= 0 {
            CFRelease(string);
            return Err("Cannot normalize file identity.".into());
        }
        let mut buffer = vec![0u8; size as usize];
        let success = CFStringGetCString(string, buffer.as_mut_ptr().cast(), size, UTF8);
        CFRelease(string);
        if success == 0 {
            return Err("Cannot normalize file identity.".into());
        }
        CStr::from_ptr(buffer.as_ptr().cast())
            .to_str()
            .map(str::to_owned)
            .map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn windows_component(name: &std::ffi::OsStr, verbatim: bool) -> Result<String, String> {
    let name = name.to_str().ok_or("Invalid file name.")?;
    if verbatim {
        return Ok(name.into());
    }
    let name = name.trim_end_matches(['.', ' ']);
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let device = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|tail| {
                ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&tail)
            })
        });
    if name.is_empty()
        || device
        || name
            .chars()
            .any(|c| c <= '\u{1f}' || "<>:\"/\\|?*".contains(c))
    {
        return Err("Invalid Windows file name.".into());
    }
    Ok(name.into())
}

#[cfg(windows)]
fn normalize_identity(path: &str, parent: &Path) -> Result<String, String> {
    use std::ffi::c_void;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandleEx(
            handle: *mut c_void,
            class: i32,
            info: *mut c_void,
            size: u32,
        ) -> i32;
        fn LCMapStringEx(
            locale: *const u16,
            flags: u32,
            source: *const u16,
            source_size: i32,
            destination: *mut u16,
            destination_size: i32,
            version: *const c_void,
            reserved: *mut c_void,
            sort: isize,
        ) -> i32;
    }
    let directory = OpenOptions::new()
        .access_mode(0x80)
        .share_mode(7)
        .custom_flags(0x02000000)
        .open(parent)
        .map_err(|e| e.to_string())?;
    let mut flags = 0u32;
    let result = unsafe {
        GetFileInformationByHandleEx(
            directory.as_raw_handle(),
            23,
            (&mut flags as *mut u32).cast(),
            4,
        )
    };
    if result == 0 {
        return Err(format!(
            "Cannot resolve filesystem case sensitivity: {}",
            std::io::Error::last_os_error()
        ));
    }
    if flags & 1 != 0 {
        return Ok(path.into());
    }
    // Invariant, filesystem casing rules; LCMAP_LINGUISTIC_CASING is absent.
    // https://learn.microsoft.com/en-us/windows/win32/api/winnls/nf-winnls-lcmapstringex
    let input: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let locale = [0u16];
    let size = unsafe {
        LCMapStringEx(
            locale.as_ptr(),
            0x200,
            input.as_ptr(),
            -1,
            std::ptr::null_mut(),
            0,
            std::ptr::null(),
            std::ptr::null_mut(),
            0,
        )
    };
    if size <= 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut output = vec![0u16; size as usize];
    let count = unsafe {
        LCMapStringEx(
            locale.as_ptr(),
            0x200,
            input.as_ptr(),
            -1,
            output.as_mut_ptr(),
            size,
            std::ptr::null(),
            std::ptr::null_mut(),
            0,
        )
    };
    if count <= 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    String::from_utf16(&output[..count as usize - 1]).map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn rename_new(from: &Path, to: &Path) -> Result<(), String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        fn renameat2(from_dir: i32, from: *const i8, to_dir: i32, to: *const i8, flags: u32)
            -> i32;
    }
    let from = CString::new(from.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let to = CString::new(to.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let result = unsafe { renameat2(-100, from.as_ptr(), -100, to.as_ptr(), 1) };
    rename_result(result == 0)
}

#[cfg(target_os = "macos")]
fn rename_new(from: &Path, to: &Path) -> Result<(), String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        fn renamex_np(from: *const i8, to: *const i8, flags: u32) -> i32;
    }
    let from = CString::new(from.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let to = CString::new(to.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let result = unsafe { renamex_np(from.as_ptr(), to.as_ptr(), 4) };
    rename_result(result == 0)
}

#[cfg(windows)]
fn rename_new(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) };
    rename_result(result != 0)
}

fn rename_result(success: bool) -> Result<(), String> {
    if success {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        Err("CONFLICT".into())
    } else {
        Err(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn root(label: &str) -> PathBuf {
        super::super::tests::scratch_dir(label)
    }

    #[test]
    fn qa_req_f2_lock_keys_handle_hash_collisions_corrupt_headers_and_timeout() {
        assert_eq!(fnv1a(b""), 0xcbf29ce484222325);
        assert_eq!(fnv1a(b"hello"), 0xa430d84680aabd0b);
        let root = root("lock-routing");
        let locks = root.join("locks");
        let first = resolve(&root.join("first.md")).unwrap();
        let second = resolve(&root.join("second.md")).unwrap();
        let guard = acquire_key(&locks, &first, 42, Duration::from_millis(40)).unwrap();
        let first_slot = guard.path.clone();
        let blocked = acquire_key(&locks, &first, 42, Duration::from_millis(40));
        assert!(blocked.err().unwrap().contains("LOCK_TIMEOUT"));
        drop(guard);
        let other = acquire_key(&locks, &second, 42, Duration::from_millis(40)).unwrap();
        assert_ne!(first_slot, other.path);
        drop(other);
        let resumed = acquire_key(&locks, &first, 42, Duration::from_millis(40)).unwrap();
        assert_eq!(resumed.path, first_slot);
        drop(resumed);
        let corrupt = locks.join("000000000000002b.lock");
        fs::write(&corrupt, b"interrupted header").unwrap();
        let recovered = acquire_key(&locks, &first, 43, Duration::from_millis(40)).unwrap();
        assert_ne!(recovered.path, corrupt);
        assert_eq!(fs::read(&corrupt).unwrap(), b"interrupted header");
        drop(recovered);
        let inconsistent = locks.join("000000000000002c.lock");
        let header = LockIdentity {
            schema_version: 1,
            canonical_path: second.path.to_str().unwrap().into(),
            identity: first.identity.clone(),
        };
        let bytes = serde_json::to_vec(&header).unwrap();
        fs::write(&inconsistent, &bytes).unwrap();
        let checked = acquire_key(&locks, &first, 44, Duration::from_millis(40)).unwrap();
        assert_ne!(
            checked.path, inconsistent,
            "compare the full canonical path, not a cached key alone"
        );
        assert_eq!(fs::read(&inconsistent).unwrap(), bytes);
        drop(checked);
        assert!(first_slot.exists(), "lock files must survive unlock");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn qa_req_f1_occupied_temporary_names_preserve_the_existing_entry() {
        let root = root("temporary-collision");
        let occupied = root.join("occupied.tmp");
        let free = root.join("free.tmp");
        fs::write(&occupied, b"foreign interrupted work").unwrap();
        let (path, mut file) = reserve([occupied.clone(), free.clone()]).unwrap();
        assert_eq!(path, free);
        file.write_all(b"our work").unwrap();
        drop(file);
        assert_eq!(fs::read(&occupied).unwrap(), b"foreign interrupted work");
        assert_eq!(fs::read(&free).unwrap(), b"our work");
        assert!(reserve([occupied.clone()]).is_err());
        assert_eq!(fs::read(&occupied).unwrap(), b"foreign interrupted work");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn qa_req_f2_missing_destinations_and_deleted_open_files_do_not_get_overwritten() {
        let root = root("writer-expectations");
        let locks = root.join("locks");
        let path = root.join("path with caffè Ω.md");
        write(&locks, &path, "new\r\n😀", Expected::Missing, false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\r\n😀");
        assert_eq!(
            write(&locks, &path, "replacement", Expected::Missing, false),
            Err("CONFLICT".into())
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\r\n😀");
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(
            write(
                &locks,
                &path,
                "recreated",
                Expected::Modified(modified),
                false
            ),
            Err("CONFLICT".into())
        );
        assert!(!path.exists());
        let temporary = root.join("prepared.tmp");
        fs::write(&temporary, "prepared").unwrap();
        fs::write(&path, "external creation").unwrap();
        assert_eq!(rename_new(&temporary, &path), Err("CONFLICT".into()));
        assert_eq!(fs::read_to_string(&path).unwrap(), "external creation");
        assert_eq!(fs::read_to_string(&temporary).unwrap(), "prepared");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn qa_req_f1_symlinks_and_parent_components_preserve_the_target_and_alias() {
        use std::os::unix::fs::symlink;
        let root = root("writer-aliases");
        let target = root.join("real");
        fs::create_dir_all(target.join("nested")).unwrap();
        symlink(target.join("nested"), root.join("link")).unwrap();
        let new_path = root.join("link/../new file.md");
        assert_eq!(
            resolve(&new_path).unwrap().identity,
            resolve(&target.join("new file.md")).unwrap().identity
        );
        write(
            &root.join("locks"),
            &new_path,
            "preserved\r\n",
            Expected::Missing,
            false,
        )
        .unwrap();
        let actual = target.join("new file.md");
        symlink(&actual, root.join("file alias.md")).unwrap();
        let alias = root.join("file alias.md");
        let modified = fs::metadata(&actual).unwrap().modified().unwrap();
        write(
            &root.join("locks"),
            &alias,
            "changed\r\n",
            Expected::Modified(modified),
            false,
        )
        .unwrap();
        assert!(fs::symlink_metadata(&alias)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(actual).unwrap(), "changed\r\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn qa_req_f1_windows_casing_aliases_and_new_names_route_to_the_same_lock() {
        let root = root("windows-identity");
        let path = root.join("caffè notes.MD");
        let alias = root.join("CAFFÈ NOTES.md");
        fs::write(&path, "original").unwrap();
        assert!(
            alias.exists(),
            "this fixture requires the normal case-insensitive Windows directory"
        );
        assert_eq!(
            resolve(&path).unwrap().identity,
            resolve(&alias).unwrap().identity
        );
        assert_eq!(
            resolve(&root.join("new caffè.md")).unwrap().identity,
            resolve(&root.join("NEW CAFFÈ.MD")).unwrap().identity
        );
        assert_eq!(
            resolve(&root.join("new.md. ")).unwrap().identity,
            resolve(&root.join("new.md")).unwrap().identity
        );
        assert!(resolve(&root.join("CON.md")).is_err());
        write(&root.join("locks"), &alias, "changed", Expected::Any, false).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn qa_req_f1_macos_volume_casing_and_unicode_aliases_follow_the_filesystem() {
        let root = root("macos-identity");
        let path = root.join("café notes.MD");
        let decomposed = root.join("cafe\u{301} notes.MD");
        let case_alias = root.join("CAFÉ NOTES.md");
        fs::write(&path, "original").unwrap();
        assert!(
            decomposed.exists(),
            "the macOS volume must resolve canonical Unicode aliases"
        );
        assert_eq!(
            resolve(&path).unwrap().identity,
            resolve(&decomposed).unwrap().identity
        );
        if case_alias.exists() {
            assert_eq!(
                resolve(&path).unwrap().identity,
                resolve(&case_alias).unwrap().identity
            );
            assert_eq!(
                resolve(&root.join("new café.md")).unwrap().identity,
                resolve(&root.join("NEW CAFE\u{301}.MD")).unwrap().identity
            );
        } else {
            assert_ne!(
                resolve(&path).unwrap().identity,
                resolve(&case_alias).unwrap().identity
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[derive(Serialize, Deserialize)]
    struct Job {
        root: PathBuf,
        path: PathBuf,
        ready: PathBuf,
        result: PathBuf,
        expected: Expected,
        content: String,
        append_count: usize,
        number: usize,
        #[serde(default)]
        hold_until: Option<PathBuf>,
    }

    // Internal child entry point; parent tests invoke it explicitly in a new
    // process. It is not a separately delegated or skipped acceptance check.
    #[test]
    #[ignore]
    fn process_operation() {
        let job: Job =
            serde_json::from_str(&std::env::var("AMORIST_QA_FILE_JOB").unwrap()).unwrap();
        let result = if let Some(release) = &job.hold_until {
            let _guard = acquire(&job.root, &resolve(&job.path).unwrap()).unwrap();
            fs::write(&job.ready, "ready").unwrap();
            wait_for(release);
            Ok(())
        } else if job.append_count == 0 {
            fs::write(&job.ready, "ready").unwrap();
            write(&job.root, &job.path, &job.content, job.expected, false)
        } else {
            fs::write(&job.ready, "ready").unwrap();
            (0..job.append_count).try_for_each(|sequence| {
                let mut bytes = serde_json::to_vec(&serde_json::json!({"writer": job.number, "sequence": sequence, "text": job.content})).unwrap();
                bytes.push(b'\n');
                append(&job.root, &job.path, &bytes)
            })
        };
        fs::write(&job.result, serde_json::to_vec(&result).unwrap()).unwrap();
    }

    fn spawn(job: &Job) -> std::process::Child {
        Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "file_io::tests::process_operation"])
            .env("AMORIST_QA_FILE_JOB", serde_json::to_string(job).unwrap())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap()
    }

    fn wait_for(path: &Path) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !path.exists() {
            assert!(
                Instant::now() < deadline,
                "child did not become ready: {}",
                path.display()
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn qa_req_f2_a_waiting_process_checks_the_timestamp_after_acquiring_the_lock() {
        let root = root("writer-processes");
        let locks = root.join("locks");
        let path = root.join("shared caffè.md");
        fs::write(&path, "original").unwrap();
        let modified = fs::metadata(&path).unwrap().modified().unwrap();
        std::thread::sleep(Duration::from_millis(1100));
        let resolved = resolve(&path).unwrap();
        let guard = acquire(&locks, &resolved).unwrap();
        let job = Job {
            root: locks,
            path: path.clone(),
            ready: root.join("ready"),
            result: root.join("result"),
            expected: Expected::Modified(modified),
            content: "second must not replace first".into(),
            append_count: 0,
            number: 0,
            hold_until: None,
        };
        let mut child = spawn(&job);
        wait_for(&job.ready);
        std::thread::sleep(Duration::from_millis(100));
        assert!(!job.result.exists(), "child bypassed the held process lock");
        atomic_replace(&path, b"first process", Expected::Modified(modified), false).unwrap();
        drop(guard);
        assert!(child.wait().unwrap().success());
        let result: Result<(), String> =
            serde_json::from_slice(&fs::read(job.result).unwrap()).unwrap();
        assert_eq!(result, Err("CONFLICT".into()));
        assert_eq!(fs::read_to_string(path).unwrap(), "first process");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_process_appends_keep_every_record_and_the_original_tail() {
        let root = root("append-processes");
        let path = root.join("problems.jsonl");
        let prefix = b"{\"interrupted\":\"original tail";
        fs::write(&path, prefix).unwrap();
        let mut children = Vec::new();
        for number in 0..4 {
            let job = Job {
                root: root.join("locks"),
                path: path.clone(),
                ready: root.join(format!("ready-{number}")),
                result: root.join(format!("result-{number}")),
                expected: Expected::Any,
                content: "caffè 😀 ".repeat(600),
                append_count: 16,
                number,
                hold_until: None,
            };
            children.push((spawn(&job), job));
        }
        for (child, job) in &mut children {
            assert!(child.wait().unwrap().success());
            let result: Result<(), String> =
                serde_json::from_slice(&fs::read(&job.result).unwrap()).unwrap();
            assert_eq!(result, Ok(()));
        }
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(prefix));
        let text = String::from_utf8(bytes).unwrap();
        let records: Vec<serde_json::Value> = text
            .lines()
            .skip(1)
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(records.len(), 64);
        let identities: std::collections::HashSet<_> = records
            .iter()
            .map(|r| {
                (
                    r["writer"].as_u64().unwrap(),
                    r["sequence"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(identities.len(), 64);
        fs::remove_dir_all(root).unwrap();
    }
}
