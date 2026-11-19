// Full-chain parity: scans and the persistent ledger reach the reference
// snapshot-selection result in every file, Agent and scan order. Port of
// tests/m1/snapshot-order.test.js test 3 (previously deferred to this slice).
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use usage_engine::js_json::stringify;
use usage_engine::normalize::normalize;
use usage_engine::policy::{self, Audit};
use usage_engine::sources::{scan_sources, ScanOptions};
use usage_engine::store::Store;
use usage_engine::usage_snapshot::CONFLICT;

fn truthy(value: Option<&Value>) -> bool {
    value.map(usage_engine::normalize::truthy).unwrap_or(false)
}

const TIME: &str = "2026-10-05T12:00:00Z";
const FIELDS: [&str; 5] = ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning"];

fn obs(name: &str) -> Value {
    match name {
        "A120" => json!({"input": 100, "output": 20, "reasoning": 0}),
        "B120" => json!({"input": 90, "output": 30, "reasoning": 0}),
        "C120" => json!({"input": 100, "output": 20}),
        "D140" => json!({"input": 100, "output": 40, "reasoning": 0}),
        "F160" => json!({"input": 100, "output": 60}),
        "G140" => json!({"input": 90, "output": 50, "reasoning": 0}),
        "X140" => json!({"input": 100, "output": 40, "reasoning": 0, "total": 150}),
        _ => panic!("unknown observation {name}"),
    }
}

fn record(name: &str) -> Value {
    let mut usage = obs(name).as_object().cloned().unwrap();
    usage.insert("cache".into(), json!({"read": 0, "write": 0}));
    normalize("opencode", &Value::Object(usage), &json!({"id": "same", "session": "s", "model": "gpt-4.1", "time": TIME}), "salt", "exclusive").unwrap()
}

fn rank(r: &Value) -> i32 {
    let quality = r.get("measurementQuality").filter(|v| usage_engine::normalize::truthy(v)).or_else(|| r.get("quality")).and_then(|v| v.as_str()).unwrap_or("");
    match quality {
        "measured" => 2,
        "partial" => 1,
        _ => 0,
    }
}

fn known(r: &Value) -> usize {
    FIELDS.iter().filter(|f| r.get(**f).and_then(|v| v.as_f64()).map(|v| v.is_finite()).unwrap_or(false)).count()
}

fn disagree(a: &Value, b: &Value) -> bool {
    rank(a) > 0 && rank(b) > 0 && FIELDS.iter().any(|f| {
        let x = a.get(*f).and_then(|v| v.as_f64());
        let y = b.get(*f).and_then(|v| v.as_f64());
        matches!((x, y), (Some(x), Some(y)) if x != y)
    })
}

fn view(r: &Value) -> Value {
    if truthy(r.get("usageConflict")) {
        json!({"total": r["totalTokens"], "conflict": true})
    } else {
        let mut out = json!({"total": r["totalTokens"], "quality": r["quality"], "model": r["model"]});
        for field in FIELDS {
            out[field] = r.get(field).cloned().unwrap_or(Value::Null);
        }
        out
    }
}

fn expected(records: &[Value]) -> Value {
    let valid: Vec<&Value> = records.iter().filter(|r| rank(r) > 0).collect();
    let pool: Vec<&Value> = if valid.is_empty() { records.iter().collect() } else { valid };
    let total = pool.iter().map(|r| r["totalTokens"].as_i64().unwrap()).max().unwrap();
    let top: Vec<&Value> = pool.into_iter().filter(|r| r["totalTokens"].as_i64() == Some(total)).collect();
    if top.iter().any(|r| truthy(r.get("usageConflict"))) || top.iter().any(|a| top.iter().any(|b| disagree(a, b))) {
        return json!({"total": total, "conflict": true});
    }
    let score = |r: &Value| (rank(r), known(r), if r["model"] == json!("unknown") { 0 } else { 1 });
    let best = top.into_iter().reduce(|best, r| if score(r) > score(best) { r } else { best }).unwrap();
    view(best)
}

fn same(a: &Value, b: &Value) -> bool {
    stringify(a) == stringify(b)
}

