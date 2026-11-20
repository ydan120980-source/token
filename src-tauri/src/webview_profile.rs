use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime},
};

const REGISTRY: &str = "quotadock-webview-leases-v1";
const OWNER: &[u8] = b"QuotaDock.Tauri.WebView2/v1";
const EXPIRY: Duration = Duration::from_secs(24 * 60 * 60);
pub const MAIN_PREFIX: &str = "quotadock-reader-";
pub const LOGIN_PREFIX: &str = "quotadock-login-";

pub struct Profile {
    path: PathBuf,
    lease_path: PathBuf,
    lease: Option<File>,
}

impl Profile {
    pub fn new(prefix: &str) -> io::Result<Self> {
        Self::in_directory(&env::temp_dir(), prefix)
    }

    fn in_directory(root: &Path, prefix: &str) -> io::Result<Self> {
        let registry = registry(root)?;
        let directory = tempfile::Builder::new()
            .prefix(prefix)
            .rand_bytes(24)
            .tempdir_in(root)?;
        let name = directory
            .path()
            .file_name()
            .ok_or(io::ErrorKind::InvalidData)?;
        let lease_path = registry.join(name);
        let mut lease = OpenOptions::new()
            .write(true)
            .read(true)
            .create_new(true)
            .open(&lease_path)?;
        lease.try_lock().map_err(io::Error::from)?;
        if let Err(error) = lease.write_all(OWNER).and_then(|()| lease.sync_all()) {
            drop(lease);
            let _ = fs::remove_file(lease_path);
            return Err(error);
        }
        Ok(Self {
            path: directory.keep(),
            lease_path,
            lease: Some(lease),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn close(mut self) -> io::Result<()> {
        self.cleanup()
    }

    fn cleanup(&mut self) -> io::Result<()> {
        let Some(lease) = self.lease.take() else {
            return Ok(());
        };
        let result = remove_profile(&self.path);
        drop(lease);
        if result.is_ok() {
            let _ = fs::remove_file(&self.lease_path);
        }
        result
    }
}

impl Drop for Profile {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn registry(root: &Path) -> io::Result<PathBuf> {
    let path = root.join(REGISTRY);
    match fs::create_dir(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    Ok(path)
}

/// Run off the UI thread. Each lease names exactly one owned sibling directory.
pub fn sweep() {
    sweep_directory(&env::temp_dir(), SystemTime::now());
}

fn sweep_directory(root: &Path, now: SystemTime) {
    let Ok(registry) = registry(root) else {
        return;
    };
    let Ok(entries) = fs::read_dir(registry) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let valid = [MAIN_PREFIX, LOGIN_PREFIX].iter().any(|prefix| {
            name.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.len() == 24 && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
            })
        });
        if !valid {
            continue;
        }
        let lease_path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&lease_path) else {
            continue;
        };
        if !metadata.is_file() || is_reparse(&metadata) || metadata.len() != OWNER.len() as u64 {
            continue;
        }
        let Ok(created) = metadata.modified() else {
            continue;
        };
        if now.duration_since(created).is_ok_and(|age| age >= EXPIRY) {
            let _ = reap(&lease_path, &root.join(name));
        }
    }
}

fn reap(lease_path: &Path, path: &Path) -> io::Result<()> {
    let mut lease = OpenOptions::new().read(true).write(true).open(lease_path)?;
    lease.try_lock().map_err(io::Error::from)?;
    let mut marker = [0; OWNER.len()];
    lease.read_exact(&mut marker)?;
    if marker != OWNER {
        return Err(io::ErrorKind::InvalidData.into());
    }
    remove_profile(path)?;
    drop(lease);
    fs::remove_file(lease_path)
}

fn remove_profile(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !is_reparse(&metadata) => {}
        Ok(_) => return Err(io::ErrorKind::PermissionDenied.into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error)
                if cfg!(windows)
                    && matches!(error.raw_os_error(), Some(5 | 32 | 33 | 145))
                    && Instant::now() < deadline =>
            {
                // The browser can keep a profile handle after its window has gone.
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sweep_recovers_only_expired_owned_profiles_with_no_live_lease() -> io::Result<()> {
        let root = tempfile::tempdir()?;
        let mut orphan = Profile::in_directory(root.path(), LOGIN_PREFIX)?;
        let live = Profile::in_directory(root.path(), MAIN_PREFIX)?;
        let other = root.path().join("quotadock-login-012345678901234567890123");
        fs::create_dir(&other)?;
        drop(orphan.lease.take());
        sweep_directory(root.path(), SystemTime::now());
        assert!(orphan.path().exists());
        sweep_directory(
            root.path(),
            SystemTime::now() + EXPIRY + Duration::from_secs(1),
        );
        assert!(!orphan.path().exists());
        assert!(live.path().exists());
        assert!(other.exists());
        Ok(())
    }

    #[cfg(windows)]
    #[test]
    fn closing_the_temporary_profile_retries_a_late_handle_release() -> io::Result<()> {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tempfile::tempdir()?;
        let profile = Profile::in_directory(root.path(), MAIN_PREFIX)?;
        let path = profile.path().to_owned();
        let acquired = OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(0)
            .open(path.join("fixture-webview-profile"))?;
        let owner = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(260));
            drop(acquired);
        });
        let result = profile.close();
        owner
            .join()
            .map_err(|_| io::Error::other("profile fixture thread failed"))?;
        result?;
        assert!(!path.exists());
        Ok(())
    }
}
