use crate::js_json::stringify;
use crate::time::{iso_from_ms, parse_iso};
use hmac::{Hmac, Mac};
use serde_json::{json, Map, Value};
use sha2::Sha256;

const MAX_SAFE: i64 = 9_007_199_254_740_991;

pub fn number(value: Option<&Value>) -> Option<i64> {
    let n = value?.as_f64()?;
    if n.is_finite() && n >= 0.0 && n.fract() == 0.0 && n <= MAX_SAFE as f64 {
        Some(n as i64)
    } else {
        None
    }
}

pub fn timestamp(value: Option<&Value>) -> Option<String> {
    let ms = match value? {
        Value::Number(n) => {
            let mut v = n.as_f64()?;
            if !v.is_finite() {
                return None;
            }
            if v < 1e11 {
                v *= 1000.0;
            }
            let v = v.trunc();
            if v.abs() > 8_640_000_000_000_000.0 {
                return None;
            }
            v as i64
        }
        Value::String(text) => parse_iso(text)?,
        _ => return None,
    };
    Some(iso_from_ms(ms))
}

fn ascii_pattern(text: &str, max: usize, extra: &[u8]) -> bool {
    !text.is_empty()
        && text.len() <= max
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-' || extra.contains(&b))
}

pub fn provider(model: &str, explicit: Option<&Value>) -> String {
    if let Some(Value::String(text)) = explicit {
        if ascii_pattern(text, 99, &[]) {
            return text.clone();
        }
    }
    let lower = model.to_ascii_lowercase();
    if lower.starts_with("gpt") || lower.starts_with("o1-") || lower.starts_with("o3-") || lower.starts_with("o4-") {
        return "openai".to_string();
    }
    if lower.starts_with("claude-") {
        return "anthropic".to_string();
    }
    if lower.starts_with("mimo-") {
        return "mimo".to_string();
    }
    if lower.starts_with("glm-") {
        return "zai".to_string();
    }
    if lower.starts_with("deepseek-") {
        return "deepseek".to_string();
    }
    if lower.starts_with("gemini-") {
        return "google".to_string();
    }
    "unknown".to_string()
}

pub fn digest(salt: &str, value: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(salt.as_bytes()).expect("hmac accepts any key length");
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn scalar_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => crate::js_json::stringify(&Value::Number(n.clone())),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

pub fn session_key(agent: &str, session: Option<&Value>, salt: &str) -> Value {
    match session {
        Some(value) if truthy(value) => json!(digest(salt, &format!("{agent}:session:{}", scalar_string(value)))),
        _ => Value::Null,
    }
}

pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|v| v != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

fn pick<'a>(usage: &'a Value, paths: &[&[&str]]) -> Option<&'a Value> {
    for path in paths {
        let mut current = usage;
        let mut found = true;
        for key in *path {
            match current.get(key) {
                Some(next) => current = next,
                None => {
                    found = false;
                    break;
                }
            }
        }
        if found && !current.is_null() {
            return Some(current);
        }
    }
    None
}

