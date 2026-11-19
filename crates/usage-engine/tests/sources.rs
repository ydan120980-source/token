use serde_json::{json, Value};
use usage_engine::batch1_extra as extra;
use usage_engine::batch1_sources as batch1;
use usage_engine::extended_sources as extended;
use usage_engine::js_json::stringify;
use usage_engine::parsed::Parsed;
use usage_engine::pathx as path;
use usage_engine::sources::parse_objects;

fn canon(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for key in keys {
                out.insert(key.clone(), canon(&map[key]));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(canon).collect()),
        other => other.clone(),
    }
}

fn same(a: &Value, b: &Value) -> bool {
    stringify(&canon(a)) == stringify(&canon(b))
}

fn packed(parsed: &Parsed) -> Value {
    json!({"records": parsed.records, "warnings": parsed.warnings, "sessions": parsed.sessions})
}

#[test]
fn parser_matrix_matches_js_reference() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/sources-expected.json")).unwrap();
    let salt = fixture["salt"].as_str().unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let kind = case["kind"].as_str().unwrap();
        let empty = Vec::new();
        let objects = case.get("objects").and_then(|v| v.as_array()).unwrap_or(&empty);
        let rows = case.get("rows").and_then(|v| v.as_array()).unwrap_or(&empty);
        let file = case.get("file").and_then(|v| v.as_str()).unwrap_or("");
        let actual = match kind {
            "objects" => parse_objects(case["agent"].as_str().unwrap(), objects, salt, case["fallback"].as_str().unwrap()),
            "gemini" => extended::gemini(objects, salt, case["fallback"].as_str().unwrap()),
            "cursor" => extended::cursor(objects, salt),
            "csv" => extended::cursor_csv(case["text"].as_str().unwrap(), salt).unwrap(),
            "deepseek" => extended::deepseek(objects, salt, file).unwrap(),
            "zcode" => extended::zcode(rows, salt),
            "batch1" => batch1::parse(case["agent"].as_str().unwrap(), objects, salt, file),
            "intervals" => batch1::copilot_intervals(case["records"].as_array().unwrap()),
            "extra" => match case["agent"].as_str().unwrap() {
                "qwen" => extra::qwen(objects, salt),
                "kilo" => extra::kilo(objects, salt),
                "kimi" => extra::kimi(objects, salt, file),
                "continue" => extra::continue_rows(rows, salt),
                other => panic!("unknown extra agent {other}"),
            },
            other => panic!("unknown kind {other}"),
        };
        assert!(same(&packed(&actual), &case["expected"]), "case {name}\nactual {}\nwant {}", stringify(&packed(&actual)), stringify(&case["expected"]));
    }
}

#[test]
fn csv_identity_and_generation_match_js() {
    let record = json!({"timestamp": "2026-10-05T12:00:00.000Z", "model": "gpt-4.1", "inputUncached": 90, "output": 20, "cacheRead": 10, "cacheWrite": 5});
    assert_eq!(extended::csv_identity(&record), stringify(&json!(["2026-10-05T12:00:00.000Z", "gpt-4.1", 90, 20, 10, 5])));
    assert_eq!(extended::generation("E:/x/session.v3.jsonl.zstd"), Some(3));
    assert_eq!(extended::generation("E:/x/session.jsonl"), Some(0));
    assert_eq!(extended::generation("E:/x/other.jsonl"), None);
    let files = vec![
        "E:/x/a/session.jsonl".to_string(),
        "E:/x/a/session.v2.jsonl".to_string(),
        "E:/x/b/session.v2.jsonl".to_string(),
        "E:/x/b/session.v2.jsonl.zstd".to_string(),
    ];
    assert_eq!(extended::canonical_files(&files), vec!["E:/x/a/session.v2.jsonl".to_string(), "E:/x/b/session.v2.jsonl".to_string(), "E:/x/b/session.v2.jsonl.zstd".to_string()]);
    let _ = path::basename("x");
}

#[test]
fn deepseek_incomplete_frame_marks_partial() {
    // A truncated zstd frame reports DEEPSEEK_LOG_INCOMPLETE through the callback.
    let mut called = false;
    let bytes = [0x28u8, 0xb5, 0x2f, 0xfd, 0x00, 0x00, 0x09, 0x00, 0x00];
    let result = extended::decode_deepseek(&bytes, true, &mut || called = true);
    assert!(result.is_ok());
    assert!(called);
}