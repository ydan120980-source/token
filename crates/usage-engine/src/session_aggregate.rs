// The session list's own daily DTO, with the same unknown/conflict rules as
// pricing rows. Request-local only.
use serde_json::{json, Map, Value};

const FIELDS: [&str; 5] = ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning"];

fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(|v| v.as_f64()).filter(|v| v.is_finite())
}

pub fn add_session(map: &mut Map<String, Value>, date: &str, record: &Value, estimate: &Value) {
    let conflict = record.get("usageConflict").map(crate::normalize::truthy).unwrap_or(false);
    if !map.contains_key(date) {
        map.insert(
            date.to_string(),
            json!({"date": date, "totalTokens": 0, "inputUncached": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "reasoning": 0,
                "records": 0, "partialRecords": 0, "pricedTokens": 0, "boundedTokens": 0,
                "estimatedCostUsd": null, "estimatedCostUpperUsd": null, "knownUsage": {}}),
        );
    }
    let row = map.get_mut(date).unwrap().as_object_mut().unwrap();
    let total = record.get("totalTokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
    row.insert("totalTokens".into(), json!(row["totalTokens"].as_f64().unwrap_or(0.0) + total));
    row.insert("records".into(), json!(row["records"].as_f64().unwrap_or(0.0) + 1.0));
    let quality = record.get("quality").and_then(|v| v.as_str()).unwrap_or("");
    if quality != "measured" || conflict {
        row.insert("partialRecords".into(), json!(row["partialRecords"].as_f64().unwrap_or(0.0) + 1.0));
    }
    for field in FIELDS {
        let current = row.get(field).cloned().unwrap_or(Value::Null);
        let incoming = record.get(field).cloned().unwrap_or(Value::Null);
        let next = if current.is_null() || incoming.is_null() || conflict {
            Value::Null
        } else {
            json!(current.as_f64().unwrap_or(0.0) + incoming.as_f64().unwrap_or(0.0))
        };
        row.insert(field.into(), next);
        if !conflict {
            if let Some(value) = finite(record.get(field)) {
                let known = row.get_mut("knownUsage").unwrap().as_object_mut().unwrap();
                let sum = known.get(field).and_then(|v| v.as_f64()).unwrap_or(0.0) + value;
                known.insert(field.into(), json!(sum));
            }
        }
    }
    let output = finite(record.get("output"));
    let reasoning = finite(record.get("reasoning"));
    let plain = match (output, reasoning) {
        (Some(o), Some(r)) if r <= o => Some(o - r),
        _ => None,
    };
    if !conflict {
        if let Some(plain) = plain {
            let known = row.get_mut("knownUsage").unwrap().as_object_mut().unwrap();
            let sum = known.get("outputPlain").and_then(|v| v.as_f64()).unwrap_or(0.0) + plain;
            known.insert("outputPlain".into(), json!(sum));
        }
    }
    let lower = finite(estimate.get("lower"));
    if let Some(lower) = lower {
        let upper = finite(estimate.get("upper")).unwrap_or(0.0);
        let cost = row.get("estimatedCostUsd").and_then(|v| v.as_f64()).unwrap_or(0.0) + lower;
        let cost_upper = row.get("estimatedCostUpperUsd").and_then(|v| v.as_f64()).unwrap_or(0.0) + upper;
        row.insert("estimatedCostUsd".into(), json!(cost));
        row.insert("estimatedCostUpperUsd".into(), json!(cost_upper));
        row.insert("pricedTokens".into(), json!(row["pricedTokens"].as_f64().unwrap_or(0.0) + total));
        if upper > lower {
            row.insert("boundedTokens".into(), json!(row["boundedTokens"].as_f64().unwrap_or(0.0) + total));
        }
    }
}