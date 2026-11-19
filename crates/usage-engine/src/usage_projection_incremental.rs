use crate::aggregate::add;
use crate::js_json::stringify;
use crate::source_registry::revision;
use crate::time::iso_from_ms;
use crate::usage_math::local_day;
use crate::usage_projection::{finish_row, Calendar, ProjectionOptions};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

pub struct Prior<'a> {
    pub state: &'a Value,
    pub snapshot: &'a Value,
    pub current_records: &'a Value,
    pub current_duplicates: &'a Value,
}

// G9: JS compares record object identity (WeakMap/===); Rust Values compare
// structurally. Value-equal rows project identically, so outputs stay exact.
pub fn project_incremental(options: &ProjectionOptions, prior: Option<&Prior>) -> Option<Value> {
    let prior = prior?;
    let previous = prior.snapshot;
    let state = prior.state;
    if previous.is_null() || state.is_null() {
        return None;
    }
    if previous.get("timezone").and_then(|v| v.as_str()) != Some(options.timezone)
        || previous.get("today").and_then(|v| v.as_str()) != Some(local_day(options.timezone, options.now_ms).as_str())
        || stringify(previous.get("priceCatalog").unwrap_or(&Value::Null)) != stringify(options.price_catalog)
    {
        return None;
    }
    let mut identities: HashMap<String, HashMap<String, HashMap<String, HashMap<String, usize>>>> = HashMap::new();
    let mut identity_count = 0usize;
    let mut identity = |row: &Value| -> usize {
        let agent = row.get("agent").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let entry = row.get("entry").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let provider = row.get("provider").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let model = row.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let agent_map = identities.entry(agent).or_default();
        let entry_map = agent_map.entry(entry).or_default();
        let provider_map = entry_map.entry(provider).or_default();
        if !provider_map.contains_key(&model) {
            provider_map.insert(model.clone(), identity_count);
            identity_count += 1;
        }
        provider_map[&model]
    };
    let valid_identity = |row: &Value| {
        ["agent", "entry", "provider", "model"].iter().all(|field| row.get(*field).map(|v| v.is_string()).unwrap_or(false))
    };
    let mut calendar = Calendar::new(options.timezone);
    let keys = |calendar: &mut Calendar, row: &Value, identity: &mut dyn FnMut(&Value) -> usize| -> (String, String) {
        let (date, hour) = calendar.at(row.get("timestamp").and_then(|v| v.as_str()).unwrap_or(""));
        let id = identity(row);
        (format!("{date}/{id}"), format!("{date}/{hour}/{id}"))
    };
    let state_records = state.get("records").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let state_duplicates = state.get("duplicateIds").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let mut days: HashSet<String> = HashSet::new();
    let mut hours: HashSet<String> = HashSet::new();
    let mut changed = 0usize;
    for record in options.records {
        let id = record.get("id").and_then(|v| v.as_str())?;
        if !valid_identity(record) {
            return None;
        }
        if state_records.get(id) != Some(record) || state_duplicates.get(id).map(crate::normalize::truthy).unwrap_or(false) {
            let (d, h) = keys(&mut calendar, record, &mut identity);
            days.insert(d);
            hours.insert(h);
            changed += 1;
            if changed > 4096 {
                return None;
            }
        }
    }
    for record in state_records.values() {
        let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let referenced = prior.current_records.get(id) == Some(record)
            && !prior.current_duplicates.get(id).map(crate::normalize::truthy).unwrap_or(false);
        if !state_duplicates.get(id).map(crate::normalize::truthy).unwrap_or(false) && !referenced {
            if !valid_identity(record) {
                return None;
            }
            let (d, h) = keys(&mut calendar, record, &mut identity);
            days.insert(d);
            hours.insert(h);
            changed += 1;
            if changed > 8192 {
                return None;
            }
        }
    }
    let key_of = |row: &Value, hourly: bool, identity: &mut dyn FnMut(&Value) -> usize| -> String {
        let id = identity(row);
        let date = row.get("date").and_then(|v| v.as_str()).unwrap_or("");
        if hourly {
            format!("{date}/{}/{id}", row.get("hour").and_then(|v| v.as_f64()).unwrap_or(0.0))
        } else {
            format!("{date}/{id}")
        }
    };
    let old_days: HashMap<String, Value> = previous
        .get("daily")
        .and_then(|v| v.as_array())
        .map(|rows| rows.iter().map(|row| (key_of(row, false, &mut identity), row.clone())).collect())
        .unwrap_or_default();
    let old_hours: HashMap<String, Value> = previous
        .get("hourly")
        .and_then(|v| v.as_array())
        .map(|rows| rows.iter().map(|row| (key_of(row, true, &mut identity), row.clone())).collect())
        .unwrap_or_default();
    let mut daily: Map<String, Value> = Map::new();
    let mut hourly: Map<String, Value> = Map::new();
    for record in options.records {
        let (date, hour) = calendar.at(record.get("timestamp").and_then(|v| v.as_str()).unwrap_or(""));
        let id = identity(record);
        let d = format!("{date}/{id}");
        let h = format!("{date}/{hour}/{id}");
        let d_changed = days.contains(&d);
        let h_changed = hours.contains(&h);
        let valuation = if d_changed || h_changed { Some((options.estimate)(record)) } else { None };
        if d_changed {
            let estimate = valuation.as_ref().unwrap();
            add(&mut daily, &d, &json!({"date": date}), record, &estimate.eval, &estimate.parts, estimate.savings, estimate.lower_bound);
        } else if !daily.contains_key(&d) {
            daily.insert(d.clone(), old_days.get(&d)?.clone());
        }
        if h_changed {
            let estimate = valuation.as_ref().unwrap();
            add(&mut hourly, &h, &json!({"date": date, "hour": hour}), record, &estimate.eval, &estimate.parts, estimate.savings, estimate.lower_bound);
        } else if !hourly.contains_key(&h) {
            hourly.insert(h.clone(), old_hours.get(&h)?.clone());
        }
    }
    for (group, row) in daily.iter_mut() {
        if days.contains(group) {
            finish_row(row);
        }
    }
    for (group, row) in hourly.iter_mut() {
        if hours.contains(group) {
            finish_row(row);
        }
    }
    let mut daily_rows: Vec<Value> = daily.values().cloned().collect();
    daily_rows.sort_by(|a, b| a["date"].as_str().unwrap_or("").cmp(b["date"].as_str().unwrap_or("")));
    let mut hour_rows: Vec<Value> = hourly.values().cloned().collect();
    hour_rows.sort_by(|a, b| {
        a["date"].as_str().unwrap_or("").cmp(b["date"].as_str().unwrap_or("")).then(a["hour"].as_f64().unwrap_or(0.0).total_cmp(&b["hour"].as_f64().unwrap_or(0.0)))
    });
    let sources: Vec<Value> = options
        .source_catalog
        .as_object()
        .map(|catalog| {
            catalog
                .keys()
                .map(|agent| {
                    options.statuses.get(agent).cloned().unwrap_or_else(|| {
                        json!({
                            "agent": agent,
                            "label": catalog.get(agent).and_then(|m| m.get("label")),
                            "status": "unverified",
                            "lastSuccess": null,
                            "realSampleVerified": false
                        })
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let mut out = previous.as_object().cloned().unwrap_or_default();
    out.insert("sequence".into(), json!(options.sequence));
    out.insert("collectedAt".into(), json!(options.updated_at));
    out.insert("generatedAt".into(), json!(iso_from_ms(options.now_ms)));
    out.insert("daily".into(), json!(daily_rows));
    out.insert("hourly".into(), json!(hour_rows));
    out.insert("coverageStart".into(), json!(daily_rows.first().and_then(|r| r.get("date")).cloned()));
    out.insert("sourceCatalog".into(), options.source_catalog.clone());
    out.insert("catalogRevision".into(), json!(revision(options.source_catalog)));
    out.insert("priceCatalog".into(), options.price_catalog.clone());
    out.insert("sources".into(), json!(sources));
    out.insert("recovered".into(), json!(options.recovered.iter().cloned().collect::<Vec<_>>()));
    Some(Value::Object(out))
}