// Suggestions only. No edit, network, or implicit price resolution occurs here.
use crate::pricing::is_identifier;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const VENDORS: [&str; 7] = ["openai", "anthropic", "google", "deepseek", "xiaomi", "zai", "minimax"];
const UNVERIFIED: [&str; 2] = ["reference-unverified", "official-thirdparty-unverified"];

pub fn signature(model: &str) -> Option<String> {
    if !is_identifier(&json!(model)) {
        return None;
    }
    let mut name = model.to_lowercase();
    if let Some(cut) = name.find('/') {
        if !VENDORS.contains(&name[..cut].as_ref()) {
            return None;
        }
        name = name[cut + 1..].to_string();
    }
    // Keep every version digit, release date and suffix.
    Some(name.replace(['.', '_', '-'], ""))
}

fn finite(value: Option<&Value>) -> bool {
    value.and_then(|v| v.as_f64()).map(|v| v.is_finite()).unwrap_or(false)
}

pub fn suggest(observed: &[Value], catalog: &Value, overrides: &Value) -> Value {
    let mut index: HashMap<String, Vec<Value>> = HashMap::new();
    let mut targets: Vec<(String, Value)> = catalog.as_object().map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
    if let Some(extra) = overrides.as_object() {
        for (key, value) in extra {
            match targets.iter_mut().find(|(k, _)| k == key) {
                Some(row) => row.1 = value.clone(),
                None => targets.push((key.clone(), value.clone())),
            }
        }
    }
    for (target, rates) in targets {
        let cut = target.find('/').unwrap_or(0);
        let provider = &target[..cut];
        let model = &target[cut + 1..];
        let id = match signature(model) {
            Some(id) => id,
            None => continue,
        };
        if !finite(rates.get("inputUncached")) || !finite(rates.get("output")) {
            continue;
        }
        if UNVERIFIED.contains(&rates.get("provenance").and_then(|v| v.as_str()).unwrap_or("")) {
            continue;
        }
        let manual = overrides.as_object().map(|m| m.contains_key(&target)).unwrap_or(false);
        let candidate = json!({
            "target": target, "provider": provider, "model": model,
            "origin": if manual { json!("manual") } else { rates.get("provenance").cloned().unwrap_or(Value::Null) },
            "source": if manual { Value::Null } else { rates.get("source").cloned().unwrap_or(Value::Null) },
            "rates": Value::Object(["inputUncached", "output", "cacheRead", "cacheWrite"].iter().map(|f| {
                (f.to_string(), if finite(rates.get(*f)) { json!(rates[*f].as_f64().unwrap() * 1e6) } else { Value::Null })
            }).collect::<Map<String, Value>>())
        });
        index.entry(id).or_default().push(candidate);
    }
    let mut out = Map::new();
    for row in observed {
        let provider = row.get("provider").and_then(|v| v.as_str()).unwrap_or("");
        let model = row.get("model").and_then(|v| v.as_str()).unwrap_or("");
        let key = format!("{provider}/{model}");
        let id = signature(model);
        let mut all: Vec<Value> = id
            .and_then(|id| index.get(&id).cloned())
            .unwrap_or_default()
            .into_iter()
            .filter(|c| c.get("target").and_then(|v| v.as_str()) != Some(key.as_str()))
            .collect();
        all.sort_by(|a, b| {
            let a_match = a.get("provider").and_then(|v| v.as_str()) == Some(provider);
            let b_match = b.get("provider").and_then(|v| v.as_str()) == Some(provider);
            b_match.cmp(&a_match).then_with(|| {
                crate::collate::compare(a.get("target").and_then(|v| v.as_str()).unwrap_or(""), b.get("target").and_then(|v| v.as_str()).unwrap_or(""))
            })
        });
        let total = all.len();
        let candidates: Vec<Value> = all
            .into_iter()
            .take(8)
            .map(|mut c| {
                let same_model = c.get("model").and_then(|v| v.as_str()).unwrap_or("").to_lowercase() == model.to_lowercase();
                c.as_object_mut().unwrap().insert(
                    "reason".into(),
                    json!(if same_model { "模型标识相同；请核对服务商与路由费率" } else { "仅大小写、分隔符或明确厂商前缀不同；版本、日期与后缀保持一致" }),
                );
                c
            })
            .collect();
        out.insert(key, json!({"total": total, "ambiguous": total > 1, "candidates": candidates}));
    }
    Value::Object(out)
}