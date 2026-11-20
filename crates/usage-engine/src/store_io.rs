use crate::js_json::{stringify, write_statistics};
use crate::statistics_io::{read_statistics, DEFAULT_CHUNK_SIZE, DEFAULT_THRESHOLD};
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct Recovery {
    pub file: String,
    pub quarantined: Option<String>,
    pub code: String,
}

pub fn atomic(file: &Path, value: &Value, ledger: bool) -> std::io::Result<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let suffix: String = rand::random::<[u8; 6]>().iter().map(|b| format!("{b:02x}")).collect();
    let mut temporary = file.as_os_str().to_os_string();
    temporary.push(format!(".tmp-{suffix}"));
    let temporary = PathBuf::from(temporary);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut handle = options.open(&temporary)?;

    let result = (|| -> std::io::Result<()> {
        let mut failure: Option<std::io::Error> = None;
        if ledger {
            write_statistics(value, &mut |text| {
                if failure.is_none() {
                    if let Err(e) = handle.write_all(text.as_bytes()) {
                        failure = Some(e);
                    }
                }
            });
            if let Some(e) = failure {
                return Err(e);
            }
        } else {
            handle.write_all(stringify(value).as_bytes())?;
        }
        handle.sync_all()?;
        drop(handle);
        fs::rename(&temporary, file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn quarantine_file(file: &Path, code: &str) -> Recovery {
    let name = file.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let directory = file.parent().unwrap_or(Path::new(".")).join("quarantine");
    let stamp = chrono_now_iso().replace(':', "-");
    let stem = name.strip_suffix(".json").unwrap_or(&name);
    let target = directory.join(format!("{stem}-{stamp}.json"));
    let base = Recovery { file: name.clone(), quarantined: None, code: code.to_string() };
    if fs::create_dir_all(&directory).is_err() {
        return Recovery { code: if code == "INVALID_JSON" { "QUARANTINE_FAILED".to_string() } else { base.code }, ..base };
    }
    match fs::rename(file, &target) {
        Ok(()) => Recovery {
            quarantined: Some(format!("quarantine/{}", target.file_name().unwrap().to_string_lossy())),
            ..base
        },
        Err(_) => Recovery { code: if code == "INVALID_JSON" { "QUARANTINE_FAILED".to_string() } else { base.code }, ..base },
    }
}

fn chrono_now_iso() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    let days = secs / 86400;
    let rem = secs % 86400;
    let (year, month, day) = civil_from_days(days as i64);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

pub fn load(file: &Path, fallback: Value, recovered: Option<&mut Vec<Recovery>>, ledger: bool) -> Result<Value, String> {
    let parsed = if ledger {
        read_statistics(file, DEFAULT_CHUNK_SIZE, DEFAULT_THRESHOLD)
    } else {
        fs::read_to_string(file)
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => "ENOENT".to_string(),
                _ => "LOCAL_STORAGE_INVALID".to_string(),
            })
            .and_then(|text| serde_json::from_str(&text).map_err(|_| "INVALID_JSON".to_string()))
    };
    match parsed {
        Ok(value) => Ok(value),
        Err(code) if code == "ENOENT" => Ok(fallback),
        Err(_) => match recovered {
            Some(list) => {
                list.push(quarantine_file(file, "INVALID_JSON"));
                Ok(fallback)
            }
            None => Err("LOCAL_STORAGE_INVALID".to_string()),
        },
    }
}