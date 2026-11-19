// Remaining first-batch local usage projections. No config/model guessing or IO.
use crate::js_json::stringify;
use crate::normalize::{digest, normalize, number, timestamp};
use crate::parsed::{object, Parsed};
use crate::sessions::observe;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;

fn id(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) if !text.is_empty() && text.encode_utf16().count() <= 512 && !text.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}') => Some(text.clone()),
        _ => None,
    }
}

fn add(parsed: &mut Parsed, agent: &str, usage: &Value, info: &Value, salt: &str, semantics: &str) -> bool {
    if !crate::normalize::truthy(info.get("id").unwrap_or(&Value::Null)) {
        parsed.warn("SOURCE_ROW_INVALID");
        return false;
    }
    let record = normalize(agent, usage, info, salt, semantics);
    let mut record = match record {
        Some(record) => record,
        None => {
            parsed.warn("SOURCE_ROW_INVALID");
            return false;
        }
    };
    if usage.as_object().map(|m| m.values().any(|v| !v.is_null() && number(Some(v)).is_none())).unwrap_or(false) {
        record["quality"] = json!("partial");
        parsed.warn("SOURCE_ROW_INVALID");
    }
    parsed.records.push(record);
    true
}

struct Evidence {
    separate: bool,
    known: bool,
    total: Option<i64>,
}

// Resolve overlap only when the reported total proves it; a zero total is never
// treated as a hint.
fn output_info(input: Option<&Value>, output: Option<&Value>, read: Option<&Value>, write: Option<&Value>, reasoning: Option<&Value>, total: Option<&Value>, inclusive: bool) -> Evidence {
    let base = match (number(input), number(output)) {
        (Some(i), Some(o)) => Some(i + o + if inclusive { 0 } else { number(read).unwrap_or(0) + number(write).unwrap_or(0) }),
        _ => None,
    };
    let r = number(reasoning);
    let t = number(total);
    let separate = matches!(r, Some(r) if r > 0) && base.is_some() && matches!((t, base), (Some(t), Some(b)) if t == b + r.unwrap());
    let known = r == Some(0) || matches!((t, base), (Some(t), Some(b)) if t == b) || separate;
    Evidence { separate, known, total: t }
}

fn preserve_overlap(parsed: &mut Parsed, added: bool, evidence: &Evidence) {
    if !added || evidence.known {
        return;
    }
    let record = parsed.records.last_mut().unwrap();
    record["output"] = Value::Null;
    if record.get("quality").and_then(|v| v.as_str()) == Some("measured") {
        record["quality"] = json!("partial");
    }
    if let Some(total) = evidence.total {
        if total > 0 {
            record["totalTokens"] = json!(total);
        }
    }
    parsed.warn("USAGE_UNREPORTED");
}

pub fn qwen(objects: &[Value], salt: &str) -> Parsed {
    let mut parsed = Parsed::new();
    let mut occurrences: HashMap<String, i64> = HashMap::new();
    for row in objects {
        let u = match row.get("usageMetadata") {
            Some(u) if row.get("type").and_then(|v| v.as_str()) == Some("assistant") && object(Some(u)) => u,
            _ => continue,
        };
        let session = id(row.get("sessionId"));
        let time = timestamp(row.get("timestamp"));
        let (session, time) = match (session, time) {
            (Some(s), Some(t)) => (s, t),
            _ => {
                parsed.warn("SOURCE_ROW_INVALID");
                continue;
            }
        };
        let key = stringify(&json!([session, time]));
        let occurrence = occurrences.get(&key).copied().unwrap_or(0);
        occurrences.insert(key, occurrence + 1);
        let evidence = output_info(u.get("promptTokenCount"), u.get("candidatesTokenCount"), u.get("cachedContentTokenCount"), None, u.get("thoughtsTokenCount"), u.get("totalTokenCount"), true);
        let added = add(
            &mut parsed,
            "qwen",
            &json!({"input": u.get("promptTokenCount"), "output": u.get("candidatesTokenCount"), "cacheReadTokens": u.get("cachedContentTokenCount"),
                "reasoning": u.get("thoughtsTokenCount"), "totalTokens": u.get("totalTokenCount")}),
            &json!({"id": stringify(&json!([session, time, occurrence])), "session": session, "model": row.get("model"), "time": time,
                "entry": "cli", "outputExcludesReasoning": evidence.separate}),
            salt,
            "inclusive",
        );
        preserve_overlap(&mut parsed, added, &evidence);
        if let Some(meta) = observe("qwen", Some(&json!(session)), None, salt, None) {
            parsed.sessions.push(meta);
        }
    }
    parsed
}

