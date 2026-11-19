use serde_json::{json, Map, Value};
use usage_engine::aggregate::add;
use usage_engine::js_json::stringify;
use usage_engine::pricing::Eval;
use usage_engine::usage_math::hour_of;
use usage_engine::usage_projection::{day, project_usage, FullEstimate, ProjectionOptions};
use usage_engine::usage_projection_incremental::{project_incremental, Prior};

fn estimate(record: &Value) -> FullEstimate {
    let total = record["totalTokens"].as_i64().unwrap();
    let priced = total % 2 == 1;
    FullEstimate {
        eval: Eval {
            reason: if priced { "exact".into() } else { "model-unpriced".into() },
            lower: if priced { Some(0.2) } else { None },
            upper: Some(0.3),
            cause: Some("missing-inputUncached".into()),
        },
        parts: [0.1, 0.1, 0.0, 0.0],
        savings: 0.0,
        lower_bound: false,
    }
}

fn record(i: usize) -> Value {
    json!({
        "id": format!("synthetic-{i}"), "agent": "codex", "entry": "cli", "provider": "synthetic", "model": format!("model-{}", i % 5),
        "timestamp": format!("2026-10-{:02}T{:02}:30:00Z", 24 + i % 3, i % 6),
        "totalTokens": 100 + i as i64, "inputUncached": if i % 5 != 0 { json!(80) } else { Value::Null },
        "output": 20, "cacheRead": if i % 4 != 0 { json!(0) } else { Value::Null }, "cacheWrite": 0, "reasoning": 0,
        "quality": if i % 5 != 0 { "measured" } else { "partial" }, "usageConflict": i % 7 == 0
    })
}

fn state_with(records: Vec<Value>, duplicates: Map<String, Value>) -> Value {
    let mut map = Map::new();
    for record in records {
        map.insert(record["id"].as_str().unwrap().to_string(), record);
    }
    json!({"sequence": 1, "records": map, "duplicateIds": duplicates})
}

fn options<'a>(state: &'a Value, records: &'a [Value], statuses: &'a Value, timezone: &'a str, now_ms: i64, price_catalog: &'a Value, sequence: i64) -> ProjectionOptions<'a> {
    let _ = state;
    ProjectionOptions {
        records,
        estimate: &estimate,
        sequence,
        updated_at: None,
        device_id: "synthetic",
        source_catalog: catalog(),
        price_catalog,
        statuses,
        recovered: &[],
        timezone,
        now_ms,
    }
}

fn catalog() -> &'static Value {
    static CATALOG: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    CATALOG.get_or_init(|| json!({"codex": {"label": "Codex"}}))
}

fn active_records(state: &Value) -> Vec<Value> {
    let duplicates = state["duplicateIds"].as_object().unwrap();
    state["records"].as_object().unwrap().values().filter(|r| !duplicates.contains_key(r["id"].as_str().unwrap())).cloned().collect()
}

