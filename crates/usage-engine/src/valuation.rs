use crate::agent_catalog::custom_id;
use crate::pricing::{evaluate, lower_bound, Eval};
use crate::runtime_catalog;
use crate::usage_projection::FullEstimate;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const UNVERIFIED: [&str; 2] = ["reference-unverified", "official-thirdparty-unverified"];
const NO_FLOOR: [&str; 3] = ["conflict", "invalid-cache", "invalid-reasoning"];

#[derive(Clone)]
pub struct Pricing {
    pub overrides: Value,
    pub model_catalog: Value,
    pub billing: Value,
    case_catalog: Option<HashMap<String, Option<String>>>,
}

fn truthy(value: Option<&Value>) -> bool {
    value.map(crate::normalize::truthy).unwrap_or(false)
}

fn with_manual(rates: &Value) -> Value {
    let mut map = rates.as_object().cloned().unwrap_or_default();
    map.insert("provenance".into(), json!("manual"));
    Value::Object(map)
}

impl Pricing {
    pub fn new(overrides: Value, model_catalog: Value, billing: Value) -> Self {
        Pricing { overrides, model_catalog, billing, case_catalog: None }
    }

    fn resolve_own(&mut self, record: &Value) -> Value {
        let provider = record.get("provider").and_then(|v| v.as_str()).unwrap_or("");
        let model = record.get("model").and_then(|v| v.as_str()).unwrap_or("");
        let agent = record.get("agent").and_then(|v| v.as_str()).unwrap_or("");
        let key = format!("{provider}/{model}");
        let defaults = self.billing.get("defaults").and_then(|d| d.get(agent));
        if let Some(override_rates) = self.overrides.get(&key).filter(|v| v.is_object()) {
            return json!({"rates": with_manual(override_rates), "origin": "manual", "target": key});
        }
        let mapped = self.billing.get("mappings").and_then(|m| m.get(&key)).and_then(|v| v.as_str());
        let default_model = defaults.filter(|d| d.get("mode").and_then(|m| m.as_str()) == Some("default")).and_then(|d| d.get("model")).and_then(|m| m.as_str());
        let target = mapped.or(default_model);
        if let Some(target) = target {
            let rates = match self.overrides.get(target).filter(|v| v.is_object()) {
                Some(override_rates) => with_manual(override_rates),
                None => self.model_catalog.get(target).cloned().unwrap_or(Value::Null),
            };
            return json!({"rates": rates, "origin": if mapped.is_some() { "mapped" } else { "default-model" }, "target": target});
        }
        let own = self.model_catalog.get(&key);
        if let Some(own) = own {
            if own.get("provenance").and_then(|v| v.as_str()) != Some("reference-unverified") {
                return json!({"rates": own, "origin": own.get("provenance"), "target": key});
            }
        }
        if custom_id(agent) {
            return json!({"rates": null, "origin": "unpriced", "target": key});
        }
        let lower = model.to_ascii_lowercase();
        let vendor = if lower.starts_with("gpt-") || (lower.starts_with('o') && lower.as_bytes().get(1).map(|c| c.is_ascii_digit()).unwrap_or(false) && *lower.as_bytes().get(1).unwrap() != b'0') {
            Some("openai")
        } else if lower.starts_with("claude-") {
            Some("anthropic")
        } else if lower.starts_with("gemini-") {
            Some("google")
        } else if lower.starts_with("mimo-") {
            Some("xiaomi")
        } else if lower.starts_with("deepseek-") {
            Some("deepseek")
        } else if lower.starts_with("glm-") {
            Some("zai")
        } else if lower.starts_with("minimax-") {
            Some("minimax")
        } else if lower.starts_with("hy") && lower.as_bytes().get(2).map(|c| c.is_ascii_digit()).unwrap_or(false) {
            Some("tencent-tokenhub")
        } else if lower.starts_with("space-bunny") {
            Some("opencode-go")
        } else {
            None
        };
        let mut candidate = if self.model_catalog.get(model).is_some() {
            Some(model.to_string())
        } else {
            vendor.map(|v| format!("{v}/{model}"))
        };
        if let Some(candidate_key) = &candidate {
            if self.model_catalog.get(candidate_key).is_none() {
                if self.case_catalog.is_none() {
                    let mut case_map: HashMap<String, Option<String>> = HashMap::new();
                    for id in self.model_catalog.as_object().map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default() {
                        let lower_id = id.to_ascii_lowercase();
                        case_map.entry(lower_id).and_modify(|e| *e = None).or_insert(Some(id.clone()));
                    }
                    self.case_catalog = Some(case_map);
                }
                let looked = self.case_catalog.as_ref().unwrap().get(&candidate_key.to_ascii_lowercase()).cloned().flatten();
                candidate = Some(looked.unwrap_or_else(|| candidate_key.clone()));
            }
        }
        let rates = candidate.as_ref().and_then(|c| self.model_catalog.get(c));
        match rates {
            Some(rates) if rates.get("provenance").and_then(|v| v.as_str()) != Some("reference-unverified") => {
                json!({"rates": rates, "origin": "model-id", "target": candidate})
            }
            _ => json!({"rates": own, "origin": own.and_then(|o| o.get("provenance")).and_then(|p| p.as_str()).unwrap_or("unpriced"), "target": key}),
        }
    }

