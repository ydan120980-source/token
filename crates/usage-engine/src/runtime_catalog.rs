use crate::js_json::stringify;
use crate::pricing::{catalog, is_identifier, validate, FIELDS};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub const URL: &str = "https://models.dev/api.json";
const UNVERIFIED: [&str; 2] = ["reference-unverified", "official-thirdparty-unverified"];
const COST_FIELDS: [(&str, &str); 4] = [
    ("inputUncached", "input"),
    ("output", "output"),
    ("cacheRead", "cache_read"),
    ("cacheWrite", "cache_write"),
];

pub fn hash(value: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(stringify(value).as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn embedded() -> &'static Value {
    static EMBEDDED: OnceLock<Value> = OnceLock::new();
    EMBEDDED.get_or_init(|| serde_json::from_str(include_str!("../../../src/m1/models-dev-prices.json")).expect("embedded models-dev prices"))
}

fn rates_from_cost(provider: &str, model: &str, cost: &Value) -> Result<Value, String> {
    let mut entry = Map::new();
    entry.insert("provider".into(), json!(provider));
    entry.insert("model".into(), json!(model));
    for (field, source) in COST_FIELDS {
        entry.insert(field.into(), cost.get(source).cloned().unwrap_or(Value::Null));
    }
    Ok(validate(&Value::Object(entry))?["rates"].clone())
}

fn reasoning_rate(value: Option<&Value>) -> Result<Option<f64>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => {
            let n = v.as_f64().filter(|n| n.is_finite() && *n >= 0.0 && *n <= 100_000.0).ok_or("PRICE_RATE_INVALID")?;
            Ok(Some(n / 1e6))
        }
    }
}

pub fn parse(text: &str, obtained_at: &str) -> Result<Value, String> {
    if text.len() > 16 * 1024 * 1024 {
        return Err("PRICE_DOWNLOAD_SIZE".to_string());
    }
    let data: Value = serde_json::from_str(text).map_err(|_| "PRICE_DOWNLOAD_SCHEMA".to_string())?;
    let object = data.as_object().filter(|_| !data.is_array()).ok_or("PRICE_DOWNLOAD_SCHEMA")?;
    if object.len() > 600 {
        return Err("PRICE_DOWNLOAD_SCHEMA".to_string());
    }
    let mut models = Map::new();
    let mut skipped = json!({"missing": 0, "invalid": 0, "modality": 0});
    let mut seen = 0usize;
    for (provider, group) in object {
        let pb = provider.as_bytes();
        if provider.is_empty() || provider.len() > 99 || !pb.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')) {
            continue;
        }
        let Some(group_models) = group.get("models").and_then(|v| v.as_object()) else { continue };
        for (model, entry) in group_models {
            seen += 1;
            if seen > 40000 {
                return Err("PRICE_DOWNLOAD_SCHEMA".to_string());
            }
            if !is_identifier(&json!(model)) {
                skipped["invalid"] = json!(skipped["invalid"].as_u64().unwrap() + 1);
                continue;
            }
            let text_output = entry.get("modalities").and_then(|m| m.get("output")).and_then(|o| o.as_array()).map(|list| list.iter().any(|v| v.as_str() == Some("text"))).unwrap_or(false);
            if !text_output {
                skipped["modality"] = json!(skipped["modality"].as_u64().unwrap() + 1);
                continue;
            }
            let Some(cost) = entry.get("cost").filter(|c| c.is_object()) else {
                skipped["missing"] = json!(skipped["missing"].as_u64().unwrap() + 1);
                continue;
            };
            if cost.get("input").map(|v| v.is_null()).unwrap_or(true) || cost.get("output").map(|v| v.is_null()).unwrap_or(true) {
                skipped["missing"] = json!(skipped["missing"].as_u64().unwrap() + 1);
                continue;
            }
            let result = (|| -> Result<Value, String> {
                let rates = rates_from_cost(provider, model, cost)?;
                let mut tiers: Vec<Value> = cost
                    .get("tiers")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|t| t.get("tier").and_then(|x| x.get("type")).and_then(|x| x.as_str()) == Some("context") && t.get("tier").and_then(|x| x.get("size")).and_then(|x| x.as_f64()).map(|s| s > 0.0 && s.fract() == 0.0 && s <= 9_007_199_254_740_991.0).unwrap_or(false))
                    .collect();
                tiers.sort_by(|a, b| a["tier"]["size"].as_f64().unwrap().total_cmp(&b["tier"]["size"].as_f64().unwrap()));
                let mut context_tiers: Vec<Value> = Vec::new();
                for tier in tiers {
                    let reasoning = reasoning_rate(tier.get("reasoning"))?;
                    let mut tier_rates = rates_from_cost(provider, model, &tier)?;
                    tier_rates.as_object_mut().unwrap().insert("reasoning".into(), json!(reasoning));
                    context_tiers.push(json!({"threshold": tier["tier"]["size"], "rates": tier_rates}));
                }
                if context_tiers.len() > 12 {
                    return Err("PRICE_TIERS_INVALID".to_string());
                }
                let thresholds: Vec<String> = context_tiers.iter().map(|t| stringify(&t["threshold"])).collect();
                let unique: std::collections::HashSet<&String> = thresholds.iter().collect();
                if unique.len() != thresholds.len() {
                    return Err("PRICE_TIERS_INVALID".to_string());
                }
                let reasoning = reasoning_rate(cost.get("reasoning"))?;
                let mut value = rates.as_object().cloned().unwrap_or_default();
                value.insert("provenance".into(), json!("models-dev"));
                value.insert("source".into(), json!(URL));
                if let Some(reasoning) = reasoning {
                    value.insert("reasoning".into(), json!(reasoning));
                }
                if let Some(first) = context_tiers.first() {
                    value.insert("contextTiers".into(), json!(context_tiers));
                    value.insert("longContext".into(), first["rates"].clone());
                    value.insert("longContextThreshold".into(), first["threshold"].clone());
                }
                Ok(Value::Object(value))
            })();
            match result {
                Ok(value) => {
                    models.insert(format!("{provider}/{model}"), value);
                }
                Err(_) => {
                    skipped["invalid"] = json!(skipped["invalid"].as_u64().unwrap() + 1);
                }
            }
        }
    }
    if models.is_empty() {
        return Err("PRICE_DOWNLOAD_EMPTY".to_string());
    }
    Ok(json!({
        "version": "models-dev/1",
        "obtainedAt": obtained_at,
        "source": URL,
        "sha256": hash(&Value::Object(models.clone())),
        "models": models,
        "skipped": skipped
    }))
}

