use crate::js_json::stringify;
use serde_json::{json, Map, Value};

const INVALID: &str = "INVALID_USAGE_TRANSPORT";
const DIMENSIONS: [&str; 5] = ["date", "agent", "entry", "provider", "model"];
const MAPS: [&str; 6] = ["pricingReasons", "unpricedTokens", "incompleteTokens", "costParts", "knownUsage", "knownRecords"];

fn blank_row() -> Map<String, Value> {
    let mut row = Map::new();
    for key in ["date", "agent", "entry", "provider", "model", "totalTokens", "inputUncached", "output", "cacheRead", "cacheWrite", "reasoning", "records", "pricedTokens", "estimatedCostUsd"] {
        row.insert(key.into(), Value::Null);
    }
    row.insert("partialRecords".into(), json!(0));
    for key in ["estimatedCostUpperUsd"] {
        row.insert(key.into(), Value::Null);
    }
    row.insert("boundedTokens".into(), json!(0));
    for key in ["pricingReasons", "unpricedTokens", "incompleteTokens", "costParts", "cacheSavingsUsd", "knownUsage", "knownRecords"] {
        row.insert(key.into(), Value::Null);
    }
    row
}

fn vector_of(cell: Option<&Value>, keys: &[String]) -> Vec<Value> {
    keys.iter()
        .map(|k| cell.and_then(|v| v.get(k)).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null))
        .collect()
}

fn vector_to_map(keys: &[Value], vector: &Value) -> Value {
    let mut out = Map::new();
    let items = vector.as_array().cloned().unwrap_or_default();
    for (j, key) in keys.iter().enumerate() {
        if let Some(value) = items.get(j) {
            if !value.is_null() {
                out.insert(key.as_str().unwrap_or_default().to_string(), value.clone());
            }
        }
    }
    Value::Object(out)
}

pub fn pack_rows(rows: &[Value]) -> Value {
    let columns: Vec<String> = rows.first().and_then(|r| r.as_object()).map(|m| m.keys().cloned().collect()).unwrap_or_default();
    let mut layouts: Vec<Value> = Vec::new();
    for key in &columns {
        if DIMENSIONS.contains(&key.as_str()) {
            let mut values: Vec<Value> = Vec::new();
            for row in rows {
                let v = row.get(key).cloned().unwrap_or(Value::Null);
                if !values.contains(&v) {
                    values.push(v);
                }
            }
            layouts.push(json!({"kind": "dictionary", "values": values}));
        } else if MAPS.contains(&key.as_str()) {
            let mut keys: Vec<String> = Vec::new();
            for row in rows {
                if let Some(map) = row.get(key).and_then(|v| v.as_object()) {
                    for name in map.keys() {
                        if !keys.contains(name) {
                            keys.push(name.clone());
                        }
                    }
                }
            }
            let mut values: Vec<Value> = Vec::new();
            let mut seen: Vec<String> = Vec::new();
            let mut overflow = false;
            for row in rows {
                let cell = row.get(key);
                if cell == Some(&Value::Null) {
                    continue;
                }
                let vector = vector_of(cell, &keys);
                let signature = stringify(&Value::Array(vector.clone()));
                if !seen.contains(&signature) {
                    seen.push(signature);
                    values.push(Value::Array(vector));
                    if values.len() > 128 {
                        overflow = true;
                        break;
                    }
                }
            }
            if overflow {
                layouts.push(json!({"kind": "map", "keys": keys}));
            } else {
                layouts.push(json!({"kind": "map", "keys": keys, "values": values}));
            }
        } else {
            layouts.push(Value::Null);
        }
    }
    let packed_rows: Vec<Value> = rows
        .iter()
        .map(|row| {
            Value::Array(
                columns
                    .iter()
                    .enumerate()
                    .map(|(i, key)| {
                        let layout = &layouts[i];
                        let v = row.get(key).cloned().unwrap_or(Value::Null);
                        let kind = layout.get("kind").and_then(|k| k.as_str());
                        if kind == Some("dictionary") {
                            let values = layout.get("values").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                            json!(values.iter().position(|x| *x == v))
                        } else if kind == Some("map") && !v.is_null() {
                            let keys: Vec<String> = layout.get("keys").and_then(|x| x.as_array()).cloned().unwrap_or_default().iter().map(|k| k.as_str().unwrap_or_default().to_string()).collect();
                            let vector = vector_of(Some(&v), &keys);
                            match layout.get("values").and_then(|x| x.as_array()) {
                                Some(values) => {
                                    let signature = stringify(&Value::Array(vector.clone()));
                                    json!(values.iter().position(|x| stringify(x) == signature))
                                }
                                None => Value::Array(vector),
                            }
                        } else {
                            v
                        }
                    })
                    .collect(),
            )
        })
        .collect();
    json!({"columns": columns, "layouts": layouts, "rows": packed_rows})
}

