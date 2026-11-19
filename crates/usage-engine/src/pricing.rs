use serde_json::{json, Map, Value};
use std::sync::OnceLock;

pub const FIELDS: [&str; 4] = ["inputUncached", "output", "cacheRead", "cacheWrite"];
const UNVERIFIED: [&str; 2] = ["reference-unverified", "official-thirdparty-unverified"];

pub fn catalog() -> &'static Value {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("../../../src/m1/prices.json")).expect("embedded prices.json"))
}

pub fn is_identifier(value: &Value) -> bool {
    match value {
        Value::String(text) => {
            let b = text.as_bytes();
            !text.is_empty()
                && text.len() <= 180
                && b[0].is_ascii_alphanumeric()
                && b[1..].iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'.' | b':' | b'/' | b'-'))
        }
        _ => false,
    }
}

pub fn identifier(value: Option<&Value>) -> Result<String, String> {
    match value {
        Some(v) if is_identifier(v) => Ok(v.as_str().unwrap().to_string()),
        _ => Err("PRICE_IDENTIFIER_INVALID".to_string()),
    }
}

fn rate_number(value: Option<&Value>) -> Option<f64> {
    value?.as_f64().filter(|n| n.is_finite())
}

pub fn validate(entry: &Value) -> Result<Value, String> {
    let provider = identifier(entry.get("provider"))?;
    let model = identifier(entry.get("model"))?;
    let pb = provider.as_bytes();
    if provider.is_empty() || provider.len() > 99 || !pb.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-')) {
        return Err("PRICE_IDENTIFIER_INVALID".to_string());
    }
    let mut rates = Map::new();
    for field in FIELDS {
        let value = entry.get(field);
        match value {
            None | Some(Value::Null) => {
                rates.insert(field.into(), Value::Null);
                continue;
            }
            Some(Value::String(s)) if s.is_empty() => {
                rates.insert(field.into(), Value::Null);
                continue;
            }
            _ => {}
        }
        let n = rate_number(value).filter(|n| *n >= 0.0 && *n <= 100_000.0).ok_or("PRICE_RATE_INVALID")?;
        rates.insert(field.into(), json!(n / 1e6));
    }
    if rates["inputUncached"].is_null() || rates["output"].is_null() {
        return Err("PRICE_RATE_INVALID".to_string());
    }
    Ok(json!({"provider": provider, "model": model, "rates": rates}))
}

pub struct Eval {
    pub reason: String,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub cause: Option<String>,
}

impl Eval {
    pub fn to_value(&self) -> Value {
        let mut map = Map::new();
        map.insert("reason".into(), json!(self.reason));
        map.insert("lower".into(), json!(self.lower));
        map.insert("upper".into(), json!(self.upper));
        if let Some(cause) = &self.cause {
            map.insert("cause".into(), json!(cause));
        }
        Value::Object(map)
    }
}

fn incomplete(cause: &str) -> Eval {
    Eval { reason: "usage-incomplete".to_string(), lower: None, upper: None, cause: Some(cause.to_string()) }
}

fn unpriced(reason: &str) -> Eval {
    Eval { reason: reason.to_string(), lower: None, upper: None, cause: None }
}

fn quality_cause(record: &Value) -> String {
    if record.get("usageConflict").map(crate::normalize::truthy).unwrap_or(false) {
        return "conflict".to_string();
    }
    let quality = record.get("quality").and_then(|v| v.as_str()).unwrap_or("");
    if quality != "partial" {
        return if quality.is_empty() { "partial".to_string() } else { quality.to_string() };
    }
    for field in ["inputUncached", "output", "reasoning"] {
        if record.get(field).map(|v| v.is_null()).unwrap_or(true) {
            return format!("missing-{field}");
        }
    }
    "partial".to_string()
}

fn num(record: &Value, field: &str) -> Option<f64> {
    record.get(field)?.as_f64().filter(|n| n.is_finite())
}