    pub fn resolve_price(&mut self, record: &Value) -> Value {
        let own = self.resolve_own(record);
        let fallback = self.billing.get("fallback").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let own_rates = own.get("rates").filter(|v| v.is_object());
        let own_verified = own_rates.map(|r| !UNVERIFIED.contains(&r.get("provenance").and_then(|p| p.as_str()).unwrap_or(""))).unwrap_or(false);
        let Some(fallback) = fallback else { return own };
        if own_rates.is_some() && own_verified {
            return own;
        }
        let rates = match self.overrides.get(fallback).filter(|v| v.is_object()) {
            Some(override_rates) => with_manual(override_rates),
            None => self.model_catalog.get(fallback).cloned().unwrap_or(Value::Null),
        };
        if rates.is_object() {
            json!({"rates": rates, "origin": "fallback", "target": fallback})
        } else {
            own
        }
    }

    pub fn estimate(&mut self, record: &Value) -> Value {
        let resolved = self.resolve_price(record);
        let rates = resolved.get("rates").filter(|v| v.is_object());
        let mut estimate = match rates {
            Some(rates) => {
                let mut merged = rates.as_object().cloned().unwrap_or_default();
                let billing_provider = resolved.get("target").and_then(|t| t.as_str()).and_then(|t| t.split('/').next()).filter(|s| !s.is_empty()).map(|s| s.to_string()).unwrap_or_else(|| record.get("provider").and_then(|p| p.as_str()).unwrap_or("").to_string());
                merged.insert("billingProvider".into(), json!(billing_provider));
                evaluate(record, &json!({}), Some(&Value::Object(merged))).to_value()
            }
            None => json!({"reason": "model-unpriced", "lower": null, "upper": null}),
        };
        let cause = estimate.get("cause").and_then(|v| v.as_str()).map(|s| s.to_string());
        if truthy(self.billing.get("partialLowerBound")) && estimate.get("reason").and_then(|v| v.as_str()) == Some("usage-incomplete") && !NO_FLOOR.contains(&cause.as_deref().unwrap_or("")) {
            if let Some(rates) = rates {
                if let Some(floor) = lower_bound(record, rates) {
                    estimate = json!({"lower": floor, "upper": floor, "reason": "usage-lower-bound", "cause": cause, "lowerBound": true});
                }
            }
        }
        if resolved.get("origin").and_then(|v| v.as_str()) == Some("fallback") && !estimate.get("lower").map(|v| v.is_null()).unwrap_or(true) {
            estimate.as_object_mut().unwrap().insert("fallback".into(), json!(true));
        }
        let multiplier = self
            .billing
            .get("defaults")
            .and_then(|d| d.get(record.get("agent").and_then(|a| a.as_str()).unwrap_or("")))
            .and_then(|d| d.get("multiplier"))
            .and_then(|m| m.as_f64())
            .unwrap_or(1.0);
        if !estimate.get("lower").map(|v| v.is_null()).unwrap_or(true) {
            let lower = estimate["lower"].as_f64().unwrap() * multiplier;
            let upper = estimate["upper"].as_f64().unwrap() * multiplier;
            let object = estimate.as_object_mut().unwrap();
            object.insert("lower".into(), json!(lower));
            object.insert("upper".into(), json!(upper));
            let rates = rates.unwrap();
            let rate = |field: &str| rates.get(field).and_then(|v| v.as_f64()).filter(|n| n.is_finite()).unwrap_or(0.0);
            let fields = ["inputUncached", "output", "cacheRead", "cacheWrite"];
            let weights: Vec<f64> = fields.iter().map(|f| record.get(*f).and_then(|v| v.as_f64()).unwrap_or(0.0) * rate(f)).collect();
            let weight: f64 = weights.iter().sum();
            let parts: Map<String, Value> = fields
                .iter()
                .zip(weights.iter())
                .map(|(f, w)| (f.to_string(), json!(if weight > 0.0 { lower * w / weight } else { 0.0 })))
                .collect();
            object.insert("parts".into(), Value::Object(parts));
            let savings = record.get("cacheRead").and_then(|v| v.as_f64()).unwrap_or(0.0) * (rate("inputUncached") - rate("cacheRead")).max(0.0) * multiplier;
            object.insert("savings".into(), json!(savings));
        }
        estimate
    }
}

