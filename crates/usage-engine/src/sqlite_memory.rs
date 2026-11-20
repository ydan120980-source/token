// SQLite opens only a private snapshot. The source database and WAL are
// copied through read-only file handles, leaving the source SHM untouched.
use crate::policy::{mtime_ms, Audit};
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Cursor, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

const MAX_FILE: u64 = 512 * 1024 * 1024;
const HEADER: u64 = 32;
const FRAME_HEADER: u64 = 24;

pub fn checksum(bytes: &[u8], initial: [u32; 2], little: bool) -> [u32; 2] {
    let [mut s1, mut s2] = initial;
    let read = |at: usize| -> u32 {
        let b = [bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]];
        if little {
            u32::from_le_bytes(b)
        } else {
            u32::from_be_bytes(b)
        }
    };
    let mut i = 0;
    while i + 8 <= bytes.len() {
        let a = read(i);
        let b = read(i + 4);
        s1 = s1.wrapping_add(a).wrapping_add(s2);
        s2 = s2.wrapping_add(b).wrapping_add(s1);
        i += 8;
    }
    [s1, s2]
}

fn be32(bytes: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

struct Commit {
    page_size: usize,
    pages: u32,
    end: u64,
}

impl Commit {
    fn size(&self) -> u64 {
        self.pages as u64 * self.page_size as u64
    }
}

fn snapshot_error(_: io::Error) -> String {
    "SOURCE_PARSE_FAILED".to_owned()
}

fn committed_wal(wal: &mut impl Read, len: u64) -> Result<Option<Commit>, String> {
    if len == 0 {
        return Ok(None);
    }
    let mut header = [0; HEADER as usize];
    if len < HEADER {
        return Err("WAL_HEADER_INVALID".to_owned());
    }
    wal.read_exact(&mut header).map_err(snapshot_error)?;
    let magic = be32(&header, 0);
    if ![0x377f0682u32, 0x377f0683].contains(&magic) {
        return Err("WAL_HEADER_INVALID".to_string());
    }
    let size = be32(&header, 8) as usize;
    let little = magic == 0x377f0682;
    if !(512..=65_536).contains(&size) || !size.is_power_of_two() {
        return Err("WAL_PAGE_INVALID".to_string());
    }
    let mut sum = checksum(&header[..24], [0, 0], little);
    if sum[0] != be32(&header, 24) || sum[1] != be32(&header, 28) {
        return Err("WAL_CHECKSUM_INVALID".to_string());
    }
    let mut committed = None;
    let mut at = HEADER;
    let mut frame = [0; FRAME_HEADER as usize];
    let mut payload = vec![0; size];
    while at + FRAME_HEADER + size as u64 <= len {
        wal.read_exact(&mut frame).map_err(snapshot_error)?;
        wal.read_exact(&mut payload).map_err(snapshot_error)?;
        if frame[8..16] != header[16..24] {
            break;
        }
        sum = checksum(&frame[..8], sum, little);
        sum = checksum(&payload, sum, little);
        if sum[0] != be32(&frame, 16) || sum[1] != be32(&frame, 20) {
            break;
        }
        let page = be32(&frame, 0);
        if page == 0 || page as u64 * size as u64 > MAX_FILE {
            return Err("WAL_SIZE_LIMIT".to_string());
        }
        at += FRAME_HEADER + size as u64;
        let pages = be32(&frame, 4);
        if pages != 0 {
            committed = Some(Commit {
                page_size: size,
                pages,
                end: at,
            });
        }
    }
    if committed
        .as_ref()
        .is_some_and(|commit| commit.size() > MAX_FILE)
    {
        return Err("WAL_SIZE_LIMIT".to_string());
    }
    Ok(committed)
}

fn apply_commit(
    wal: &mut (impl Read + Seek),
    image: &mut (impl Write + Seek),
    commit: &Commit,
) -> io::Result<()> {
    wal.seek(SeekFrom::Start(HEADER))?;
    let mut at = HEADER;
    let mut frame = [0; FRAME_HEADER as usize];
    let mut payload = vec![0; commit.page_size];
    while at < commit.end {
        wal.read_exact(&mut frame)?;
        wal.read_exact(&mut payload)?;
        let page = be32(&frame, 0);
        if page <= commit.pages {
            image.seek(SeekFrom::Start((page as u64 - 1) * commit.page_size as u64))?;
            image.write_all(&payload)?;
        }
        at += FRAME_HEADER + commit.page_size as u64;
    }
    Ok(())
}

pub fn overlay_wal(main: &[u8], wal: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let wal = wal.unwrap_or_default();
    let mut reader = Cursor::new(wal);
    let Some(commit) = committed_wal(&mut reader, wal.len() as u64)? else {
        return Ok(main.to_vec());
    };
    let mut image = vec![0; commit.size() as usize];
    let copy = image.len().min(main.len());
    image[..copy].copy_from_slice(&main[..copy]);
    apply_commit(&mut reader, &mut Cursor::new(image.as_mut_slice()), &commit)
        .map_err(snapshot_error)?;
    Ok(image)
}

pub fn open_image(image: &[u8]) -> Result<Connection, String> {
    let mut db =
        Connection::open_in_memory().map_err(|_| "DATABASE_FORMAT_UNSUPPORTED".to_string())?;
    // A committed WAL snapshot still carries WAL-mode header bytes (18/19 = 2);
    // SQLite would then look for a WAL file beside the in-memory image. The
    // image is a consistent read-only snapshot, so present it as rollback mode.
    let mut image = image.to_vec();
    if image.len() >= 20 {
        image[18] = 1;
        image[19] = 1;
    }
    // SAFETY: The allocation and copy use the same checked byte length.
    // OwnedData takes ownership of the SQLite allocation before deserializing.
    unsafe {
        let ptr = rusqlite::ffi::sqlite3_malloc64(image.len() as u64) as *mut u8;
        let ptr =
            std::ptr::NonNull::new(ptr).ok_or_else(|| "DATABASE_FORMAT_UNSUPPORTED".to_string())?;
        std::ptr::copy_nonoverlapping(image.as_ptr(), ptr.as_ptr(), image.len());
        let data = rusqlite::serialize::OwnedData::from_raw_nonnull(ptr, image.len());
        db.deserialize(rusqlite::DatabaseName::Main, data, true)
            .map_err(|_| "DATABASE_FORMAT_UNSUPPORTED".to_string())?;
    }
    Ok(db)
}

// sql.js row shape: column name -> value. BLOBs stay byte arrays internally
// (only Antigravity's gen_metadata reads them, converting back to bytes).
pub fn query(db: &Connection, sql: &str) -> Result<Vec<Map<String, Value>>, String> {
    let mut statement = db.prepare(sql).map_err(|e| format!("SQL_ERROR:{e}"))?;
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|c| c.to_string())
        .collect();
    let mut rows = statement.query([]).map_err(|e| format!("SQL_ERROR:{e}"))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("SQL_ERROR:{e}"))? {
        let mut map = Map::new();
        for (i, column) in columns.iter().enumerate() {
            let value = match row.get_ref(i).map_err(|e| format!("SQL_ERROR:{e}"))? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => serde_json::json!(n),
                rusqlite::types::ValueRef::Real(f) => serde_json::json!(f),
                rusqlite::types::ValueRef::Text(t) => {
                    Value::String(String::from_utf8_lossy(t).to_string())
                }
                rusqlite::types::ValueRef::Blob(b) => {
                    Value::Array(b.iter().map(|byte| serde_json::json!(byte)).collect())
                }
            };
            map.insert(column.clone(), value);
        }
        out.push(map);
    }
    Ok(out)
}

