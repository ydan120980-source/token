use crate::js_json::stringify;
use crate::normalize::truthy;
use serde_json::{json, Map, Value};

pub const FIELDS: [&str; 5] = ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning"];
pub const CONFLICT: &str = "SOURCE_USAGE_CONFLICT";
pub const REGRESSION: &str = "SOURCE_USAGE_REGRESSION";

pub struct Selection {
    pub record: Value,
    pub issue: Option<&'static str>,
}

fn finite(record: &Value, field: &str) -> Option<f64> {
    record.get(field)?.as_f64().filter(|v| v.is_finite())
}

fn rank(record: &Value) -> i32 {
    let quality = record
        .get("measurementQuality")
        .filter(|v| truthy(v))
        .or_else(|| record.get("quality"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match quality {
        "measured" => 2,
        "partial" => 1,
        _ => 0,
    }
}

fn valid(record: &Value) -> bool {
    rank(record) > 0
}

fn informs(a: &Value, b: &Value) -> bool {
    let keeps = FIELDS.iter().all(|f| finite(b, f).is_none() || finite(a, f).is_some());
    let fills = FIELDS.iter().any(|f| finite(b, f).is_none() && finite(a, f).is_some());
    let str_eq = |r: &Value, k: &str, want: &str| r.get(k).and_then(|v| v.as_str()) == Some(want);
    let metadata = (str_eq(b, "model", "unknown") && !str_eq(a, "model", "unknown"))
        || (str_eq(b, "provider", "unknown") && !str_eq(a, "provider", "unknown"));
    keeps && (fills || metadata)
}

fn canonical(record: &Value) -> String {
    let mut items = vec![
        record.get("timestamp").cloned().unwrap_or(Value::Null),
        record.get("model").cloned().unwrap_or(Value::Null),
        record.get("provider").cloned().unwrap_or(Value::Null),
    ];
    for field in FIELDS {
        items.push(record.get(field).cloned().unwrap_or(Value::Null));
    }
    stringify(&Value::Array(items))
}

// JS `<` on strings compares UTF-16 code units, which orders astral characters
// below some BMP characters; byte order would disagree.
fn utf16_less(a: &str, b: &str) -> bool {
    let au: Vec<u16> = a.encode_utf16().collect();
    let bu: Vec<u16> = b.encode_utf16().collect();
    au < bu
}

fn strict_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (None, None) => true,
        (Some(x), Some(y)) => x == y,
        _ => false,
    }
}

fn conflict_flag(record: &Value) -> bool {
    record.get("usageConflict").map(truthy).unwrap_or(false)
}

pub fn select_usage_snapshot(previous: Option<&Value>, incoming: &Value) -> Selection {
    let previous = match previous {
        None => {
            return Selection { record: incoming.clone(), issue: if conflict_flag(incoming) { Some(CONFLICT) } else { None } };
        }
        Some(p) => p,
    };
    let total_i = incoming.get("totalTokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let total_p = previous.get("totalTokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let order = (valid(incoming) as i32 - valid(previous) as i32) as f64 + 0.0;
    let order = if order != 0.0 { order } else { total_i - total_p };
    if order < 0.0 {
        return Selection {
            record: previous.clone(),
            issue: if total_i < total_p {
                Some(REGRESSION)
            } else if conflict_flag(previous) {
                Some(CONFLICT)
            } else {
                None
            },
        };
    }
    if order > 0.0 {
        return Selection { record: incoming.clone(), issue: if conflict_flag(incoming) { Some(CONFLICT) } else { None } };
    }
    if !conflict_flag(previous)
        && !conflict_flag(incoming)
        && rank(incoming) == rank(previous)
        && strict_eq(incoming.get("timestamp"), previous.get("timestamp"))
        && strict_eq(incoming.get("model"), previous.get("model"))
        && strict_eq(incoming.get("provider"), previous.get("provider"))
        && FIELDS.iter().all(|f| strict_eq(incoming.get(*f), previous.get(*f)))
    {
        return Selection { record: previous.clone(), issue: None };
    }
    let conflict = rank(previous) > 0
        && rank(incoming) > 0
        && FIELDS.iter().any(|f| match (finite(previous, f), finite(incoming, f)) {
            (Some(a), Some(b)) => a != b,
            _ => false,
        });
    if conflict || conflict_flag(previous) || conflict_flag(incoming) {
        let base = if rank(incoming) > rank(previous) { incoming } else { previous };
        let record = if conflict_flag(base) && base.get("quality").and_then(|v| v.as_str()) == Some("usage-conflict") {
            base.clone()
        } else {
            let mut map = base.as_object().cloned().unwrap_or_default();
            map.insert("usageConflict".into(), json!(true));
            let fallback = base
                .get("measurementQuality")
                .filter(|v| truthy(v))
                .or_else(|| base.get("quality").filter(|v| truthy(v)))
                .cloned();
            match fallback {
                Some(v) => map.insert("measurementQuality".into(), v),
                None => map.remove("measurementQuality"),
            };
            map.insert("quality".into(), json!("usage-conflict"));
            Value::Object(map)
        };
        return Selection { record, issue: Some(CONFLICT) };
    }
    if rank(incoming) != rank(previous) {
        return Selection { record: if rank(incoming) > rank(previous) { incoming.clone() } else { previous.clone() }, issue: None };
    }
    let better = informs(incoming, previous);
    let worse = informs(previous, incoming);
    if better != worse {
        return Selection { record: if better { incoming.clone() } else { previous.clone() }, issue: None };
    }
    Selection {
        record: if utf16_less(&canonical(incoming), &canonical(previous)) { incoming.clone() } else { previous.clone() },
        issue: None,
    }
}

pub fn keep_identity(owner: &Value, snapshot: &Value) -> Value {
    let mut map: Map<String, Value> = snapshot.as_object().cloned().unwrap_or_default();
    for key in ["id", "agent", "entry", "sessionKey"] {
        map.insert(key.into(), owner.get(key).cloned().unwrap_or(Value::Null));
    }
    Value::Object(map)
}