pub fn unpack_rows(packed: &Value) -> Result<Vec<Value>, String> {
    let columns = packed.get("columns").and_then(|v| v.as_array()).ok_or(INVALID)?;
    let layouts = packed.get("layouts").and_then(|v| v.as_array()).ok_or(INVALID)?;
    let rows = packed.get("rows").and_then(|v| v.as_array()).ok_or(INVALID)?;
    let dictionaries: Vec<Option<Vec<Value>>> = layouts
        .iter()
        .map(|layout| {
            if layout.get("kind").and_then(|k| k.as_str()) == Some("map") {
                layout.get("values").and_then(|v| v.as_array()).map(|values| {
                    let keys = layout.get("keys").and_then(|k| k.as_array()).cloned().unwrap_or_default();
                    values.iter().map(|v| vector_to_map(&keys, v)).collect()
                })
            } else {
                None
            }
        })
        .collect();
    let blank = blank_row();
    let shape: Vec<&str> = blank.keys().map(|k| k.as_str()).collect();
    let has_hour = columns.iter().any(|c| c.as_str() == Some("hour"));
    let canonical = columns.len() == if has_hour { 25 } else { 24 }
        && columns.iter().all(|c| c.as_str() == Some("hour") || shape.contains(&c.as_str().unwrap_or("")));
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let values = row.as_array().ok_or(INVALID)?;
        let mut out = if canonical { blank_row() } else { Map::new() };
        for (i, key) in columns.iter().enumerate() {
            let key = key.as_str().ok_or(INVALID)?;
            let layout = layouts.get(i).ok_or(INVALID)?;
            let v = values.get(i).ok_or(INVALID)?;
            let kind = layout.get("kind").and_then(|k| k.as_str());
            let value = if kind == Some("dictionary") {
                let values = layout.get("values").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                v.as_u64().and_then(|index| values.get(index as usize).cloned()).unwrap_or(Value::Null)
            } else if kind == Some("map") && !v.is_null() {
                match &dictionaries[i] {
                    Some(dict) => v.as_u64().and_then(|index| dict.get(index as usize).cloned()).unwrap_or(Value::Null),
                    None => {
                        let keys = layout.get("keys").and_then(|k| k.as_array()).cloned().unwrap_or_default();
                        vector_to_map(&keys, v)
                    }
                }
            } else {
                v.clone()
            };
            out.insert(key.to_string(), value);
        }
        result.push(Value::Object(out));
    }
    Ok(result)
}

pub fn pack(snapshot: &Value) -> Value {
    let mut header = snapshot.as_object().cloned().unwrap_or_default();
    header.remove("daily");
    header.remove("hourly");
    let daily = snapshot.get("daily").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let hourly = snapshot.get("hourly").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    json!({
        "codec": "LocalUsageColumnsV1",
        "header": header,
        "daily": pack_rows(&daily),
        "hourly": pack_rows(&hourly)
    })
}

pub fn unpack(value: &Value, previous: Option<&Value>, revision: Option<i64>) -> Result<Value, String> {
    let codec = value.get("codec").and_then(|v| v.as_str()).unwrap_or("");
    if codec != "LocalUsageColumnsV1" && codec != "LocalUsageDeltaV1" {
        return Err(INVALID.to_string());
    }
    let delta = codec == "LocalUsageDeltaV1";
    let base = previous.ok_or("USAGE_DELTA_BASE_MISMATCH");
    if delta {
        let base = base?;
        if revision != value.get("baseRevision").and_then(|v| v.as_i64()) {
            return Err("USAGE_DELTA_BASE_MISMATCH".to_string());
        }
        let _ = base;
    }
    let daily = unpack_rows(value.get("daily").ok_or(INVALID)?)?;
    let hourly = unpack_rows(value.get("hourly").ok_or(INVALID)?)?;
    let apply = |order: Option<&Value>, before: &[Value], changed: &[Value], limit: usize| -> Result<Vec<Value>, String> {
        let order = order.and_then(|v| v.as_array()).ok_or(INVALID)?;
        if order.len() > limit {
            return Err(INVALID.to_string());
        }
        order
            .iter()
            .map(|index| {
                let n = index.as_f64().filter(|n| n.is_finite() && n.fract() == 0.0 && n.abs() <= 9_007_199_254_740_991.0).ok_or(INVALID)?;
                let index = n as i64;
                if index >= before.len() as i64 || (index < 0 && (-index) > changed.len() as i64) {
                    return Err(INVALID.to_string());
                }
                Ok(if index >= 0 { before[index as usize].clone() } else { changed[(-index - 1) as usize].clone() })
            })
            .collect()
    };
    let null = Value::Null;
    let previous = previous.unwrap_or(&null);
    let prev_daily = previous.get("daily").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let prev_hourly = previous.get("hourly").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let daily = if delta { apply(value.get("dailyOrder"), &prev_daily, &daily, 100_000)? } else { daily };
    let hourly = if delta { apply(value.get("hourlyOrder"), &prev_hourly, &hourly, 50_000)? } else { hourly };
    let mut out = value.get("header").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    out.insert("daily".into(), json!(daily));
    out.insert("hourly".into(), json!(hourly));
    Ok(Value::Object(out))
}