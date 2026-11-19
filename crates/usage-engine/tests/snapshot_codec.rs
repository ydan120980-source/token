use serde_json::{json, Value};
use usage_engine::js_json::stringify;
use usage_engine::local_snapshot::select_snapshot;
use usage_engine::snapshot_codec::{pack, unpack};
use usage_engine::snapshot_delta::snapshot_delta;

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

fn wire(value: &Value) -> Value {
    serde_json::from_str(&stringify(value)).unwrap()
}

fn base_row() -> Value {
    json!({
        "date": "2026-10-22", "agent": "codex", "entry": "cli", "provider": "openai", "model": "synthetic",
        "totalTokens": 100, "inputUncached": null, "output": 0, "cacheRead": null, "cacheWrite": 0, "reasoning": null,
        "knownUsage": {"output": 0}, "knownRecords": {"output": 1},
        "pricingReasons": {"usage-incomplete": 1}, "unpricedTokens": {"usage-incomplete": 100},
        "incompleteTokens": {"missing-inputUncached": 100}, "costParts": null
    })
}

#[test]
fn columnar_transport_preserves_values_and_shrinks_bytes() {
    let snapshot = json!({
        "schemaVersion": "LocalUsagePreviewV1", "sequence": 1,
        "daily": (0..100).map(|_| base_row()).collect::<Vec<_>>(),
        "hourly": [json!({"hour": 0, "date": "2026-10-22", "agent": "codex", "entry": "cli", "provider": "openai", "model": "synthetic", "totalTokens": 100, "inputUncached": null, "output": 0, "cacheRead": null, "cacheWrite": 0, "reasoning": null, "knownUsage": {"output": 0}, "knownRecords": {"output": 1}, "pricingReasons": {"usage-incomplete": 1}, "unpricedTokens": {"usage-incomplete": 100}, "incompleteTokens": {"missing-inputUncached": 100}, "costParts": null})],
        "sources": []
    });
    let original = stringify(&snapshot);
    let packed = pack(&snapshot);
    let encoded = stringify(&packed);
    let restored = unpack(&wire(&packed), None, None).unwrap();
    assert!(same(&restored, &snapshot));
    assert!(encoded.len() < original.len() / 2);
    let row = &restored["daily"][0];
    assert_eq!(row["inputUncached"], Value::Null);
    assert_eq!(row["output"], json!(0));
    assert_eq!(row["costParts"], Value::Null);
    let empty = unpack(&wire(&pack(&json!({"schemaVersion": "LocalUsagePreviewV1", "sequence": 1, "daily": [], "hourly": [], "sources": []}))), None, None).unwrap();
    assert_eq!(empty["daily"], json!([]));
    assert!(unpack(&json!({"codec": "unknown"}), None, None).unwrap_err().contains("INVALID_USAGE_TRANSPORT"));
}

#[test]
fn bounded_map_dictionaries_and_legacy_vectors() {
    let daily: Vec<Value> = (0..300)
        .map(|i| {
            json!({
                "knownUsage": if i % 3 == 0 { Value::Null } else if i % 3 == 1 { json!({}) } else { json!({"output": 0}) },
                "costParts": {"output": i},
                "pricingReasons": {"exact": 1}
            })
        })
        .collect();
    let snapshot = json!({"daily": daily, "hourly": []});
    let packed = pack(&snapshot);
    let columns = packed["daily"]["columns"].as_array().unwrap();
    let layouts = packed["daily"]["layouts"].as_array().unwrap();
    let at = |name: &str| layouts[columns.iter().position(|c| c == name).unwrap()].clone();
    assert_eq!(at("knownUsage")["values"].as_array().unwrap().len(), 2);
    assert!(at("costParts").get("values").is_none());
    assert!(same(&unpack(&wire(&packed), None, None).unwrap(), &snapshot));

    let mut legacy = packed.clone();
    let rows = legacy["daily"]["rows"].as_array_mut().unwrap();
    for (i, layout) in layouts.iter().enumerate() {
        if layout.get("kind").and_then(|k| k.as_str()) == Some("map") && layout.get("values").is_some() {
            for row in rows.iter_mut() {
                let cell = &mut row.as_array_mut().unwrap()[i];
                if !cell.is_null() {
                    *cell = layout["values"][cell.as_u64().unwrap() as usize].clone();
                }
            }
        }
    }
    for layout in legacy["daily"]["layouts"].as_array_mut().unwrap() {
        if layout.get("kind").and_then(|k| k.as_str()) == Some("map") {
            layout.as_object_mut().unwrap().remove("values");
        }
    }
    assert!(same(&unpack(&legacy, None, None).unwrap(), &snapshot));

    let repeated = json!({"daily": (0..10000).map(|_| json!({"knownUsage": {"output": 0}, "pricingReasons": {"exact": 1}, "costParts": null})).collect::<Vec<_>>(), "hourly": []});
    let compact = stringify(&pack(&repeated));
    let mut legacy_repeat = pack(&repeated);
    let layouts_snapshot = legacy_repeat["daily"]["layouts"].as_array().unwrap().clone();
    let rows = legacy_repeat["daily"]["rows"].as_array_mut().unwrap();
    for (i, layout) in layouts_snapshot.iter().enumerate() {
        if layout.get("kind").and_then(|k| k.as_str()) == Some("map") && layout.get("values").is_some() {
            for row in rows.iter_mut() {
                let cell = &mut row.as_array_mut().unwrap()[i];
                if !cell.is_null() {
                    *cell = layout["values"][cell.as_u64().unwrap() as usize].clone();
                }
            }
        }
    }
    for layout in legacy_repeat["daily"]["layouts"].as_array_mut().unwrap() {
        if layout.get("kind").and_then(|k| k.as_str()) == Some("map") {
            layout.as_object_mut().unwrap().remove("values");
        }
    }
    assert!(compact.len() < (stringify(&legacy_repeat).len() as f64 * 0.8) as usize);
}