struct Snapshot {
    root: PathBuf,
}

impl Snapshot {
    fn create() -> io::Result<Self> {
        let random: [u8; 16] = rand::random();
        let name: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let root = std::env::temp_dir().join(format!("quotadock-sqlite-{name}"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            fs::DirBuilder::new().mode(0o700).create(&root)?;
        }
        #[cfg(not(unix))]
        fs::create_dir(&root)?;
        Ok(Self { root })
    }

    fn file(&self, name: &str) -> io::Result<File> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(self.root.join(name))
    }
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        for name in ["snapshot.sqlite", "frames.bin"] {
            let _ = fs::remove_file(self.root.join(name));
        }
        let _ = fs::remove_dir(&self.root);
    }
}

fn reparse(meta: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    meta.file_type().is_symlink()
}

fn unchanged(before: &Metadata, after: &Metadata) -> bool {
    before.len() == after.len() && mtime_ms(before) == mtime_ms(after)
}

fn source_error(_: io::Error) -> String {
    "SOURCE_SIZE_OR_LINK".to_owned()
}

fn copy_source(file: &Path, destination: &mut File, audit: &mut Audit) -> Result<u64, String> {
    let stat = fs::symlink_metadata(file).map_err(source_error)?;
    if !stat.is_file() || reparse(&stat) || stat.len() > MAX_FILE {
        return Err("SOURCE_SIZE_OR_LINK".to_owned());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut source = options.open(file).map_err(source_error)?;
    let opened = source.metadata().map_err(source_error)?;
    if !opened.is_file() || reparse(&opened) {
        return Err("SOURCE_SIZE_OR_LINK".to_owned());
    }
    if !unchanged(&stat, &opened) {
        return Err("SOURCE_BUSY".to_owned());
    }
    audit.reads += 1;
    let copied = io::copy(
        &mut Read::by_ref(&mut source).take(stat.len() + 1),
        destination,
    )
    .map_err(source_error)?;
    if copied != stat.len() || !unchanged(&stat, &source.metadata().map_err(source_error)?) {
        return Err("SOURCE_BUSY".to_owned());
    }
    Ok(copied)
}

pub fn read_database<T>(
    file: &str,
    audit: &mut Audit,
    visit: &mut dyn FnMut(&Connection) -> Result<T, String>,
) -> Result<T, String> {
    let before = fs::metadata(file).map_err(|_| "SOURCE_PARSE_FAILED".to_string())?;
    let wal_path = format!("{file}-wal");
    let wal_before = fs::metadata(&wal_path).ok();
    let snapshot = Snapshot::create().map_err(snapshot_error)?;
    let mut image = snapshot.file("snapshot.sqlite").map_err(snapshot_error)?;
    let len = copy_source(Path::new(file), &mut image, audit)?;
    let mut header = [0; 16];
    image.rewind().map_err(snapshot_error)?;
    if len < 16 || image.read_exact(&mut header).is_err() || &header != b"SQLite format 3\0" {
        return Err("DATABASE_FORMAT_UNSUPPORTED".to_string());
    }
    let wal = match &wal_before {
        Some(_) => {
            let mut wal = snapshot.file("frames.bin").map_err(snapshot_error)?;
            let len = copy_source(Path::new(&wal_path), &mut wal, audit)?;
            wal.rewind().map_err(snapshot_error)?;
            Some((wal, len))
        }
        None => None,
    };
    let after = fs::metadata(file).map_err(|_| "SOURCE_BUSY".to_string())?;
    let wal_after = fs::metadata(&wal_path).ok();
    if !unchanged(&before, &after)
        || wal_before.is_some() != wal_after.is_some()
        || match (&wal_before, &wal_after) {
            (Some(b), Some(a)) => !unchanged(b, a),
            _ => false,
        }
    {
        return Err("SOURCE_BUSY".to_string());
    }
    if let Some((mut wal, len)) = wal {
        if let Some(commit) = committed_wal(&mut wal, len)? {
            image.set_len(commit.size()).map_err(snapshot_error)?;
            apply_commit(&mut wal, &mut image, &commit).map_err(snapshot_error)?;
        }
    }
    if image.metadata().map_err(snapshot_error)?.len() >= 20 {
        // Only the isolated copy uses a rollback-mode header. It contains all
        // committed pages and has no associated WAL or SHM.
        image.seek(SeekFrom::Start(18)).map_err(snapshot_error)?;
        image.write_all(&[1, 1]).map_err(snapshot_error)?;
    }
    drop(image);
    let db = Connection::open_with_flags(
        snapshot.root.join("snapshot.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "DATABASE_FORMAT_UNSUPPORTED".to_owned())?;
    db.execute_batch("PRAGMA mmap_size=0; PRAGMA cache_size=-2048; PRAGMA query_only=ON;")
        .map_err(|_| "DATABASE_FORMAT_UNSUPPORTED".to_owned())?;
    visit(&db)
}
