use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use usage_engine::js_json::stringify;
use usage_engine::statistics_io::read_statistics;
use usage_engine::store_io::{atomic, load, quarantine_file};

fn temp_root(tag: &str) -> PathBuf {
    let suffix: String = rand::random::<[u8; 6]>().iter().map(|b| format!("{b:02x}")).collect();
    let root = std::env::temp_dir().join(format!("usage-engine-{tag}-{suffix}"));
    fs::create_dir_all(&root).unwrap();
    root
}

fn ledger_value(count: usize) -> Value {
    let mut records = serde_json::Map::new();
    for i in 0..count {
        records.insert(
            format!("r{i}"),
            json!({"model": "中文🙂", "text": "\\\"\n{}", "nullable": null, "nested": [0, null, {"x": true}], "unknownSavedField": i}),
        );
    }
    json!({"version": 1, "sequence": 5, "records": records, "statuses": {"codex": {"lastSuccess": null}}})
}

#[test]
fn small_file_round_trip() {
    let root = temp_root("small");
    let file = root.join("statistics.json");
    let value = ledger_value(50);
    atomic(&file, &value, true).unwrap();
    assert_eq!(fs::read_to_string(&file).unwrap(), stringify(&value));
    assert_eq!(read_statistics(&file, 65536, 4 * 1024 * 1024).unwrap(), value);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn streaming_path_matches_full_parse() {
    let root = temp_root("stream");
    let file = root.join("statistics.json");
    let value = ledger_value(10000);
    atomic(&file, &value, true).unwrap();
    // Force the entry-by-entry scanner with a low threshold.
    assert_eq!(read_statistics(&file, 65536, 1024).unwrap(), value);
    // And a chunk size that splits multi-byte characters mid-token.
    assert_eq!(read_statistics(&file, 7, 1024).unwrap(), value);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn chunk_size_validation() {
    let root = temp_root("chunk");
    let file = root.join("x.json");
    fs::write(&file, "{}").unwrap();
    assert_eq!(read_statistics(&file, 0, 1024).unwrap_err(), "INVALID_JSON_CHUNK_SIZE");
    assert_eq!(read_statistics(&file, 1_048_577, 1024).unwrap_err(), "INVALID_JSON_CHUNK_SIZE");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn trailing_garbage_rejected() {
    let root = temp_root("garbage");
    let file = root.join("x.json");
    fs::write(&file, "{\"a\":1} x").unwrap();
    assert_eq!(read_statistics(&file, 65536, 1).unwrap_err(), "INVALID_SAVED_JSON");
    fs::write(&file, "{\"a\":}").unwrap();
    assert_eq!(read_statistics(&file, 65536, 1).unwrap_err(), "INVALID_SAVED_JSON");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn atomic_failure_keeps_previous_bytes_and_removes_temp() {
    let root = temp_root("atomic");
    let file = root.join("statistics.json");
    atomic(&file, &json!({"before": true}), false).unwrap();
    // A directory cannot be replaced by a file rename: the write must fail cleanly.
    let blocked = root.join("blocked");
    fs::create_dir(&blocked).unwrap();
    assert!(atomic(&blocked, &ledger_value(3000), true).is_err());
    let leftovers: Vec<_> = fs::read_dir(&root).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    assert!(!leftovers.iter().any(|n| n.contains(".tmp-")), "temp files left: {leftovers:?}");
    assert_eq!(fs::read_to_string(&file).unwrap(), stringify(&json!({"before": true})));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn load_quarantines_corrupt_files() {
    let root = temp_root("quarantine");
    let file = root.join("preferences.json");
    fs::write(&file, "{not json").unwrap();
    let mut recovered = Vec::new();
    let fallback = json!({"enabled": true});
    let value = load(&file, fallback.clone(), Some(&mut recovered), false).unwrap();
    assert_eq!(value, fallback);
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].file, "preferences.json");
    assert!(recovered[0].quarantined.as_deref().unwrap().starts_with("quarantine/preferences-"));
    assert!(!file.exists());
    assert!(root.join("quarantine").read_dir().unwrap().count() == 1);

    let missing = root.join("absent.json");
    assert_eq!(load(&missing, fallback.clone(), None, false).unwrap(), fallback);

    fs::write(&file, "{bad").unwrap();
    assert_eq!(load(&file, fallback, None, false).unwrap_err(), "LOCAL_STORAGE_INVALID");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn quarantine_failure_reports_code() {
    let root = temp_root("qfail");
    let file = root.join("missing.json");
    let recovery = quarantine_file(&file, "INVALID_JSON");
    assert_eq!(recovery.code, "QUARANTINE_FAILED");
    assert_eq!(recovery.quarantined, None);
    fs::remove_dir_all(&root).unwrap();
}