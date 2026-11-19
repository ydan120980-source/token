use serde_json::{json, Value};
use usage_engine::js_json::stringify;
use usage_engine::normalize::normalize;
use usage_engine::pricing::{evaluate, lower_bound, price, validate};

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

#[test]
fn evaluate_matrix_matches_reference() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/pricing-expected.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let actual = evaluate(&case["record"], &json!({}), Some(&case["rates"])).to_value();
        assert!(same(&actual, &case["expected"]), "case {} actual {} want {}", stringify(&case["record"]), stringify(&actual), stringify(&case["expected"]));
    }
    for case in fixture["validations"].as_array().unwrap() {
        match validate(&case["entry"]) {
            Ok(value) => assert!(same(&value, &case["ok"]), "validate {}", stringify(&case["entry"])),
            Err(code) => assert_eq!(code, case["error"].as_str().unwrap()),
        }
    }
    for case in fixture["floors"].as_array().unwrap() {
        let actual = lower_bound(&case["record"], &case["rates"]);
        assert!(same(&json!(actual), &case["expected"]));
    }
}

#[test]
fn missing_fields_stay_null_and_unpriced_models_price_null() {
    let info = json!({"time": "2026-10-01T00:00:00Z", "model": "gpt-4.1", "id": "id"});
    let record = normalize(
        "codex",
        &json!({"input_tokens": 100, "output_tokens": 20, "cached_input_tokens": 40, "reasoning_output_tokens": 10, "cache_creation_input_tokens": 0}),
        &info,
        "s",
        "inclusive",
    )
    .unwrap();
    assert_eq!(record["totalTokens"], json!(120));
    assert_eq!(record["inputUncached"], json!(60));
    assert_eq!(record["reasoning"], json!(10));
    let partial = normalize("codex", &json!({"total_tokens": 10}), &info, "s", "inclusive").unwrap();
    assert_eq!(partial["inputUncached"], Value::Null);
    assert_eq!(price(&partial, &json!({})), None);
    assert!(normalize("codex", &json!({"total_tokens": 10}), &json!({"time": null, "model": "gpt-4.1", "id": "id"}), "s", "inclusive").is_none());
    assert_eq!(normalize("codex", &json!({"total_tokens": 10}), &json!({"time": "2026-10-01T00:00:00Z", "model": "email@example.com", "id": "id"}), "s", "inclusive").unwrap()["model"], json!("unknown"));
    assert_eq!(normalize("codex", &json!({"total_tokens": 10}), &json!({"time": "2026-10-01T00:00:00Z", "model": "C:/Users/private", "id": "id"}), "s", "inclusive").unwrap()["model"], json!("unknown"));
    assert!(price(&record, &json!({})).unwrap() > 0.0);
    let mut unknown = record.clone();
    unknown.as_object_mut().unwrap().insert("model".into(), json!("unknown"));
    assert_eq!(price(&unknown, &json!({})), None);
}

#[test]
fn opencode_reasoning_disjoint_and_invalid_cache() {
    let record = normalize(
        "opencode",
        &json!({"input": 100, "output": 10, "reasoning": 5, "cache": {"read": 20, "write": 0}}),
        &json!({"model": "gpt-4.1", "time": "2026-10-01", "id": "a"}),
        "s",
        "exclusive",
    )
    .unwrap();
    assert_eq!(record["output"], json!(15));
    assert_eq!(record["totalTokens"], json!(135));
    assert_eq!(record["reasoning"], json!(5));
    assert_eq!(
        normalize("codex", &json!({"input_tokens": 10, "output_tokens": 1, "cached_input_tokens": 20}), &json!({"time": "2026-10-01"}), "s", "inclusive").unwrap()["quality"],
        json!("invalid-cache")
    );
}