fn delta_fixture() -> (Value, Value) {
    let row = json!({
        "date": "2026-10-30", "agent": "codex", "entry": "cli", "provider": "synthetic", "model": "a",
        "totalTokens": 100, "records": 1, "pricedTokens": 0, "inputUncached": null, "output": 0,
        "cacheRead": null, "cacheWrite": 0, "reasoning": null,
        "pricingReasons": {"model-unpriced": 1}, "privateField": "PRIVATE_SENTINEL"
    });
    let mut row_b = row.clone();
    row_b.as_object_mut().unwrap().insert("model".into(), json!("b"));
    let mut hourly = row.clone();
    hourly.as_object_mut().unwrap().insert("hour".into(), json!(0));
    let previous = json!({"schemaVersion": "UsageSnapshotV1", "sequence": 1, "today": "2026-10-30", "daily": [row, row_b], "hourly": [hourly], "sources": []});
    let mut new_row = previous["daily"][0].clone();
    new_row.as_object_mut().unwrap().insert("totalTokens".into(), json!(200));
    let mut hourly2 = previous["hourly"][0].clone();
    hourly2.as_object_mut().unwrap().insert("hour".into(), json!(2));
    let next = json!({"schemaVersion": "UsageSnapshotV1", "sequence": 2, "today": "2026-10-30", "daily": [previous["daily"][1], new_row], "hourly": [previous["hourly"][0], hourly2], "sources": []});
    (previous, next)
}

#[test]
fn revision_delta_preserves_whitelist_order_and_nulls() {
    let (previous, next) = delta_fixture();
    let base = unpack(&wire(&pack(&select_snapshot(&previous, None).unwrap())), None, None).unwrap();
    let delta = snapshot_delta(Some(&previous), &next, 1, None).unwrap().unwrap();
    assert!(!stringify(&delta).contains("PRIVATE_SENTINEL"));
    let restored = unpack(&wire(&delta), Some(&base), Some(1)).unwrap();
    assert!(same(&restored, &select_snapshot(&next, None).unwrap()));
    assert_eq!(restored["daily"][0], base["daily"][1]);
    assert_eq!(restored["hourly"][0], base["hourly"][0]);
    assert_eq!(restored["daily"][1]["inputUncached"], Value::Null);
    assert_eq!(restored["daily"][1]["output"], json!(0));
    assert!(unpack(&delta, Some(&base), Some(0)).unwrap_err().contains("BASE_MISMATCH"));
    assert!(unpack(&delta, None, None).unwrap_err().contains("BASE_MISMATCH"));
    for index in [json!(2), json!(-3), json!(0.5)] {
        let mut bad = delta.clone();
        bad.as_object_mut().unwrap().insert("dailyOrder".into(), json!([index]));
        assert!(unpack(&bad, Some(&base), Some(1)).unwrap_err().contains("INVALID_USAGE_TRANSPORT"));
    }
    let mut emptied = next.clone();
    emptied.as_object_mut().unwrap().insert("daily".into(), json!([]));
    emptied.as_object_mut().unwrap().insert("hourly".into(), json!([]));
    let empty_delta = snapshot_delta(Some(&previous), &emptied, 1, None).unwrap().unwrap();
    assert!(same(&unpack(&empty_delta, Some(&base), Some(1)).unwrap(), &select_snapshot(&emptied, None).unwrap()));
    let mut bulk = next.clone();
    bulk.as_object_mut().unwrap().insert("daily".into(), json!((0..4100).map(|_| next["daily"][1].clone()).collect::<Vec<_>>()));
    assert!(snapshot_delta(Some(&previous), &bulk, 1, None).unwrap().is_none());
    let mut negative = next.clone();
    let mut bad_row = next["daily"][1].clone();
    bad_row.as_object_mut().unwrap().insert("totalTokens".into(), json!(-1));
    negative.as_object_mut().unwrap().insert("daily".into(), json!([bad_row]));
    assert!(snapshot_delta(Some(&previous), &negative, 1, None).unwrap_err().contains("INVALID_STATISTIC"));
}