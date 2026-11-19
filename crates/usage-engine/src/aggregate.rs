use crate::pricing::Eval;
use serde_json::{json, Map, Value};

pub const MAP_FIELDS: [&str; 6] = ["pricingReasons", "unpricedTokens", "incompleteTokens", "knownUsage", "knownRecords", "costParts"];

fn num(value: Option<&Value>) -> Option<f64> {
    value?.as_f64().filter(|n| n.is_finite())
}

fn bump(map: &mut Value, key: &str, amount: f64) {
    let entry = map.as_object_mut().unwrap().entry(key.to_string()).or_insert(json!(0));
    *entry = json!(entry.as_f64().unwrap_or(0.0) + amount);
}

pub fn add(map: &mut Map<String, Value>, key: &str, base: &Value, record: &Value, estimate: &Eval, parts: &[f64; 4], savings: f64, lower_bound: bool) {
    let conflict = record.get("usageConflict").map(crate::normalize::truthy).unwrap_or(false);
    if !map.contains_key(key) {
        let mut row = base.as_object().cloned().unwrap_or_default();
        for field in ["agent", "entry", "provider", "model"] {
            row.insert(field.into(), record.get(field).cloned().unwrap_or(Value::Null));
        }
        for field in ["totalTokens", "inputUncached", "output", "cacheRead", "cacheWrite", "reasoning", "records", "pricedRecords", "pricedTokens", "estimatedCostUsd", "estimatedCostUpperUsd", "boundedTokens"] {
            row.insert(field.into(), json!(0));
        }
        for field in ["pricingReasons", "unpricedTokens", "incompleteTokens", "knownUsage", "knownRecords"] {
            row.insert(field.into(), json!({}));
        }
        row.insert("partialRecords".into(), json!(0));
        row.insert("costParts".into(), json!({"inputUncached": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}));
        row.insert("cacheSavingsUsd".into(), json!(0));
        map.insert(key.to_string(), Value::Object(row));
    }
    let row = map.get_mut(key).unwrap().as_object_mut().unwrap();
    let total = num(record.get("totalTokens")).unwrap_or(0.0);
    let add_f64 = |row: &mut Map<String, Value>, field: &str, amount: f64| {
        let current = row.get(field).and_then(|v| v.as_f64()).unwrap_or(0.0);
        row.insert(field.into(), json!(current + amount));
    };
    add_f64(row, "totalTokens", total);
    add_f64(row, "records", 1.0);
    let quality = record.get("quality").and_then(|v| v.as_str()).unwrap_or("");
    if quality != "measured" || conflict {
        add_f64(row, "partialRecords", 1.0);
    }
    for field in ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning"] {
        let current = row.get(field).and_then(|v| v.as_f64());
        let incoming = num(record.get(field));
        let next = match (current, incoming) {
            (_, None) => None,
            (None, _) => None,
            _ if conflict => None,
            (Some(a), Some(b)) => Some(a + b),
        };
        row.insert(field.into(), json!(next));
    }
    let output = num(record.get("output"));
    let reasoning = num(record.get("reasoning"));
    for field in ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning", "outputPlain"] {
        let count = if field == "outputPlain" {
            match (output, reasoning) {
                (Some(o), Some(re)) if re <= o => Some(o - re),
                _ => None,
            }
        } else {
            num(record.get(field))
        };
        if !conflict {
            if let Some(count) = count {
                let mut known_usage = row.get("knownUsage").cloned().unwrap_or(json!({}));
                let mut known_records = row.get("knownRecords").cloned().unwrap_or(json!({}));
                bump(&mut known_usage, field, count);
                bump(&mut known_records, field, 1.0);
                row.insert("knownUsage".into(), known_usage);
                row.insert("knownRecords".into(), known_records);
            }
        }
    }
    let mut reasons = row.get("pricingReasons").cloned().unwrap_or(json!({}));
    bump(&mut reasons, &estimate.reason, 1.0);
    row.insert("pricingReasons".into(), reasons);
    if estimate.lower.is_none() {
        let mut unpriced = row.get("unpricedTokens").cloned().unwrap_or(json!({}));
        bump(&mut unpriced, &estimate.reason, total);
        row.insert("unpricedTokens".into(), unpriced);
        if let Some(cause) = &estimate.cause {
            let mut incomplete_tokens = row.get("incompleteTokens").cloned().unwrap_or(json!({}));
            bump(&mut incomplete_tokens, cause, total);
            row.insert("incompleteTokens".into(), incomplete_tokens);
        }
    }
    if let Some(lower) = estimate.lower {
        let upper = estimate.upper.unwrap_or(lower);
        add_f64(row, "estimatedCostUsd", lower);
        add_f64(row, "estimatedCostUpperUsd", upper);
        add_f64(row, "pricedRecords", 1.0);
        add_f64(row, "pricedTokens", total);
        if upper > lower || lower_bound {
            add_f64(row, "boundedTokens", total);
        }
        let mut cost_parts = row.get("costParts").cloned().unwrap_or(json!({}));
        for (i, field) in ["inputUncached", "output", "cacheRead", "cacheWrite"].iter().enumerate() {
            let current = cost_parts.get(*field).and_then(|v| v.as_f64()).unwrap_or(0.0);
            cost_parts.as_object_mut().unwrap().insert(field.to_string(), json!(current + parts[i]));
        }
        row.insert("costParts".into(), cost_parts);
        add_f64(row, "cacheSavingsUsd", savings);
    }
}