fn canon(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = Map::new();
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
fn shared_single_hour_accumulators_match_independent_aggregation() {
    let records: Vec<Value> = (0..24)
        .map(|i| {
            json!({
                "agent": "codex", "entry": "cli", "provider": "synthetic", "model": if i % 3 != 0 { "mixed-hours" } else { "one-hour" },
                "timestamp": if i % 3 != 0 { format!("2026-10-25T{:02}:30:00Z", if i % 2 != 0 { 1 } else { 4 }) } else { "2026-10-25T02:30:00Z".to_string() },
                "totalTokens": 100 + i as i64, "inputUncached": if i % 5 != 0 { json!(80) } else { Value::Null },
                "output": 20, "cacheRead": if i % 4 != 0 { json!(0) } else { Value::Null }, "cacheWrite": 0, "reasoning": 0,
                "quality": if i % 5 != 0 { "measured" } else { "partial" }, "usageConflict": i % 7 == 0
            })
        })
        .collect();
    let now = usage_engine::time::parse_iso("2026-10-30T12:00:00Z").unwrap();
    for timezone in ["UTC", "Europe/Berlin", "Asia/Kolkata", "Australia/Lord_Howe"] {
        let mut orders: Vec<Vec<Value>> = vec![records.clone(), records.iter().rev().cloned().collect()];
        let mut sorted = records.clone();
        sorted.sort_by_key(|r| r["totalTokens"].as_i64().unwrap() % 5);
        orders.push(sorted);
        for list in orders {
            let mut groups: Map<String, Value> = Map::new();
            let mut hours: Map<String, Value> = Map::new();
            for r in &list {
                let date = day(r["timestamp"].as_str().unwrap(), timezone);
                let hour = hour_of(timezone, usage_engine::time::parse_iso(r["timestamp"].as_str().unwrap()).unwrap());
                let identity = json!([r["agent"], r["entry"], r["provider"], r["model"]]);
                let e = estimate(r);
                add(&mut groups, &stringify(&json!([date, identity[0], identity[1], identity[2], identity[3]])), &json!({"date": date}), r, &e.eval, &e.parts, e.savings, e.lower_bound);
                add(&mut hours, &stringify(&json!([date, hour, identity[0], identity[1], identity[2], identity[3]])), &json!({"date": date, "hour": hour}), r, &e.eval, &e.parts, e.savings, e.lower_bound);
            }
            let finish = |rows: Vec<Value>| -> Vec<Value> {
                rows.into_iter()
                    .map(|mut row| {
                        if row["pricedRecords"].as_f64().unwrap_or(0.0) == 0.0 {
                            for field in ["estimatedCostUsd", "estimatedCostUpperUsd", "costParts", "cacheSavingsUsd"] {
                                row.as_object_mut().unwrap().insert(field.into(), Value::Null);
                            }
                        }
                        row
                    })
                    .collect()
            };
            let price_catalog = json!({"version": "synthetic"});
            let statuses = json!({});
            let actual = project_usage(&options(&json!({}), &list, &statuses, timezone, now, &price_catalog, 1));
            let mut want_daily: Vec<Value> = groups.values().cloned().collect();
            want_daily.sort_by(|a, b| a["date"].as_str().unwrap().cmp(b["date"].as_str().unwrap()));
            let mut want_hourly: Vec<Value> = hours.values().cloned().collect();
            want_hourly.sort_by(|a, b| a["date"].as_str().unwrap().cmp(b["date"].as_str().unwrap()).then(a["hour"].as_i64().unwrap().cmp(&b["hour"].as_i64().unwrap())));
            let strip = |rows: &Value| -> Value {
                Value::Array(rows.as_array().unwrap().iter().map(|row| {
                    let mut map = row.as_object().unwrap().clone();
                    map.remove("semantics");
                    Value::Object(map)
                }).collect())
            };
            assert!(same(&strip(&actual["daily"]), &json!(finish(want_daily))), "daily {timezone}");
            assert!(same(&strip(&actual["hourly"]), &json!(finish(want_hourly))), "hourly {timezone}");
            assert!(actual["daily"].as_array().unwrap().iter().all(|row| row.get("hour").is_none()));
            assert!(list[0].get("semantics").is_none());
        }
    }
}

#[test]
fn incremental_matches_full_for_additions_replacements_removals_duplicates() {
    let now = usage_engine::time::parse_iso("2026-10-30T12:00:00Z").unwrap();
    let records: Vec<Value> = (0..200).map(record).collect();
    let state = state_with(records, Map::new());
    let price_catalog = json!({"version": "synthetic"});
    let statuses = json!({});
    let active = active_records(&state);
    let before = project_usage(&options(&state, &active, &statuses, "Europe/Berlin", now, &price_catalog, 1));
    let copy = stringify(&before);
    let mut revisions: Vec<Value> = Vec::new();
    let mut added = state.clone();
    added["records"].as_object_mut().unwrap().insert("synthetic-201".into(), record(201));
    added["sequence"] = json!(2);
    revisions.push(added);
    let mut replaced = state.clone();
    let mut changed = record(2);
    changed.as_object_mut().unwrap().insert("model".into(), json!("changed-model"));
    changed.as_object_mut().unwrap().insert("inputUncached".into(), Value::Null);
    changed.as_object_mut().unwrap().insert("totalTokens".into(), json!(600));
    changed.as_object_mut().unwrap().insert("quality".into(), json!("partial"));
    replaced["records"].as_object_mut().unwrap().insert("synthetic-2".into(), changed);
    replaced["sequence"] = json!(2);
    revisions.push(replaced);
    let mut removed = state.clone();
    removed["records"] = json!(state["records"].as_object().unwrap().iter().filter(|(_, r)| r["model"] != json!("model-2")).map(|(k, v)| (k.clone(), v.clone())).collect::<Map<String, Value>>());
    removed["sequence"] = json!(2);
    revisions.push(removed);
    let mut duplicated = state.clone();
    duplicated["duplicateIds"] = json!({"synthetic-2": "synthetic-1"});
    duplicated["sequence"] = json!(2);
    revisions.push(duplicated);
    let mut same_state = state.clone();
    same_state["sequence"] = json!(2);
    revisions.push(same_state);
    for next in revisions {
        let next_records = active_records(&next);
        let next_statuses = json!({"codex": {"agent": "codex", "status": "partial", "errors": ["SOURCE_UNREADABLE"]}});
        let input = options(&next, &next_records, &next_statuses, "Europe/Berlin", now, &price_catalog, next["sequence"].as_i64().unwrap());
        let prior = Prior { state: &state, snapshot: &before, current_records: &next["records"], current_duplicates: &next["duplicateIds"] };
        let actual = project_incremental(&input, Some(&prior)).expect("incremental must apply");
        assert!(same(&actual, &project_usage(&input)), "revision {}", next["sequence"]);
        assert!(actual["daily"].as_array().unwrap().iter().any(|row| before["daily"].as_array().unwrap().contains(row)), "unaffected rows reused");
        assert_eq!(stringify(&before), copy);
    }
    let mut hidden = state.clone();
    hidden["duplicateIds"] = json!({"synthetic-2": "synthetic-1"});
    let hidden_records = active_records(&hidden);
    let previous = project_usage(&options(&hidden, &hidden_records, &statuses, "Europe/Berlin", now, &price_catalog, 1));
    let visible_records = active_records(&state);
    let prior = Prior { state: &hidden, snapshot: &previous, current_records: &state["records"], current_duplicates: &json!({}) };
    let actual = project_incremental(&options(&state, &visible_records, &statuses, "Europe/Berlin", now, &price_catalog, 1), Some(&prior)).unwrap();
    assert!(same(&actual, &before));
}

#[test]
fn incremental_falls_back_for_pricing_day_timezone_and_bulk() {
    let now = usage_engine::time::parse_iso("2026-10-30T12:00:00Z").unwrap();
    let records = vec![record(1)];
    let state = state_with(records.clone(), Map::new());
    let price_catalog = json!({"version": "synthetic"});
    let statuses = json!({});
    let base = options(&state, &records, &statuses, "Europe/Berlin", now, &price_catalog, 1);
    let snapshot = project_usage(&base);
    let prior = Prior { state: &state, snapshot: &snapshot, current_records: &state["records"], current_duplicates: &json!({}) };
    let repriced = json!({"version": "reprice"});
    assert!(project_incremental(&options(&state, &records, &statuses, "Europe/Berlin", now, &repriced, 1), Some(&prior)).is_none());
    assert!(project_incremental(&options(&state, &records, &statuses, "Asia/Kolkata", now, &price_catalog, 1), Some(&prior)).is_none());
    assert!(project_incremental(&options(&state, &records, &statuses, "Europe/Berlin", now + 86_400_000, &price_catalog, 1), Some(&prior)).is_none());
    assert!(project_incremental(&base, None).is_none());
    let bulk_records: Vec<Value> = (0..4100).map(record).collect();
    let bulk = state_with(bulk_records.clone(), Map::new());
    let bulk_prior = Prior { state: &state, snapshot: &snapshot, current_records: &bulk["records"], current_duplicates: &json!({}) };
    assert!(project_incremental(&options(&bulk, &bulk_records, &statuses, "Europe/Berlin", now, &price_catalog, 1), Some(&bulk_prior)).is_none());
}