pub fn kilo(objects: &[Value], salt: &str) -> Parsed {
    let mut parsed = Parsed::new();
    for row in objects {
        let u = match row.get("tokens") {
            Some(u) if row.get("role").and_then(|v| v.as_str()) == Some("assistant") && object(Some(u)) => u,
            _ => continue,
        };
        let session = id(row.get("sessionID").filter(|v| !v.is_null()).or_else(|| row.get("session_id")));
        let message = id(row.get("id"));
        let time = row.get("time").and_then(|t| t.get("created")).filter(|v| !v.is_null()).or_else(|| row.get("timestamp"));
        let evidence = output_info(u.get("input"), u.get("output"), u.get("cache").and_then(|c| c.get("read")), u.get("cache").and_then(|c| c.get("write")), u.get("reasoning"), u.get("total"), false);
        let added = add(
            &mut parsed,
            "kilo",
            &json!({"input": u.get("input"), "output": u.get("output"), "cacheReadTokens": u.get("cache").and_then(|c| c.get("read")),
                "cacheWriteTokens": u.get("cache").and_then(|c| c.get("write")), "reasoning": u.get("reasoning"), "totalTokens": u.get("total")}),
            &json!({"id": match (&session, &message) { (Some(s), Some(m)) => json!(stringify(&json!(["cli", s, m]))), _ => Value::Null },
                "session": session, "model": row.get("modelID"), "provider": row.get("providerID"), "time": time,
                "entry": "cli", "outputExcludesReasoning": evidence.separate}),
            salt,
            "exclusive",
        );
        preserve_overlap(&mut parsed, added, &evidence);
        if added {
            let record = parsed.records.last_mut().unwrap();
            record["sharedKey"] = json!(digest(salt, &stringify(&json!(["shared-opencode-schema/2", message, record["timestamp"], record["model"]]))));
            let message_text = message.clone().unwrap_or_else(|| "null".to_string());
            let mut ids: Vec<Value> = ["opencode", "mimo"].iter().map(|agent| json!(digest(salt, &format!("{agent}:{message_text}")))).collect();
            ids.push(record["id"].clone());
            record["sharedRecordIds"] = Value::Array(ids);
        }
        if let Some(meta) = observe("kilo", session.as_ref().map(|s| json!(s)).as_ref(), None, salt, None) {
            parsed.sessions.push(meta);
        }
    }
    parsed
}

pub fn kilo_database(data: &[Value], salt: &str) -> Parsed {
    let mut objects = Vec::new();
    let mut invalid = false;
    for row in data {
        let value: Value = match row.get("data").and_then(|v| v.as_str()).and_then(|text| serde_json::from_str(text).ok()) {
            Some(value) => value,
            None => {
                invalid = true;
                continue;
            }
        };
        if !object(Some(&value)) {
            invalid = true;
            continue;
        }
        objects.push(json!({"id": row.get("id"), "session_id": row.get("session_id"), "role": value.get("role"), "tokens": value.get("tokens"),
            "modelID": value.get("modelID"), "providerID": value.get("providerID"), "time": value.get("time")}));
    }
    let mut parsed = kilo(&objects, salt);
    if invalid {
        parsed.warn("SOURCE_ROW_INVALID");
    }
    parsed
}