pub fn to_full_estimate(estimate: &Value) -> FullEstimate {
    let parts = [
        estimate.get("parts").and_then(|p| p.get("inputUncached")).and_then(|v| v.as_f64()).unwrap_or(0.0),
        estimate.get("parts").and_then(|p| p.get("output")).and_then(|v| v.as_f64()).unwrap_or(0.0),
        estimate.get("parts").and_then(|p| p.get("cacheRead")).and_then(|v| v.as_f64()).unwrap_or(0.0),
        estimate.get("parts").and_then(|p| p.get("cacheWrite")).and_then(|v| v.as_f64()).unwrap_or(0.0),
    ];
    FullEstimate {
        eval: Eval {
            reason: estimate.get("reason").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            lower: estimate.get("lower").and_then(|v| v.as_f64()),
            upper: estimate.get("upper").and_then(|v| v.as_f64()),
            cause: estimate.get("cause").and_then(|v| v.as_str()).map(|s| s.to_string()),
        },
        parts,
        savings: estimate.get("savings").and_then(|v| v.as_f64()).unwrap_or(0.0),
        lower_bound: estimate.get("lowerBound") == Some(&json!(true)),
    }
}

pub fn valid_price_target(key: &Value, overrides: &Value, models: &Value) -> bool {
    let Some(key) = key.as_str() else { return false };
    let rates = overrides.get(key).or_else(|| models.get(key));
    match rates {
        Some(rates) => !UNVERIFIED.contains(&rates.get("provenance").and_then(|p| p.as_str()).unwrap_or("")),
        None => false,
    }
}

pub fn check_price_references(billing: &Value, current: (&Value, &Value), next: (&Value, &Value)) -> Result<(), String> {
    let mut targets: Vec<Value> = billing.get("mappings").and_then(|m| m.as_object()).map(|m| m.values().cloned().collect()).unwrap_or_default();
    if let Some(defaults) = billing.get("defaults").and_then(|d| d.as_object()) {
        for entry in defaults.values() {
            if entry.get("mode").and_then(|m| m.as_str()) == Some("default") {
                targets.push(entry.get("model").cloned().unwrap_or(Value::Null));
            }
        }
    }
    if let Some(fallback) = billing.get("fallback").filter(|v| crate::normalize::truthy(v)) {
        targets.push(fallback.clone());
    }
    for key in targets {
        if valid_price_target(&key, current.0, current.1) && !valid_price_target(&key, next.0, next.1) {
            return Err("PRICE_TARGET_IN_USE".to_string());
        }
    }
    Ok(())
}

pub fn validate_billing(value: &Value, overrides: &Value, model_catalog: &Value, agents: &Value, allow_missing: bool) -> Result<Value, String> {
    let invalid = || "PRICE_SETTING_INVALID".to_string();
    value.as_object().ok_or_else(invalid)?;
    if value.get("autoSync").map(|v| v.is_boolean()).unwrap_or(false) == false
        || !value.get("defaults").map(|v| v.is_object()).unwrap_or(false)
        || !value.get("mappings").map(|v| v.is_object()).unwrap_or(false)
        || value.get("mappings").and_then(|m| m.as_object()).map(|m| m.len()).unwrap_or(0) > 5000
    {
        return Err(invalid());
    }
    let valid_target = |key: &Value| -> bool {
        if valid_price_target(key, overrides, model_catalog) {
            return true;
        }
        if !allow_missing {
            return false;
        }
        let Some(key) = key.as_str() else { return false };
        let Some(cut) = key.find('/') else { return false };
        crate::pricing::is_identifier(&json!(&key[..cut])) && crate::pricing::is_identifier(&json!(&key[cut + 1..]))
    };
    let mut defaults = Map::new();
    let mut mappings = Map::new();
    for (agent, entry) in value.get("defaults").and_then(|d| d.as_object()).unwrap() {
        let mode = entry.get("mode").and_then(|m| m.as_str()).unwrap_or("");
        let multiplier = entry.get("multiplier").and_then(|m| m.as_f64()).filter(|m| m.is_finite() && *m >= 0.0 && *m <= 1000.0);
        if agents.get(agent).is_none() || !["actual", "default"].contains(&mode) || multiplier.is_none() || (mode == "default" && !valid_target(entry.get("model").unwrap_or(&Value::Null))) {
            return Err(invalid());
        }
        defaults.insert(agent.clone(), json!({"mode": mode, "multiplier": multiplier, "model": if mode == "default" { entry.get("model") } else { None }}));
    }
    for (key, target) in value.get("mappings").and_then(|m| m.as_object()).unwrap() {
        let cut = key.find('/').ok_or_else(|| "PRICE_MAPPING_INVALID".to_string())?;
        if !crate::pricing::is_identifier(&json!(&key[..cut])) || !crate::pricing::is_identifier(&json!(&key[cut + 1..])) || !valid_target(target) {
            return Err("PRICE_MAPPING_INVALID".to_string());
        }
        mappings.insert(key.clone(), target.clone());
    }
    if let Some(fallback) = value.get("fallback").filter(|v| !v.is_null()) {
        if !valid_target(fallback) {
            return Err(invalid());
        }
    }
    if let Some(partial) = value.get("partialLowerBound") {
        if !partial.is_boolean() {
            return Err(invalid());
        }
    }
    let mut out = Map::new();
    out.insert("autoSync".into(), value.get("autoSync").cloned().unwrap());
    out.insert("defaults".into(), Value::Object(defaults));
    out.insert("mappings".into(), Value::Object(mappings));
    if let Some(fallback) = value.get("fallback").filter(|v| crate::normalize::truthy(v)) {
        out.insert("fallback".into(), fallback.clone());
    }
    if value.get("partialLowerBound") == Some(&json!(true)) {
        out.insert("partialLowerBound".into(), json!(true));
    }
    Ok(Value::Object(out))
}

