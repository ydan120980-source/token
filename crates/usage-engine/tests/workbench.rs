// Workbench parity against the JS reference. Views depend on the real current
// day, so the committed generator runs in the same test invocation and both
// sides read the same invented home. sourceRows[].lastSuccess is masked because
// it holds each side's own ingest wall-clock time.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use usage_engine::collate;
use usage_engine::js_json::stringify;
use usage_engine::jsonl_adapter::{self, Outcome};
use usage_engine::policy::{self, Audit};
use usage_engine::sources::{scan_sources, ScanOptions};
use usage_engine::store::Store;
use usage_engine::workbench;

fn workspace(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("workbench-{tag}-{}-{}", std::process::id(), usage_engine::time::now_ms()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn copy_dir(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let target = dst.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn mask(view: &mut Value) {
    if let Some(rows) = view.get_mut("sources").and_then(|v| v.as_array_mut()) {
        for row in rows {
            row["lastSuccess"] = Value::Null;
        }
    }
}

fn first_diff(actual: &Value, want: &Value, path: &str) -> Option<String> {
    if stringify(actual) == stringify(want) {
        return None;
    }
    match (actual, want) {
        (Value::Object(a), Value::Object(b)) => {
            for (key, value) in a {
                match b.get(key) {
                    None => return Some(format!("{path}.{key}: extra in actual")),
                    Some(other) => {
                        if let Some(diff) = first_diff(value, other, &format!("{path}.{key}")) {
                            return Some(diff);
                        }
                    }
                }
            }
            for key in b.keys() {
                if !a.contains_key(key) {
                    return Some(format!("{path}.{key}: missing in actual"));
                }
            }
            Some(format!("{path}: key order differs"))
        }
        (Value::Array(a), Value::Array(b)) => {
            for (i, (value, other)) in a.iter().zip(b.iter()).enumerate() {
                if let Some(diff) = first_diff(value, other, &format!("{path}[{i}]")) {
                    return Some(diff);
                }
            }
            Some(format!("{path}: length {} vs {}", a.len(), b.len()))
        }
        _ => Some(format!("{path}: want {} got {}", stringify(want), stringify(actual))),
    }
}

fn check(name: &str, actual: &Value, want: &Value) {
    if let Some(diff) = first_diff(actual, want, name) {
        panic!("{name} diverges: {diff}");
    }
}

fn error_of<T>(result: Result<T, String>) -> Value {
    match result {
        Ok(_) => json!({"ok": true}),
        Err(error) => json!({"ok": false, "error": error}),
    }
}

#[test]
fn workbench_views_match_js_reference() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").canonicalize().unwrap();
    let root_text = root.to_string_lossy().trim_start_matches("\\\\?\\").to_string();
    let dir = workspace("parity");
    let gen = dir.join("gen");
    let generator = Path::new(&root_text).join("crates/usage-engine/tests/fixtures/workbench-gen.cjs");
    let status = Command::new("node").arg(&generator).arg(&root_text).arg(&gen).status().unwrap();
    assert!(status.success(), "fixture generator failed");
    let expected: Value = serde_json::from_str(&fs::read_to_string(gen.join("expected.json")).unwrap()).unwrap();

    let collation = &expected["units"]["collation"];
    let mut names: Vec<String> = collation["names"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    names.sort_by(|a, b| collate::compare(a, b));
    let want: Vec<String> = collation["sorted"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    assert_eq!(names, want, "collation order");
    for pair in collation["pairs"].as_array().unwrap() {
        let got = collate::compare(pair["a"].as_str().unwrap(), pair["b"].as_str().unwrap()) as i32;
        let want = pair["cmp"].as_i64().unwrap().signum() as i32;
        assert_eq!(got.signum(), want, "collation {:?} vs {:?}", pair["a"], pair["b"]);
    }

    let home = dir.join("home");
    copy_dir(&gen.join("home"), &home);
    let home_text = home.to_string_lossy().to_string();
    let selected = policy::roots(&home_text, &HashMap::new());
    let app = dir.join("app");
    fs::create_dir_all(&app).unwrap();
    let salt = expected["salt"].as_str().unwrap();
    fs::write(app.join("statistics.json"), stringify(&json!({"version": 1, "deviceId": expected["deviceId"], "salt": salt, "sequence": 0, "records": {}, "statuses": {}}))).unwrap();
    fs::write(app.join("workbench.json"), stringify(&expected["seedWorkbench"])).unwrap();
    let mut store = Store::new(&app.to_string_lossy(), &selected).unwrap();
    store.set_price(&json!({"provider": "openai", "model": "gpt-4.1", "inputUncached": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75}), false).unwrap();
    let scan = scan_sources(&selected, salt, &mut Audit::new(), ScanOptions { cache: None, prepared: None });
    store.ingest(&scan, &json!({"status": "passed"})).unwrap();
    let mut custom_source = expected["customSource"].clone();
    custom_source["roots"] = json!([home.join("custom-outside").to_string_lossy()]);
    let custom_id = custom_source["id"].as_str().unwrap().to_string();
    let record = match jsonl_adapter::parse(&expected["customEvent"], &json!({"id": custom_id, "definition": custom_source["definition"]}), salt) {
        Outcome::Record(record) => record,
        _ => panic!("custom fixture record did not parse"),
    };
    store.commit_custom(&custom_source, &[record]).unwrap();
    let alpha_id = expected["alphaId"].as_str().unwrap();
    store.save_workbench(&json!({"kind": "budget", "project": "all", "period": "monthly", "limitUsd": 0.000001})).unwrap();
    store.save_workbench(&json!({"kind": "budget", "project": alpha_id, "period": "total", "limitUsd": 1000000})).unwrap();
    store.save_workbench(&json!({"kind": "budget", "project": "unknown", "period": "total", "limitUsd": 5})).unwrap();

    let selections = [
        ("monthly", json!({})),
        ("total", json!({"period": "total"})),
        ("daily", json!({"period": "daily"})),
        ("weekly", json!({"period": "weekly"})),
        ("alphaTotal", json!({"project": alpha_id, "period": "total"})),
        ("unknownMonthly", json!({"project": "unknown"})),
    ];
    for (name, selection) in selections {
        let mut view = store.workbench(&selection).unwrap();
        mask(&mut view);
        check(name, &view, &expected["views"][name]);
    }
    let monthly = store.workbench(&json!({})).unwrap();
    let total = store.workbench(&json!({"period": "total"})).unwrap();
    assert_eq!(workbench::csv(&monthly), expected["views"]["csvMonthly"].as_str().unwrap());
    assert_eq!(workbench::csv(&total), expected["views"]["csvTotal"].as_str().unwrap());

    let target = &expected["ackTarget"];
    let acknowledge = |store: &mut Store, id: &str, fingerprint: &str, acknowledged: bool, project: &str, period: &str| {
        let mut view = store.save_workbench(&json!({"kind": "acknowledge", "id": id, "fingerprint": fingerprint, "acknowledged": acknowledged, "project": project, "period": period})).unwrap();
        mask(&mut view);
        view
    };
    let view = acknowledge(&mut store, target["id"].as_str().unwrap(), target["fingerprint"].as_str().unwrap(), true, "all", "monthly");
    check("ackOn", &view, &expected["views"]["ackOn"]);
    let view = acknowledge(&mut store, target["id"].as_str().unwrap(), target["fingerprint"].as_str().unwrap(), false, "all", "monthly");
    check("ackOff", &view, &expected["views"]["ackOff"]);
    let overview_issue = |code: &str| -> (String, String) {
        let issue = expected["views"]["monthly"]["budgetOverview"]["issues"].as_array().unwrap().iter().find(|i| i["code"] == json!(code)).unwrap();
        (issue["id"].as_str().unwrap().to_string(), issue["fingerprint"].as_str().unwrap().to_string())
    };
    let (id, fingerprint) = overview_issue("BUDGET_EXCEEDED");
    let view = acknowledge(&mut store, &id, &fingerprint, true, "all", "monthly");
    check("ackBudget", &view, &expected["views"]["ackBudget"]);
    let (id, fingerprint) = overview_issue("BUDGET_SCOPE_MISSING");
    let missing_scope = expected["missingScope"].as_str().unwrap();
    let view = acknowledge(&mut store, &id, &fingerprint, true, missing_scope, "daily");
    check("ackScopeMissing", &view, &expected["views"]["ackScopeMissing"]);
    let mut view = store.save_workbench(&json!({"kind": "budget", "project": "all", "period": "monthly", "limitUsd": null})).unwrap();
    mask(&mut view);
    check("budgetDeleted", &view, &expected["views"]["budgetDeleted"]);

    let cases = [
        ("scopeInvalid", error_of(store.save_workbench(&json!({"kind": "budget", "project": "c".repeat(64), "period": "monthly", "limitUsd": 5})))),
        ("stale", error_of(store.save_workbench(&json!({"kind": "acknowledge", "id": "0".repeat(64), "fingerprint": "0".repeat(64), "acknowledged": true, "project": "all", "period": "monthly"})))),
        ("requestInvalid", error_of(store.workbench(&json!({"project": "bad!"})))),
        ("settingInvalid", error_of(store.save_workbench(&json!({"kind": "other"})))),
        ("budgetKeyInvalid", error_of(store.save_workbench(&json!({"kind": "budget", "project": "all", "period": "monthly", "limitUsd": 5, "extra": true})))),
    ];
    for (name, got) in cases {
        check(name, &got, &expected["errors"][name]);
    }

    drop(store);
    let mut reopened = Store::new(&app.to_string_lossy(), &selected).unwrap();
    let mut view = reopened.workbench(&json!({"period": "total"})).unwrap();
    mask(&mut view);
    check("reopened", &view, &expected["views"]["reopened"]);

    let today = expected["units"]["today"].as_str().unwrap();
    for case in expected["units"]["range"].as_array().unwrap() {
        check("range", &workbench::range(today, case["period"].as_str().unwrap()), &case["span"]);
    }
    for case in expected["units"]["budget"].as_array().unwrap() {
        let limit = case["limit"].as_f64();
        check("budget", &workbench::budget(&case["total"], limit), &case["result"]);
    }
    for case in expected["units"]["settings"].as_array().unwrap() {
        check("settings", &error_of(workbench::settings(&case["value"])), &case["result"]);
    }
    for case in expected["units"]["request"].as_array().unwrap() {
        check("request", &error_of(workbench::request(&case["value"])), &case["result"]);
    }
}