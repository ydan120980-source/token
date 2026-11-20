//! Publish extracted archives only after all names, lengths and file types pass.
use flate2::read::GzDecoder;
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Read, Write},
    path::{Path, PathBuf},
};
use usage_engine::config_health::{guard, guard_existing_parent};

const REJECTED: &str = "INSTALL_ARCHIVE_REJECTED";
const WRITE: &str = "INSTALL_WRITE_FAILED";
const CANCELED: &str = "INSTALL_CANCELED";
const ENTRY_LIMIT: usize = 50_000;
pub const EXPANDED_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Debug, PartialEq, Eq)]
pub struct Extracted {
    pub files: usize,
    pub expanded_bytes: u64,
}

struct Extraction<F> {
    target: tempfile::TempDir,
    claimed: HashSet<String>,
    bytes: u64,
    maximum: u64,
    canceled: F,
}

fn reserved(part: &str) -> bool {
    let stem = part.split('.').next().unwrap_or_default().to_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|number| {
            matches!(
                number,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    })
}

fn entry_path(name: &[u8], package: bool) -> Result<(PathBuf, String)> {
    let name = std::str::from_utf8(name).map_err(|_| REJECTED)?;
    let name = if package {
        name.strip_prefix("package/").ok_or(REJECTED)?
    } else {
        name
    };
    if name.len() > 1024
        || name.is_empty()
        || name.starts_with('/')
        || name.contains(['\\', ':', '<', '>', '"', '|', '?', '*'])
        || name.chars().any(|ch| ch < ' ' || ch == '\u{7f}')
    {
        return Err(REJECTED);
    }
    let mut path = PathBuf::new();
    let mut key = String::new();
    for part in name.trim_end_matches('/').split('/') {
        if part.is_empty()
            || part.ends_with(['.', ' '])
            || part.encode_utf16().count() > 255
            || reserved(part)
        {
            return Err(REJECTED);
        }
        path.push(part);
        if !key.is_empty() {
            key.push('/');
        }
        key.push_str(&part.to_lowercase());
    }
    Ok((path, key))
}

impl<F: Fn() -> bool> Extraction<F> {
    fn new(destination: &Path, maximum: u64, canceled: F) -> Result<Self> {
        if (canceled)() {
            return Err(CANCELED);
        }
        let parent = destination.parent().ok_or(REJECTED)?;
        guard_existing_parent(destination).map_err(|_| REJECTED)?;
        if fs::symlink_metadata(destination).is_ok() {
            return Err(REJECTED);
        }
        fs::create_dir_all(parent).map_err(|_| WRITE)?;
        guard(parent).map_err(|_| REJECTED)?;
        let target = tempfile::Builder::new()
            .prefix(".extract-")
            .tempdir_in(parent)
            .map_err(|_| WRITE)?;
        Ok(Self {
            target,
            claimed: HashSet::new(),
            bytes: 0,
            maximum: maximum.min(EXPANDED_LIMIT),
            canceled,
        })
    }

    fn entry(
        &mut self,
        name: &[u8],
        size: u64,
        is_dir: bool,
        package: bool,
        mut bytes: impl Read,
    ) -> Result<()> {
        if (self.canceled)() {
            return Err(CANCELED);
        }
        if self.claimed.len() >= ENTRY_LIMIT
            || is_dir && size != 0
            || size > self.maximum.saturating_sub(self.bytes)
        {
            return Err(REJECTED);
        }
        let (relative, key) = entry_path(name, package)?;
        if !self.claimed.insert(key) {
            return Err(REJECTED);
        }
        let path = self.target.path().join(relative);
        guard_existing_parent(&path).map_err(|_| REJECTED)?;
        if is_dir {
            fs::create_dir_all(&path).map_err(|_| REJECTED)?;
            guard(&path).map_err(|_| REJECTED)?;
            return Ok(());
        }
        let dir = path.parent().ok_or(REJECTED)?;
        fs::create_dir_all(dir).map_err(|_| REJECTED)?;
        guard(dir).map_err(|_| REJECTED)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| REJECTED)?;
        self.copy(&mut bytes, &mut file, size)?;
        self.bytes += size;
        file.sync_all().map_err(|_| WRITE)?;
        Ok(())
    }

    fn copy(&self, mut input: impl Read, mut output: impl Write, mut remaining: u64) -> Result<()> {
        let mut buffer = [0; 64 * 1024];
        loop {
            if (self.canceled)() {
                return Err(CANCELED);
            }
            let limit = (remaining.saturating_add(1).min(buffer.len() as u64)) as usize;
            let bytes = match input.read(&mut buffer[..limit]) {
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                result => result.map_err(|_| REJECTED)?,
            };
            if bytes == 0 {
                return if remaining == 0 {
                    Ok(())
                } else {
                    Err(REJECTED)
                };
            }
            if bytes as u64 > remaining {
                return Err(REJECTED);
            }
            output.write_all(&buffer[..bytes]).map_err(|_| WRITE)?;
            remaining -= bytes as u64;
        }
    }

    fn finish(self, destination: &Path) -> Result<Extracted> {
        if self.claimed.is_empty() {
            return Err(REJECTED);
        }
        if (self.canceled)() {
            return Err(CANCELED);
        }
        let parent = destination.parent().ok_or(REJECTED)?;
        guard(parent).map_err(|_| REJECTED)?;
        guard(self.target.path()).map_err(|_| REJECTED)?;
        rename_new(self.target.path(), destination)?;
        Ok(Extracted {
            files: self.claimed.len(),
            expanded_bytes: self.bytes,
        })
    }
}