pub fn coverage_of(pricing: &mut Pricing, records: &[Value]) -> Value {
    let mut value = json!({"records": records.len(), "tokens": 0, "counted": 0, "lower": null, "upper": null, "fallbackTokens": 0, "fallbackUsd": 0, "floorTokens": 0, "floorUsd": 0});
    let mut left: Map<String, Value> = Map::new();
    for record in records {
        let estimate = pricing.estimate(record);
        let total = record.get("totalTokens").and_then(|v| v.as_f64()).unwrap_or(0.0);
        value["tokens"] = json!(value["tokens"].as_f64().unwrap() + total);
        let lower = estimate.get("lower").and_then(|v| v.as_f64());
        match lower {
            None => {
                let reason = estimate.get("reason").and_then(|v| v.as_str()).unwrap_or("");
                let cause = estimate.get("cause").and_then(|v| v.as_str());
                let key = format!("{reason}|{}", cause.unwrap_or(""));
                let row = left.entry(key).or_insert_with(|| json!({"reason": reason, "cause": cause, "tokens": 0, "records": 0}));
                row["tokens"] = json!(row["tokens"].as_f64().unwrap() + total);
                row["records"] = json!(row["records"].as_f64().unwrap() + 1.0);
            }
            Some(lower) => {
                let upper = estimate.get("upper").and_then(|v| v.as_f64()).unwrap_or(lower);
                value["counted"] = json!(value["counted"].as_f64().unwrap() + total);
                value["lower"] = json!(value["lower"].as_f64().unwrap_or(0.0) + lower);
                value["upper"] = json!(value["upper"].as_f64().unwrap_or(0.0) + upper);
                if estimate.get("fallback") == Some(&json!(true)) {
                    value["fallbackTokens"] = json!(value["fallbackTokens"].as_f64().unwrap() + total);
                    value["fallbackUsd"] = json!(value["fallbackUsd"].as_f64().unwrap() + lower);
                }
                if estimate.get("lowerBound") == Some(&json!(true)) {
                    value["floorTokens"] = json!(value["floorTokens"].as_f64().unwrap() + total);
                    value["floorUsd"] = json!(value["floorUsd"].as_f64().unwrap() + lower);
                }
            }
        }
    }
    let mut rows: Vec<Value> = left.values().cloned().collect();
    rows.sort_by(|a, b| b["tokens"].as_f64().unwrap().total_cmp(&a["tokens"].as_f64().unwrap()));
    value.as_object_mut().unwrap().insert("left".into(), json!(rows));
    value
}

pub fn price_basis(model_catalog: &Value, overrides: &Value, remote_catalog: Option<&Value>, billing: &Value) -> Value {
    let base = crate::pricing::catalog();
    json!({
        "version": if remote_catalog.is_some() { format!("{}+models-dev/1", base["version"].as_str().unwrap()) } else { base["version"].as_str().unwrap().to_string() },
        "obtainedAt": remote_catalog.and_then(|r| r.get("obtainedAt")).filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or_else(|| base["obtainedAt"].clone()),
        "sha256": runtime_catalog::hash(model_catalog),
        "overrideSha256": runtime_catalog::hash(overrides),
        "billingSha256": runtime_catalog::hash(billing),
        "currency": "USD",
        "kind": "API-equivalent-estimate",
        "source": remote_catalog.and_then(|r| r.get("source")).filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or_else(|| base["source"].clone()),
        "basis": base["basis"].clone()
    })
}