fn permutations(items: &[&'static str]) -> Vec<Vec<&'static str>> {
    if items.len() < 2 {
        return vec![items.to_vec()];
    }
    let mut out = Vec::new();
    for (i, x) in items.iter().enumerate() {
        let rest: Vec<&'static str> = items[..i].iter().chain(items[i + 1..].iter()).copied().collect();
        for p in permutations(&rest) {
            let mut next = vec![*x];
            next.extend(p);
            out.push(next);
        }
    }
    out
}

fn pairs(names: &[&'static str]) -> Vec<Vec<&'static str>> {
    let mut out = Vec::new();
    for i in 0..names.len() {
        for j in i + 1..names.len() {
            out.push(vec![names[i], names[j]]);
        }
    }
    out
}

fn message(name: &str) -> Value {
    let mut tokens = obs(name).as_object().cloned().unwrap();
    tokens.insert("cache".into(), json!({"read": 0, "write": 0}));
    json!({"role": "assistant", "id": "same", "modelID": "gpt-4.1", "providerID": "openai",
        "time": {"created": usage_engine::time::parse_iso(TIME).unwrap()}, "tokens": tokens})
}

fn write(selected: &Value, opencode: &[&str], mimo: &[&str]) {
    let root = selected["opencode"][0].as_str().unwrap();
    let folder = format!("{root}\\storage\\message");
    let _ = fs::remove_dir_all(&folder);
    for (i, name) in opencode.iter().enumerate() {
        fs::create_dir_all(&folder).unwrap();
        fs::write(format!("{folder}\\f{i}.json"), stringify(&message(name))).unwrap();
    }
    let root = selected["mimo"][0].as_str().unwrap();
    let file = format!("{root}\\mimocode.db");
    let _ = fs::remove_file(&file);
    if !mimo.is_empty() {
        fs::create_dir_all(root).unwrap();
        let db = rusqlite::Connection::open(&file).unwrap();
        db.execute_batch("CREATE TABLE message(id TEXT, session_id TEXT, data TEXT)").unwrap();
        for name in mimo {
            db.execute("INSERT INTO message VALUES(?1, ?2, ?3)", rusqlite::params!["same", "s", stringify(&message(name))]).unwrap();
        }
    }
}

fn workspace(tag: &str) -> String {
    let dir = std::env::temp_dir().join(format!("store-chain-{tag}-{}-{}", std::process::id(), usage_engine::time::now_ms()));
    fs::create_dir_all(&dir).unwrap();
    dir.to_string_lossy().to_string()
}

fn day_total(store: &mut Store) -> Value {
    let snapshot = store.snapshot().unwrap();
    let daily = snapshot["daily"].as_array().unwrap();
    assert_eq!(daily.len(), 1);
    daily[0].clone()
}

#[test]
fn scans_and_ledger_reach_reference_in_every_order() {
    let names: Vec<&'static str> = vec!["A120", "B120", "C120", "D140", "F160", "G140", "X140"];
    let triples: Vec<Vec<&'static str>> = vec![
        vec!["A120", "B120", "D140"],
        vec!["A120", "B120", "F160"],
        vec!["B120", "C120", "A120"],
        vec!["D140", "G140", "F160"],
        vec!["A120", "F160", "G140"],
        vec!["X140", "A120", "F160"],
        vec!["C120", "X140", "D140"],
    ];
    let price = json!({"provider": "openai", "model": "gpt-4.1", "inputUncached": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0});
    let mut sets = pairs(&names);
    sets.extend(triples);
    for (s, set) in sets.iter().enumerate() {
        let want = expected(&set.iter().map(|name| record(name)).collect::<Vec<_>>());
        let dir = workspace(&format!("set{s}"));
        let selected = policy::roots(&format!("{dir}\\home"), &HashMap::new());
        let app = format!("{dir}\\app");
        let mut store = Store::new(&app, &selected).unwrap();
        store.set_price(&price, false).unwrap();
        for (n, order) in permutations(set).iter().enumerate() {
            for (opencode, mimo) in [
                (order.clone(), Vec::new()),
                (order[..1].to_vec(), order[1..].to_vec()),
                (order[1..].to_vec(), order[..1].to_vec()),
            ] {
                write(&selected, &opencode, &mimo);
                let scan = scan_sources(&selected, "salt", &mut Audit::new(), ScanOptions { cache: None, prepared: None });
                let mut records = scan["opencode"].records.clone();
                records.extend(scan["mimo"].records.clone());
                assert_eq!(records.len(), 1, "scan {} | {}", opencode.join(","), mimo.join(","));
                assert!(same(&view(&records[0]), &want), "scan {} | {}\nactual {}\nwant {}", opencode.join(","), mimo.join(","), stringify(&view(&records[0])), stringify(&want));
                if truthy(records[0].get("usageConflict")) {
                    assert!(scan["opencode"].errors.iter().any(|e| e == CONFLICT) || scan["mimo"].errors.iter().any(|e| e == CONFLICT));
                }
            }
            store.clear().unwrap();
            for (i, name) in order.iter().enumerate() {
                let agent = if i % 2 == 1 { "mimo" } else { "opencode" };
                let opencode: Vec<&str> = if agent == "opencode" { vec![*name] } else { Vec::new() };
                let mimo: Vec<&str> = if agent == "mimo" { vec![*name] } else { Vec::new() };
                write(&selected, &opencode, &mimo);
                let scan = scan_sources(&selected, "salt", &mut Audit::new(), ScanOptions { cache: None, prepared: None });
                store.ingest(&scan, &json!({"status": "passed"})).unwrap();
            }
            if n == 0 {
                store = Store::new(&app, &selected).unwrap();
            }
            let label = format!("ledger {}", order.join(" > "));
            let records = store.records();
            assert_eq!(records.len(), 1, "{label}");
            assert_eq!(records[0]["agent"], json!("opencode"), "{label}");
            let row = day_total(&mut store);
            assert_eq!(row["totalTokens"].as_f64(), want["total"].as_f64(), "{label}");
            assert_eq!(truthy(records[0].get("usageConflict")), truthy(want.get("conflict")), "{label}");
            let cost = if truthy(want.get("conflict")) || want["quality"] != json!("measured") {
                None
            } else {
                Some((want["inputUncached"].as_f64().unwrap() + 2.0 * want["output"].as_f64().unwrap()) / 1e6)
            };
            match cost {
                None => assert_eq!(row["estimatedCostUsd"], Value::Null, "{label}"),
                Some(value) => assert!((row["estimatedCostUsd"].as_f64().unwrap() - value).abs() < 1e-12, "{label}"),
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }
}

#[test]
fn wal_overlay_reads_committed_pages_and_rejects_damage() {
    let dir = workspace("wal");
    let live = format!("{dir}\\live.db");
    {
        let db = rusqlite::Connection::open(&live).unwrap();
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE t(x INTEGER); INSERT INTO t VALUES(1),(2),(3);").unwrap();
        // Copy the main image and its WAL while the connection still owns them.
        fs::copy(&live, format!("{dir}\\copy.db")).unwrap();
        fs::copy(format!("{live}-wal"), format!("{dir}\\copy.db-wal")).unwrap();
    }
    let mut audit = Audit::new();
    let rows = usage_engine::sqlite_memory::read_database(&format!("{dir}\\copy.db"), &mut audit, &mut |db| usage_engine::sqlite_memory::query(db, "SELECT x FROM t ORDER BY x")).unwrap();
    let values: Vec<i64> = rows.iter().map(|r| r["x"].as_i64().unwrap()).collect();
    assert_eq!(values, vec![1, 2, 3]);
    // A main image without the WAL still reads (the copy holds committed pages
    // only when the WAL carried them; here at least the schema must survive).
    let bad = format!("{dir}\\bad.db");
    fs::write(&bad, b"not a database at all").unwrap();
    let error = usage_engine::sqlite_memory::read_database(&bad, &mut audit, &mut |_| Ok(())).unwrap_err();
    assert_eq!(error, "DATABASE_FORMAT_UNSUPPORTED");
    let empty: Vec<u8> = Vec::new();
    assert_eq!(usage_engine::sqlite_memory::overlay_wal(b"main", Some(&empty)).unwrap(), b"main");
    let mut header = vec![0u8; 32];
    header[..4].copy_from_slice(&0x12345678u32.to_be_bytes());
    assert_eq!(usage_engine::sqlite_memory::overlay_wal(b"main", Some(&header)).unwrap_err(), "WAL_HEADER_INVALID");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn policy_rejects_unsafe_paths_and_lists_only_allowed_files() {
    assert_eq!(policy::local_path("relative/path").unwrap_err(), "SOURCE_PATH_REJECTED");
    assert_eq!(policy::local_path("\\\\server\\share").unwrap_err(), "SOURCE_PATH_REJECTED");
    assert!(policy::local_path("E:/home/.codex/auth.json").is_err());
    assert!(policy::local_path("E:/home/.codex/config.toml").is_err());
    assert!(policy::local_path("E:/home/.codex/sessions").is_ok());
    assert!(policy::allowed_file("opencode", "E:/x/storage/message/a.json"));
    assert!(!policy::allowed_file("opencode", "E:/x/storage/other/a.json"));
    assert!(policy::allowed_file("codex", "E:/x/sessions/a.jsonl"));
    assert!(!policy::allowed_file("codex", "E:/x/sessions/auth.jsonl"));
    assert!(!policy::allowed_file("codex", "E:/x/sessions/tokens.jsonl"));
    let dir = workspace("policy");
    let root = format!("{dir}\\home\\.local\\share\\opencode");
    fs::create_dir_all(format!("{root}\\storage\\message")).unwrap();
    fs::write(format!("{root}\\storage\\message\\a.json"), "{}").unwrap();
    fs::create_dir_all(format!("{root}\\auth")).unwrap();
    fs::write(format!("{root}\\auth\\b.json"), "{}").unwrap();
    fs::write(format!("{root}\\storage\\message\\credentials.json"), "{}").unwrap();
    let listed = policy::files_under("opencode", &root, &mut Audit::new(), None).unwrap();
    assert_eq!(listed.files.len(), 1);
    assert!(listed.files[0].ends_with("a.json"));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn startup_quarantines_a_damaged_ledger_and_keeps_preferences() {
    let dir = workspace("startup");
    let app = format!("{dir}\\app");
    fs::create_dir_all(&app).unwrap();
    fs::write(format!("{app}\\statistics.json"), "{damaged").unwrap();
    fs::write(format!("{app}\\preferences.json"), stringify(&json!({"enabled": false}))).unwrap();
    let selected = policy::roots(&format!("{dir}\\home"), &HashMap::new());
    let store = Store::new(&app, &selected).unwrap();
    assert_eq!(store.recovered.len(), 1);
    assert_eq!(store.recovered[0].code, "INVALID_JSON");
    assert!(store.recovered[0].quarantined.as_deref().unwrap().starts_with("quarantine/"));
    assert_eq!(store.state["version"], json!(1));
    assert_eq!(store.settings["enabled"], json!(false));
    assert!(Path::new(&app).join("quarantine").exists());
    // A restart reads the rewritten ledger without new recoveries.
    let again = Store::new(&app, &selected).unwrap();
    assert!(again.recovered.is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn ingest_skips_rewrite_when_the_ledger_is_unchanged() {
    let dir = workspace("stable");
    let selected = policy::roots(&format!("{dir}\\home"), &HashMap::new());
    let app = format!("{dir}\\app");
    let mut store = Store::new(&app, &selected).unwrap();
    write(&selected, &["A120"], &[]);
    let scan = scan_sources(&selected, "salt", &mut Audit::new(), ScanOptions { cache: None, prepared: None });
    let first = store.ingest(&scan, &json!({"status": "passed"})).unwrap();
    let sequence = first["sequence"].as_i64().unwrap();
    let again = store.ingest(&scan, &json!({"status": "passed"})).unwrap();
    assert_eq!(again["sequence"].as_i64().unwrap(), sequence);
    assert_eq!(store.state["sequence"].as_i64().unwrap(), sequence);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn custom_source_saved_state_validation() {
    use usage_engine::jsonl_adapter::{definition, valid_saved};
    assert!(valid_saved(None));
    assert!(!valid_saved(Some(&json!([]))));
    let config = json!({"schemaVersion": "CustomSourceV1", "name": "demo", "template": "claude", "mode": "per-request"});
    let def = definition(&config).unwrap();
    assert_eq!(def["name"], json!("demo"));
    assert!(definition(&json!({"schemaVersion": "CustomSourceV1", "name": "demo", "template": "claude", "mode": "counter"})).is_err());
    let id = "custom-01234567-89ab-cdef-0123-456789abcdef";
    let source = json!({"id": id, "name": "demo", "definition": config, "version": 1, "enabled": true, "archived": false,
        "roots": [format!("{}\\custom", workspace("custom-valid"))], "files": {}});
    assert!(valid_saved(Some(&json!({ id: source }))));
    let mut bad = source.clone();
    bad["version"] = json!(0);
    assert!(!valid_saved(Some(&json!({ id: bad }))));
}

#[test]
fn session_metadata_and_resume_commands() {
    use usage_engine::sessions::{directory, observe, project_name, resume_command, title};
    assert_eq!(directory(Some(&json!("E:/work/demo"))).as_deref(), Some("E:/work/demo"));
    assert_eq!(directory(Some(&json!("//server/share"))), None);
    assert_eq!(directory(Some(&json!("relative"))), None);
    assert_eq!(title(Some(&json!("  a\n b  "))).as_deref(), Some("a b"));
    assert_eq!(title(Some(&json!("x".repeat(200)))).unwrap().chars().count(), 120);
    let meta = observe("codex", Some(&json!("s-1")), Some(&json!("E:/work/demo")), "salt", None).unwrap();
    assert_eq!(resume_command("codex", Some(&meta)).unwrap(), "Set-Location -LiteralPath 'E:/work/demo'; codex resume s-1");
    assert_eq!(resume_command("unknown-agent", Some(&meta)), None);
    assert_eq!(project_name(Some("E:/work/demo")).as_deref(), Some("demo"));
    let quoted = json!({"id": "s-1", "cwd": "E:/it's a 'test'"});
    assert!(resume_command("codex", Some(&quoted)).unwrap().contains("'E:/it''s a ''test'''"));
}