pub fn verify(value: &Value) -> Result<Value, String> {
    let invalid = || "PRICE_CACHE_INVALID".to_string();
    if value.get("version").and_then(|v| v.as_str()) != Some("models-dev/1") {
        return Err(invalid());
    }
    let obtained = value.get("obtainedAt").and_then(|v| v.as_str()).unwrap_or("");
    if crate::time::parse_iso(obtained).is_none() {
        return Err(invalid());
    }
    let models = value.get("models").and_then(|v| v.as_object()).ok_or_else(invalid)?;
    if models.len() > 40000 || value.get("sha256").and_then(|v| v.as_str()) != Some(hash(&Value::Object(models.clone())).as_str()) {
        return Err(invalid());
    }
    let check_rates = |key: &str, rates: &Value| -> Result<(), String> {
        let cut = key.find('/').ok_or_else(invalid)?;
        let mut entry = Map::new();
        entry.insert("provider".into(), json!(&key[..cut]));
        entry.insert("model".into(), json!(&key[cut + 1..]));
        for field in FIELDS {
            let raw = rates.get(field);
            entry.insert(field.into(), match raw {
                None | Some(Value::Null) => Value::Null,
                Some(v) => json!(v.as_f64().unwrap_or(f64::NAN) * 1e6),
            });
        }
        validate(&Value::Object(entry)).map(|_| ())
    };
    for (key, rates) in models {
        check_rates(key, rates)?;
        if let Some(long) = rates.get("longContext").filter(|v| v.is_object()) {
            let threshold = rates.get("longContextThreshold").and_then(|v| v.as_f64()).filter(|t| t.is_finite() && *t > 0.0).ok_or_else(invalid)?;
            let _ = threshold;
            check_rates(key, long)?;
        }
        if let Some(reasoning) = rates.get("reasoning").filter(|v| !v.is_null()) {
            let n = reasoning.as_f64().filter(|n| n.is_finite() && *n >= 0.0 && *n <= 0.1).ok_or_else(invalid)?;
            let _ = n;
        }
        if let Some(tiers) = rates.get("contextTiers") {
            let list = tiers.as_array().filter(|l| l.len() <= 12).ok_or_else(invalid)?;
            let mut previous = 0.0;
            for tier in list {
                let threshold = tier.get("threshold").and_then(|v| v.as_f64()).filter(|t| t.fract() == 0.0 && *t > 0.0 && *t <= 9_007_199_254_740_991.0 && *t > previous).ok_or_else(invalid)?;
                previous = threshold;
                let tier_rates = tier.get("rates").ok_or_else(invalid)?;
                check_rates(key, tier_rates)?;
                if let Some(reasoning) = tier_rates.get("reasoning").filter(|v| !v.is_null()) {
                    reasoning.as_f64().filter(|n| n.is_finite() && *n >= 0.0 && *n <= 0.1).ok_or_else(invalid)?;
                }
            }
        }
        if rates.get("provenance").and_then(|v| v.as_str()) != Some("models-dev") || rates.get("source").and_then(|v| v.as_str()) != Some(URL) {
            return Err(invalid());
        }
    }
    Ok(value.clone())
}

pub fn merged(remote: Option<&Value>) -> Value {
    let mut models = remote.and_then(|r| r.get("models")).and_then(|m| m.as_object()).cloned().unwrap_or_default();
    for (key, value) in catalog().get("models").and_then(|m| m.as_object()).unwrap() {
        let provenance = value.get("provenance").and_then(|v| v.as_str()).unwrap_or("");
        if !models.contains_key(key) && (remote.is_none() || !UNVERIFIED.contains(&provenance)) {
            models.insert(key.clone(), value.clone());
        }
    }
    Value::Object(models)
}