#[cfg(windows)]
fn rename_new(from: &Path, to: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::MoveFileW};
    let from: Vec<u16> = from.as_os_str().encode_wide().chain([0]).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: The buffers are live and NUL terminated. MoveFileW refuses to
    // overwrite a directory created concurrently with stage publication.
    unsafe { MoveFileW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr())) }.map_err(|_| WRITE)
}

#[cfg(not(windows))]
fn rename_new(from: &Path, to: &Path) -> Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(REJECTED);
    }
    fs::rename(from, to).map_err(|_| WRITE)
}

pub fn tar_gzip(
    file: &Path,
    destination: &Path,
    maximum: u64,
    canceled: impl Fn() -> bool,
) -> Result<Extracted> {
    guard(file).map_err(|_| REJECTED)?;
    let input = File::open(file).map_err(|_| REJECTED)?;
    let mut reader = tar::Archive::new(GzDecoder::new(BufReader::new(input)));
    let mut transaction = Extraction::new(destination, maximum, canceled)?;
    for entry in reader.entries().map_err(|_| REJECTED)?.raw(true) {
        let mut entry = entry.map_err(|_| REJECTED)?;
        let kind = entry.header().entry_type();
        if !kind.is_file() && !kind.is_dir() {
            return Err(REJECTED);
        }
        let name = entry.path_bytes().into_owned();
        transaction.entry(&name, entry.size(), kind.is_dir(), true, &mut entry)?;
    }
    // TAR uses two zero records at EOF. The parser consumes the first one.
    let mut decoder = reader.into_inner();
    let mut buffer = [0; 8192];
    let mut trailing = 0usize;
    loop {
        if (transaction.canceled)() {
            return Err(CANCELED);
        }
        let bytes = decoder.read(&mut buffer).map_err(|_| REJECTED)?;
        if bytes == 0 {
            break;
        }
        trailing += bytes;
        if trailing > 1024 * 1024 || buffer[..bytes].iter().any(|byte| *byte != 0) {
            return Err(REJECTED);
        }
    }
    if trailing < 512 {
        return Err(REJECTED);
    }
    transaction.finish(destination)
}

pub fn zip(
    file: &Path,
    destination: &Path,
    maximum: u64,
    canceled: impl Fn() -> bool,
) -> Result<Extracted> {
    guard(file).map_err(|_| REJECTED)?;
    let mut archive = zip::ZipArchive::new(BufReader::new(File::open(file).map_err(|_| REJECTED)?))
        .map_err(|_| REJECTED)?;
    if archive.len() > ENTRY_LIMIT {
        return Err(REJECTED);
    }
    let mut tx = Extraction::new(destination, maximum, canceled)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| REJECTED)?;
        let directory = entry.is_dir();
        let size = entry.size();
        let mode = entry.unix_mode().unwrap_or(0) & 0o170000;
        if !matches!(mode, 0 | 0o040000 | 0o100000)
            || mode == 0o040000 && !directory
            || mode == 0o100000 && directory
        {
            return Err(REJECTED);
        }
        let name = entry.name_raw().to_vec();
        tx.entry(&name, size, directory, false, &mut entry)?;
    }
    tx.finish(destination)
}
