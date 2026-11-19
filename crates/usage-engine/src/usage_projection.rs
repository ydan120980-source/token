use crate::aggregate::{add, MAP_FIELDS};
use crate::js_json::stringify;
use crate::pricing::Eval;
use crate::source_registry::revision;
use crate::time::{iso_from_ms, parse_iso};
use crate::usage_math::{hour_of, local_day};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub struct FullEstimate {
    pub eval: Eval,
    pub parts: [f64; 4],
    pub savings: f64,
    pub lower_bound: bool,
}

pub fn semantics() -> Value {
    json!({"inputUncached": "excludes-cache", "reasoning": "subset-of-output", "totalTokens": "non-overlapping-source-total"})
}

#[derive(Clone)]
pub struct Calendar {
    timezone: String,
    cache: HashMap<String, (String, u32)>,
}

impl Calendar {
    pub fn new(timezone: &str) -> Self {
        Calendar { timezone: timezone.to_string(), cache: HashMap::new() }
    }

    pub fn at(&mut self, timestamp: &str) -> (String, u32) {
        if let Some(cached) = self.cache.get(timestamp) {
            return cached.clone();
        }
        let ms = parse_iso(timestamp).unwrap_or(0);
        let stamp = (local_day(&self.timezone, ms), hour_of(&self.timezone, ms));
        if self.cache.len() < 4096 {
            self.cache.insert(timestamp.to_string(), stamp.clone());
        }
        stamp
    }

    pub fn cached_date(&self, timestamp: &str) -> Option<String> {
        self.cache.get(timestamp).map(|(date, _)| date.clone())
    }

    pub fn timezone(&self) -> &str {
        &self.timezone
    }
}

pub fn day(timestamp: &str, timezone: &str) -> String {
    local_day(timezone, parse_iso(timestamp).unwrap_or(0))
}

pub struct ProjectionOptions<'a> {
    pub records: &'a [Value],
    pub estimate: &'a dyn Fn(&Value) -> FullEstimate,
    pub sequence: i64,
    pub updated_at: Option<&'a str>,
    pub device_id: &'a str,
    pub source_catalog: &'a Value,
    pub price_catalog: &'a Value,
    pub statuses: &'a Value,
    pub recovered: &'a [Value],
    pub timezone: &'a str,
    pub now_ms: i64,
}

pub fn finish_row(row: &mut Value) {
    let object = row.as_object_mut().unwrap();
    if object.get("pricedRecords").and_then(|v| v.as_f64()).unwrap_or(0.0) == 0.0 {
        for field in ["estimatedCostUsd", "estimatedCostUpperUsd", "costParts", "cacheSavingsUsd"] {
            object.insert(field.into(), Value::Null);
        }
    }
    object.insert("semantics".into(), semantics());
}

pub fn project_usage(options: &ProjectionOptions) -> Value {
    let mut calendar = Calendar::new(options.timezone);
    project_usage_with_calendar(options, &mut calendar)
}

pub fn project_usage_with_calendar(options: &ProjectionOptions, calendar: &mut Calendar) -> Value {
    let today = local_day(options.timezone, options.now_ms);
    let mut groups: Map<String, Value> = Map::new();
    let mut hour_groups: Map<String, Value> = Map::new();
    let mut single_hours: HashMap<String, u32> = HashMap::new();
    for record in options.records {
        let (date, hour) = calendar.at(record.get("timestamp").and_then(|v| v.as_str()).unwrap_or(""));
        let estimate = (options.estimate)(record);
        let identity = json!([record.get("agent"), record.get("entry"), record.get("provider"), record.get("model")]);
        let daily_key = stringify(&json!([date, identity[0], identity[1], identity[2], identity[3]]));
        let hour_key = stringify(&json!([date, hour, identity[0], identity[1], identity[2], identity[3]]));
        add(&mut hour_groups, &hour_key, &json!({"date": date, "hour": hour}), record, &estimate.eval, &estimate.parts, estimate.savings, estimate.lower_bound);
        if !groups.contains_key(&daily_key) {
            groups.insert(daily_key.clone(), hour_groups.get(&hour_key).unwrap().clone());
            single_hours.insert(daily_key, hour);
        } else if !single_hours.contains_key(&daily_key) {
            add(&mut groups, &daily_key, &json!({"date": date}), record, &estimate.eval, &estimate.parts, estimate.savings, estimate.lower_bound);
        } else if single_hours.get(&daily_key) != Some(&hour) {
            let previous = groups.get(&daily_key).unwrap().clone();
            let mut daily = previous.as_object().cloned().unwrap_or_default();
            daily.remove("hour");
            for field in MAP_FIELDS {
                if let Some(value) = previous.get(field).and_then(|v| v.as_object()) {
                    daily.insert(field.into(), Value::Object(value.clone()));
                }
            }
            groups.insert(daily_key.clone(), Value::Object(daily));
            single_hours.remove(&daily_key);
            add(&mut groups, &daily_key, &json!({"date": date}), record, &estimate.eval, &estimate.parts, estimate.savings, estimate.lower_bound);
        } else {
            groups.insert(daily_key.clone(), hour_groups.get(&hour_key).unwrap().clone());
        }
    }
    let mut daily: Vec<Value> = groups
        .values()
        .map(|row| {
            let mut value = row.as_object().cloned().unwrap_or_default();
            value.remove("hour");
            Value::Object(value)
        })
        .collect();
    daily.sort_by(|a, b| a["date"].as_str().unwrap_or("").cmp(b["date"].as_str().unwrap_or("")));
    let mut hourly: Vec<Value> = hour_groups.values().cloned().collect();
    hourly.sort_by(|a, b| {
        a["date"].as_str().unwrap_or("").cmp(b["date"].as_str().unwrap_or("")).then(a["hour"].as_f64().unwrap_or(0.0).total_cmp(&b["hour"].as_f64().unwrap_or(0.0)))
    });
    for row in daily.iter_mut().chain(hourly.iter_mut()) {
        finish_row(row);
    }
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
    let mut out = Map::new();
    out.insert("schemaVersion".into(), json!("UsageSnapshotV1"));
    out.insert("deviceId".into(), json!(options.device_id));
    out.insert("sequence".into(), json!(options.sequence));
    out.insert("collectedAt".into(), json!(options.updated_at));
    out.insert("generatedAt".into(), json!(iso_from_ms(options.now_ms)));
    out.insert("timezone".into(), json!(options.timezone));
    out.insert("today".into(), json!(today));
    out.insert("coverageStart".into(), json!(daily.first().and_then(|r| r.get("date")).cloned()));
    out.insert("daily".into(), json!(daily));
    out.insert("hourly".into(), json!(hourly));
    out.insert("priceCatalog".into(), options.price_catalog.clone());
    out.insert("sourceCatalog".into(), options.source_catalog.clone());
    out.insert("catalogRevision".into(), json!(revision(options.source_catalog)));
    out.insert("sources".into(), json!(sources));
    out.insert("deferred".into(), json!([{"agent": "trae", "status": "variant-and-connection-unverified"}]));
    out.insert("recovered".into(), json!(options.recovered.iter().map(|entry| entry.clone()).collect::<Vec<_>>()));
    Value::Object(out)
}