pub fn normalize(agent: &str, usage: &Value, info: &Value, salt: &str, semantics: &str) -> Option<Value> {
    let input = number(pick(usage, &[&["input_tokens"], &["prompt_tokens"], &["inputTokens"], &["input"]]));
    let raw_output = number(pick(usage, &[&["output_tokens"], &["completion_tokens"], &["outputTokens"], &["output"]]));
    let read = number(pick(usage, &[
        &["cached_input_tokens"],
        &["cache_read_input_tokens"],
        &["cacheReadTokens"],
        &["prompt_cache_hit_tokens"],
        &["prompt_tokens_details", "cached_tokens"],
        &["cache", "read"],
    ]));
    let write = number(pick(usage, &[
        &["cache_creation_input_tokens"],
        &["cache_write_tokens"],
        &["cacheWriteTokens"],
        &["prompt_tokens_details", "cache_write_tokens"],
        &["cache", "write"],
    ]));
    let reasoning = number(pick(usage, &[
        &["reasoning_output_tokens"],
        &["reasoningTokens"],
        &["completion_tokens_details", "reasoning_tokens"],
        &["reasoning"],
    ]));
    let disjoint_reasoning = agent == "opencode" || agent == "mimo" || info.get("outputExcludesReasoning") == Some(&json!(true));
    let output = raw_output.map(|v| v + if disjoint_reasoning { reasoning.unwrap_or(0) } else { 0 });
    let mut uncached = input;
    if semantics == "inclusive" {
        if let Some(v) = input {
            uncached = Some((v - read.unwrap_or(0) - write.unwrap_or(0)).max(0));
        }
    }
    let reported = number(pick(usage, &[&["total_tokens"], &["totalTokens"], &["total"]]));
    let computed = match (input, output) {
        (Some(i), Some(o)) => Some(i + o + if semantics == "exclusive" { read.unwrap_or(0) + write.unwrap_or(0) } else { 0 }),
        _ => None,
    };
    let total = computed.or(reported)?;
    let time = timestamp(info.get("time"))?;
    if total > MAX_SAFE {
        return None;
    }
    let model = match info.get("model") {
        Some(Value::String(text))
            if ascii_pattern(text, 179, &[b':', b'/'])
                && !text.starts_with('/')
                && !text.starts_with('\\')
                && !(text.len() >= 3 && text.as_bytes()[1] == b':' && (text.as_bytes()[2] == b'/' || text.as_bytes()[2] == b'\\') && text.as_bytes()[0].is_ascii_alphabetic()) =>
        {
            text.clone()
        }
        _ => "unknown".to_string(),
    };
    let id = info.get("id").filter(|v| truthy(v));
    let key = match id {
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
        None => stringify(&json!([info.get("time"), info.get("session"), model, usage])),
    };
    let session = info.get("session");
    let entry = info.get("entry").filter(|v| truthy(v)).cloned().unwrap_or(json!("unknown"));
    let shared = (agent == "opencode" || agent == "mimo") && id.is_some();
    let quality = if semantics == "inclusive" && input.is_some() && read.unwrap_or(0) + write.unwrap_or(0) > input.unwrap() {
        "invalid-cache"
    } else if !disjoint_reasoning && output.is_some() && reasoning.is_some() && reasoning.unwrap() > output.unwrap() {
        "invalid-reasoning"
    } else if computed.is_some() && reported.is_some() && computed != reported {
        "total-mismatch"
    } else if input.is_none() || output.is_none() || (disjoint_reasoning && reasoning.is_none()) {
        "partial"
    } else {
        "measured"
    };
    let mut record = Map::new();
    record.insert("id".into(), json!(digest(salt, &format!("{agent}:{key}"))));
    record.insert("sessionKey".into(), session_key(agent, session, salt));
    record.insert("agent".into(), json!(agent));
    record.insert("entry".into(), entry);
    record.insert("model".into(), json!(model));
    record.insert("provider".into(), json!(provider(&model, info.get("provider"))));
    record.insert("timestamp".into(), json!(time));
    record.insert("inputUncached".into(), json!(uncached));
    record.insert("output".into(), json!(output));
    record.insert("cacheRead".into(), json!(read));
    record.insert("cacheWrite".into(), json!(write));
    record.insert("reasoning".into(), json!(reasoning));
    record.insert("totalTokens".into(), json!(total));
    record.insert(
        "semantics".into(),
        json!({
            "input": semantics,
            "sourceOutput": if disjoint_reasoning { "excludes-reasoning" } else { "includes-reasoning" },
            "reasoning": "subset-of-normalized-output"
        }),
    );
    record.insert(
        "sharedKey".into(),
        if shared {
            json!(digest(salt, &stringify(&json!(["shared-opencode-schema/2", id, time, model]))))
        } else {
            Value::Null
        },
    );
    record.insert(
        "sharedRecordIds".into(),
        if shared {
            json!(["opencode", "mimo"].iter().map(|source| digest(salt, &format!("{source}:{key}"))).collect::<Vec<_>>())
        } else {
            Value::Null
        },
    );
    record.insert("quality".into(), json!(quality));
    Some(Value::Object(record))
}