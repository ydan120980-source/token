// No connection to a source database: bytes and committed WAL pages are read
// O_RDONLY; SQLite runs exclusively on an in-memory image. No source shm locks.
use crate::policy::{mtime_ms, read_bytes, Audit};
use rusqlite::Connection;
use serde_json::{Map, Value};
use std::fs;

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

pub fn overlay_wal(main: &[u8], wal: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let wal = match wal {
        Some(wal) if !wal.is_empty() => wal,
        _ => return Ok(main.to_vec()),
    };
    if wal.len() < 32 || ![0x377f0682u32, 0x377f0683].contains(&be32(wal, 0)) {
        return Err("WAL_HEADER_INVALID".to_string());
    }
    let size = be32(wal, 8) as usize;
    let little = be32(wal, 0) == 0x377f0682;
    if size < 512 || size > 65536 || (size & (size - 1)) != 0 {
        return Err("WAL_PAGE_INVALID".to_string());
    }
    let mut sum = checksum(&wal[..24], [0, 0], little);
    if sum[0] != be32(wal, 24) || sum[1] != be32(wal, 28) {
        return Err("WAL_CHECKSUM_INVALID".to_string());
    }
    // Validate once, remember the final commit boundary, then apply only verified
    // committed bytes in a second linear pass.
    let mut committed_end = 0usize;
    let mut pages = 0u32;
    let mut at = 32usize;
    while at + 24 + size <= wal.len() {
        let header = &wal[at..at + 24];
        let payload = &wal[at + 24..at + 24 + size];
        if header[8..16] != wal[16..24] {
            break;
        }
        sum = checksum(&header[..8], sum, little);
        sum = checksum(payload, sum, little);
        if sum[0] != be32(header, 16) || sum[1] != be32(header, 20) {
            break;
        }
        let page = be32(header, 0);
        if page == 0 || page as u64 * size as u64 > 512 * 1024 * 1024 {
            return Err("WAL_SIZE_LIMIT".to_string());
        }
        let commit = be32(header, 4);
        if commit != 0 {
            pages = commit;
            committed_end = at + 24 + size;
        }
        at += 24 + size;
    }
    if pages == 0 {
        return Ok(main.to_vec());
    }
    if pages as u64 * size as u64 > 512 * 1024 * 1024 {
        return Err("WAL_SIZE_LIMIT".to_string());
    }
    let mut image = vec![0u8; pages as usize * size];
    let copy = image.len().min(main.len());
    image[..copy].copy_from_slice(&main[..copy]);
    let mut at = 32usize;
    while at < committed_end {
        let page = be32(wal, at) as usize;
        if page <= pages as usize {
            image[(page - 1) * size..page * size].copy_from_slice(&wal[at + 24..at + 24 + size]);
        }
        at += 24 + size;
    }
    Ok(image)
}

pub fn open_image(image: &[u8]) -> Result<Connection, String> {
    let mut db = Connection::open_in_memory().map_err(|_| "DATABASE_FORMAT_UNSUPPORTED".to_string())?;
    // A committed WAL snapshot still carries WAL-mode header bytes (18/19 = 2);
    // SQLite would then look for a WAL file beside the in-memory image. The
    // image is a consistent read-only snapshot, so present it as rollback mode.
    let mut image = image.to_vec();
    if image.len() >= 20 {
        image[18] = 1;
        image[19] = 1;
    }
    // OwnedData must own sqlite3_malloc'ed bytes; copy the read-only image there.
    unsafe {
        let ptr = rusqlite::ffi::sqlite3_malloc64(image.len() as u64) as *mut u8;
        let ptr = std::ptr::NonNull::new(ptr).ok_or_else(|| "DATABASE_FORMAT_UNSUPPORTED".to_string())?;
        std::ptr::copy_nonoverlapping(image.as_ptr(), ptr.as_ptr(), image.len());
        let data = rusqlite::serialize::OwnedData::from_raw_nonnull(ptr, image.len());
        db.deserialize(rusqlite::DatabaseName::Main, data, true).map_err(|_| "DATABASE_FORMAT_UNSUPPORTED".to_string())?;
    }
    Ok(db)
}

// sql.js row shape: column name -> value. BLOBs stay byte arrays internally
// (only Antigravity's gen_metadata reads them, converting back to bytes).
pub fn query(db: &Connection, sql: &str) -> Result<Vec<Map<String, Value>>, String> {
    let mut statement = db.prepare(sql).map_err(|e| format!("SQL_ERROR:{e}"))?;
    let columns: Vec<String> = statement.column_names().iter().map(|c| c.to_string()).collect();
    let mut rows = statement.query([]).map_err(|e| format!("SQL_ERROR:{e}"))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| format!("SQL_ERROR:{e}"))? {
        let mut map = Map::new();
        for (i, column) in columns.iter().enumerate() {
            let value = match row.get_ref(i).map_err(|e| format!("SQL_ERROR:{e}"))? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(n) => serde_json::json!(n),
                rusqlite::types::ValueRef::Real(f) => serde_json::json!(f),
                rusqlite::types::ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
                rusqlite::types::ValueRef::Blob(b) => Value::Array(b.iter().map(|byte| serde_json::json!(byte)).collect()),
            };
            map.insert(column.clone(), value);
        }
        out.push(map);
    }
    Ok(out)
}

pub fn read_database<T>(file: &str, audit: &mut Audit, visit: &mut dyn FnMut(&Connection) -> Result<T, String>) -> Result<T, String> {
    let before = fs::metadata(file).map_err(|_| "SOURCE_PARSE_FAILED".to_string())?;
    let wal_path = format!("{file}-wal");
    let wal_before = fs::metadata(&wal_path).ok();
    let main = read_bytes(file, audit)?;
    if main.len() < 16 || &main[..16] != b"SQLite format 3\0" {
        return Err("DATABASE_FORMAT_UNSUPPORTED".to_string());
    }
    let wal = match &wal_before {
        Some(_) => Some(read_bytes(&wal_path, audit)?),
        None => None,
    };
    let after = fs::metadata(file).map_err(|_| "SOURCE_BUSY".to_string())?;
    let wal_after = fs::metadata(&wal_path).ok();
    if mtime_ms(&before) != mtime_ms(&after)
        || before.len() != after.len()
        || wal_before.is_some() != wal_after.is_some()
        || match (&wal_before, &wal_after) {
            (Some(b), Some(a)) => b.len() != a.len() || mtime_ms(b) != mtime_ms(a),
            _ => false,
        }
    {
        return Err("SOURCE_BUSY".to_string());
    }
    let image = overlay_wal(&main, wal.as_deref())?;
    let db = open_image(&image)?;
    visit(&db)
}