pub fn kimi(objects: &[Value], salt: &str, file: &str) -> Parsed {
    let mut parsed = Parsed::new();
    // JS splits by path.sep literally (backslash on Windows), not by both separators.
    let parts: Vec<&str> = file.split(std::path::MAIN_SEPARATOR).collect();
    let at = |back: usize| -> &str { parts.len().checked_sub(back).and_then(|i| parts.get(i)).copied().unwrap_or("") };
    let agent_layout = at(3) == "agents";
    let session = id(Some(&json!(if agent_layout { at(4) } else { at(2) })));
    let lane = if agent_layout { id(Some(&json!(at(2)))) } else { Some("main".to_string()) };
    let mut occurrences: HashMap<String, i64> = HashMap::new();
    for row in objects {
        let modern = row.get("type").and_then(|v| v.as_str()) == Some("usage.record");
        if modern && row.get("usageScope").and_then(|v| v.as_str()) != Some("turn") {
            continue;
        }
        if !modern && row.get("message").and_then(|m| m.get("type")).and_then(|v| v.as_str()) != Some("StatusUpdate") {
            continue;
        }
        let payload = row.get("message").and_then(|m| m.get("payload"));
        let u = if modern { row.get("usage") } else { payload.and_then(|p| p.get("token_usage")) };
        if !object(u) {
            continue;
        }
        let u = u.unwrap();
        let time = if modern {
            timestamp(row.get("time"))
        } else if row.get("timestamp").map(|v| v.is_number()).unwrap_or(false) {
            timestamp(Some(&json!(row["timestamp"].as_f64().unwrap() * 1000.0)))
        } else {
            None
        };
        let (session, lane, time) = match (&session, &lane, time) {
            (Some(s), Some(l), Some(t)) => (s.clone(), l.clone(), t),
            _ => {
                parsed.warn("SOURCE_ROW_INVALID");
                continue;
            }
        };
        let key = stringify(&json!([session, lane, time]));
        let occurrence = occurrences.get(&key).copied().unwrap_or(0);
        occurrences.insert(key, occurrence + 1);
        let message = if modern { None } else { id(payload.and_then(|p| p.get("message_id"))) };
        let model = if modern {
            row.get("model").and_then(|v| v.as_str()).filter(|m| !m.starts_with("__")).map(|m| json!(m))
        } else {
            None
        };
        let mut usage = json!({"input": if modern { u.get("inputOther") } else { u.get("input_other") }, "output": u.get("output"),
            "cacheReadTokens": if modern { u.get("inputCacheRead") } else { u.get("input_cache_read") },
            "cacheWriteTokens": if modern { u.get("inputCacheCreation") } else { u.get("input_cache_creation") }});
        if !modern {
            usage["totalTokens"] = u.get("total").cloned().unwrap_or(Value::Null);
        }
        add(
            &mut parsed,
            "kimi",
            &usage,
            &json!({"id": stringify(&json!([session, lane, if modern { "code" } else { "cli" }, message.clone().unwrap_or_else(|| time.clone()), if message.is_some() { 0 } else { occurrence }])),
                "session": session, "model": model, "time": time, "entry": "cli"}),
            salt,
            "exclusive",
        );
    }
    if let Some(meta) = observe("kimi", session.as_ref().map(|s| json!(s)).as_ref(), None, salt, None) {
        parsed.sessions.push(meta);
    }
    parsed
}

pub fn continue_rows(data: &[Value], salt: &str) -> Parsed {
    let mut parsed = Parsed::new();
    let pattern = Regex::new(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$").unwrap();
    for row in data {
        let time = row
            .get("timestamp")
            .and_then(|v| v.as_str())
            .filter(|t| pattern.is_match(t))
            .map(|t| format!("{}Z", t.replace(' ', "T")));
        let id_value = match (row.get("id").and_then(|v| v.as_i64()), &time) {
            (Some(id), Some(time)) if id.abs() <= 9_007_199_254_740_991 => json!(stringify(&json!([id, time]))),
            _ => Value::Null,
        };
        let added = add(
            &mut parsed,
            "continue",
            &json!({"input": row.get("tokens_prompt"), "output": row.get("tokens_generated")}),
            &json!({"id": id_value, "model": row.get("model"), "provider": row.get("provider"), "time": time, "entry": "desktop"}),
            salt,
            "inclusive",
        );
        if added {
            let record = parsed.records.last_mut().unwrap();
            record["quality"] = json!("partial");
            record["measurementBasis"] = json!("client-estimated");
            parsed.warn("SOURCE_USAGE_ESTIMATED");
        }
    }
    parsed
}