fn merged_rates(rates: &Value, extra: &Value, clear_tiers: bool) -> Value {
    let mut map = rates.as_object().cloned().unwrap_or_default();
    if let Some(extra) = extra.as_object() {
        for (key, value) in extra {
            map.insert(key.clone(), value.clone());
        }
    }
    if clear_tiers {
        map.insert("contextTiers".into(), Value::Null);
        map.insert("longContext".into(), Value::Null);
    }
    Value::Object(map)
}

pub fn evaluate(record: &Value, overrides: &Value, resolved: Option<&Value>) -> Eval {
    let key = format!("{}/{}", record.get("provider").and_then(|v| v.as_str()).unwrap_or(""), record.get("model").and_then(|v| v.as_str()).unwrap_or(""));
    let manual = overrides.get(&key).filter(|v| crate::normalize::truthy(v));
    let rates = resolved
        .or(manual)
        .or_else(|| catalog().get("models").and_then(|m| m.get(&key)));
    let Some(rates) = rates else { return unpriced("model-unpriced") };
    let is_manual = manual.is_some() || rates.get("provenance").and_then(|v| v.as_str()) == Some("manual");
    let provenance = rates.get("provenance").and_then(|v| v.as_str()).unwrap_or("");
    if manual.is_none() && UNVERIFIED.contains(&provenance) {
        return unpriced("price-unverified");
    }
    let quality = record.get("quality").and_then(|v| v.as_str()).unwrap_or("");
    if quality != "measured" || record.get("usageConflict").map(crate::normalize::truthy).unwrap_or(false) {
        return incomplete(&quality_cause(record));
    }
    let tiers: Vec<Value> = if is_manual {
        Vec::new()
    } else {
        rates.get("contextTiers").and_then(|v| v.as_array()).cloned().unwrap_or_default()
    };
    let request_input = num(record, "requestInputTokens");
    if !tiers.is_empty() {
        if let Some(request) = request_input {
            if let Some(tier) = tiers.iter().rev().find(|t| t.get("threshold").and_then(|v| v.as_f64()).map(|threshold| request > threshold).unwrap_or(false)) {
                let value = evaluate(record, overrides, Some(&merged_rates(rates, tier.get("rates").unwrap_or(&Value::Null), true)));
                return Eval { reason: if value.reason == "exact" { "long-context".to_string() } else { value.reason }, ..value };
            }
        }
    }
    let mut lower = 0.0;
    let mut upper = 0.0;
    let mut bounded = false;
    let mut reasoning_bounded = false;
    for field in FIELDS {
        let mut count = num(record, field);
        let mut rate = rate_number(rates.get(field));
        if count.is_none() {
            let billing_provider = rates.get("billingProvider").and_then(|v| v.as_str()).unwrap_or("");
            let provider = record.get("provider").and_then(|v| v.as_str()).unwrap_or("");
            let model = record.get("model").and_then(|v| v.as_str()).unwrap_or("");
            let write_free = ["openai", "deepseek", "google"].contains(&billing_provider)
                || ["openai", "deepseek", "google"].contains(&provider)
                || model.contains("deepseek")
                || model.contains("gemini");
            let agent = record.get("agent").and_then(|v| v.as_str()).unwrap_or("");
            let write_in_input = (agent == "codex" && write_free)
                || (agent == "antigravity" && (write_free || billing_provider == "anthropic" || provider == "anthropic"));
            if field == "cacheWrite" && rate == Some(0.0) {
                count = Some(0.0);
            } else if field == "cacheWrite" && write_in_input {
                if rate.is_none() && !is_manual && write_free {
                    count = Some(0.0);
                    rate = Some(0.0);
                } else if rate.map(|r| r > 0.0).unwrap_or(false) && rate_number(rates.get("inputUncached")).is_some() {
                    bounded = true;
                    continue;
                } else {
                    return incomplete("missing-cacheWrite");
                }
            } else {
                return incomplete(&format!("missing-{field}"));
            }
        }
        let count = count.unwrap();
        if count > 0.0 && rate.is_none() {
            return unpriced("rate-missing");
        }
        let reasoning_rate = rate_number(rates.get("reasoning"));
        if field == "output" {
            if let Some(reasoning_rate) = reasoning_rate {
                if rate != Some(reasoning_rate) {
                    // JS coerces a null output rate to 0 inside these expressions.
                    let rate = rate.unwrap_or(0.0);
                    match num(record, "reasoning") {
                        None => {
                            lower += count * rate.min(reasoning_rate);
                            upper += count * rate.max(reasoning_rate);
                            reasoning_bounded = true;
                        }
                        Some(reasoning) => {
                            if reasoning > count {
                                return incomplete("invalid-reasoning");
                            }
                            lower += (count - reasoning) * rate + reasoning * reasoning_rate;
                            upper = lower;
                        }
                    }
                    continue;
                }
            }
        }
        lower += count * rate.unwrap_or(0.0);
        upper += count * rate.unwrap_or(0.0);
    }
    if bounded {
        let difference = num(record, "inputUncached").unwrap_or(0.0) * (rate_number(rates.get("cacheWrite")).unwrap_or(0.0) - rate_number(rates.get("inputUncached")).unwrap_or(0.0));
        lower += difference.min(0.0);
        upper += difference.max(0.0);
    }
    if !tiers.is_empty() && request_input.is_none() {
        let estimates: Vec<Eval> = tiers
            .iter()
            .map(|t| evaluate(record, overrides, Some(&merged_rates(rates, t.get("rates").unwrap_or(&Value::Null), true))))
            .collect();
        if estimates.iter().any(|v| v.lower.is_none()) {
            return unpriced("rate-missing");
        }
        let mut low = lower;
        let mut high = upper;
        for estimate in &estimates {
            low = low.min(estimate.lower.unwrap());
            high = high.max(estimate.upper.unwrap());
        }
        return Eval { reason: "context-unreported".to_string(), lower: Some(low), upper: Some(high), cause: None };
    }
    let long = if is_manual || !tiers.is_empty() { None } else { rates.get("longContext").filter(|v| v.is_object()) };
    if let Some(long) = long {
        let threshold = rate_number(rates.get("longContextThreshold")).filter(|t| *t != 0.0).unwrap_or(272_000.0);
        if request_input.map(|r| r > threshold).unwrap_or(false) {
            let old = evaluate(record, overrides, Some(&merged_rates(rates, long, true)));
            return Eval { reason: if old.reason == "exact" { "long-context".to_string() } else { old.reason }, ..old };
        }
        if request_input.is_none() {
            let high = evaluate(record, overrides, Some(&merged_rates(rates, long, true)));
            if high.lower.is_none() {
                return high;
            }
            return Eval {
                reason: "context-unreported".to_string(),
                lower: Some(lower.min(high.lower.unwrap())),
                upper: Some(upper.max(high.upper.unwrap())),
                cause: None,
            };
        }
    }
    if !is_manual {
        if let Some(multiplier) = rate_number(rates.get("offPeakMultiplier")).filter(|m| *m != 0.0) {
            return Eval { reason: "time-tariff-unreported".to_string(), lower: Some(lower * multiplier), upper: Some(upper), cause: None };
        }
    }
    Eval {
        reason: if reasoning_bounded { "reasoning-unreported" } else if bounded { "cache-write-unreported" } else { "exact" }.to_string(),
        lower: Some(lower),
        upper: Some(upper),
        cause: None,
    }
}

pub fn lower_bound(record: &Value, rates: &Value) -> Option<f64> {
    let mut total = 0.0;
    let mut any = false;
    for field in FIELDS {
        let count = num(record, field);
        let rate = rate_number(rates.get(field));
        if let (Some(count), Some(rate)) = (count, rate) {
            if count > 0.0 {
                total += count * rate;
                any = true;
            }
        }
    }
    if any {
        Some(total)
    } else {
        None
    }
}

pub fn price(record: &Value, overrides: &Value) -> Option<f64> {
    let value = evaluate(record, overrides, None);
    if value.lower == value.upper {
        value.lower
    } else {
        None
    }
}