// Usage-only projections (AGENT-BATCH1-CONTRACT-20261102.md). Never inspect
// message content, prompts, tools, manifests, credentials or account fields.
use crate::js_json::stringify;
use crate::normalize::{normalize, number, timestamp};
use crate::parsed::{object, truthy, Parsed};
use crate::pathx as path;
use crate::sessions::observe;
use crate::time::parse_iso;
use crate::usage_snapshot::select_usage_snapshot;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn identity(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) if !text.is_empty() && text.encode_utf16().count() <= 512 && !text.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}') => Some(text.clone()),
        _ => None,
    }
}

fn add(parsed: &mut Parsed, agent: &str, usage: &Value, info: &Value, salt: &str, semantics: &str) {
    if !object(Some(usage)) || !truthy(info.get("id")) || !truthy(info.get("session")) {
        parsed.warn("SOURCE_ROW_INVALID");
        return;
    }
    let record = normalize(agent, usage, info, salt, semantics);
    let mut record = match record {
        Some(record) => record,
        None => {
            parsed.warn("SOURCE_ROW_INVALID");
            return;
        }
    };
    if usage.as_object().unwrap().values().any(|v| !v.is_null() && number(Some(v)).is_none()) {
        record["quality"] = json!("partial");
        parsed.warn("SOURCE_ROW_INVALID");
    }
    parsed.records.push(record);
}

pub fn pi(objects: &[Value], salt: &str) -> Parsed {
    let mut parsed = Parsed::new();
    let header = objects.iter().find(|row| row.get("type").and_then(|v| v.as_str()) == Some("session"));
    let header = match header {
        Some(h) if h.get("version").and_then(|v| v.as_i64()) == Some(3) && identity(h.get("id")).is_some() => h,
        _ => {
            parsed.warn("SOURCE_FORMAT_UNSUPPORTED");
            return parsed;
        }
    };
    let session = header["id"].as_str().unwrap();
    for row in objects {
        let message = match row.get("message") {
            Some(m) if row.get("type").and_then(|v| v.as_str()) == Some("message") && m.get("role").and_then(|v| v.as_str()) == Some("assistant") && object(m.get("usage")) => m,
            _ => continue,
        };
        let usage = &message["usage"];
        let time = timestamp(message.get("timestamp").filter(|v| !v.is_null()).or_else(|| row.get("timestamp")));
        let id = identity(row.get("id"));
        let id_value = match (&id, &time) {
            (Some(id), Some(time)) => json!(stringify(&json!([id, time]))),
            _ => Value::Null,
        };
        add(
            &mut parsed,
            "pi",
            &json!({"input": usage.get("input"), "output": usage.get("output"), "cacheReadTokens": usage.get("cacheRead"),
                "cacheWriteTokens": usage.get("cacheWrite"), "reasoning": usage.get("reasoning"), "totalTokens": usage.get("totalTokens")}),
            &json!({"id": id_value, "session": session, "model": message.get("model"), "provider": message.get("provider"), "time": time, "entry": "cli"}),
            salt,
            "exclusive",
        );
    }
    if let Some(meta) = observe("pi", Some(&json!(session)), header.get("cwd"), salt, None) {
        parsed.sessions.push(meta);
    }
    parsed
}

pub fn cline(objects: &[Value], salt: &str, file: &str, agent: &str) -> Parsed {
    let mut parsed = Parsed::new();
    let root = objects.first();
    let cli = file.ends_with(".messages.json");
    let session = if cli { identity(root.and_then(|r| r.get("sessionId"))) } else { identity(Some(&json!(path::basename(&path::dirname(file))))) };
    let messages = if cli { root.and_then(|r| r.get("messages")) } else { root };
    let messages = match messages.and_then(|v| v.as_array()) {
        Some(messages) if session.is_some() => messages,
        _ => {
            parsed.warn("SOURCE_FORMAT_UNSUPPORTED");
            return parsed;
        }
    };
    let session = session.unwrap();
    let cutoff = parse_iso("2025-11-02T00:00:00Z").unwrap();
    for row in messages {
        if cli {
            let metrics = match row.get("metrics") {
                Some(m) if row.get("role").and_then(|v| v.as_str()) == Some("assistant") && object(Some(m)) => m,
                _ => continue,
            };
            let id = identity(row.get("id")).map(|id| json!(stringify(&json!(["cli", session, id])))).unwrap_or(Value::Null);
            add(
                &mut parsed,
                agent,
                &json!({"inputTokens": metrics.get("inputTokens"), "outputTokens": metrics.get("outputTokens"),
                    "cacheReadTokens": metrics.get("cacheReadTokens"), "cacheWriteTokens": metrics.get("cacheWriteTokens")}),
                &json!({"id": id, "session": session, "model": row.get("modelInfo").and_then(|m| m.get("id")),
                    "provider": row.get("modelInfo").and_then(|m| m.get("provider")), "time": row.get("ts"), "entry": "cli"}),
                salt,
                "inclusive",
            );
        } else {
            if row.get("type").and_then(|v| v.as_str()) != Some("say") || row.get("say").and_then(|v| v.as_str()) != Some("api_req_started") {
                continue;
            }
            let u: Value = match row.get("text").and_then(|v| v.as_str()).and_then(|text| serde_json::from_str(text).ok()) {
                Some(u) => u,
                None => {
                    parsed.warn("SOURCE_ROW_INVALID");
                    continue;
                }
            };
            if !object(Some(&u)) {
                parsed.warn("SOURCE_ROW_INVALID");
                continue;
            }
            if ["tokensIn", "tokensOut", "cacheReads", "cacheWrites"].iter().all(|key| u.get(*key).map(|v| v.is_null()).unwrap_or(true)) {
                continue;
            }
            let time = timestamp(row.get("ts"));
            let inclusive = agent == "kilo"
                && (time.as_deref().and_then(parse_iso).map(|ms| ms >= cutoff).unwrap_or(false) || u.get("apiProtocol").and_then(|v| v.as_str()) == Some("openai"));
            if agent == "kilo" && !inclusive {
                parsed.warn("SOURCE_FORMAT_UNSUPPORTED");
                continue;
            }
            let id = time.as_ref().map(|t| json!(stringify(&json!(["ide", session, t])))).unwrap_or(Value::Null);
            add(
                &mut parsed,
                agent,
                &json!({"input": u.get("tokensIn"), "output": u.get("tokensOut"), "cacheReadTokens": u.get("cacheReads"), "cacheWriteTokens": u.get("cacheWrites")}),
                &json!({"id": id, "session": session, "model": row.get("modelInfo").and_then(|m| m.get("modelId")),
                    "provider": row.get("modelInfo").and_then(|m| m.get("providerId")), "time": time, "entry": "desktop"}),
                salt,
                if inclusive { "inclusive" } else { "exclusive" },
            );
        }
    }
    if let Some(meta) = observe(agent, Some(&json!(session)), None, salt, None) {
        parsed.sessions.push(meta);
    }
    parsed
}

pub fn copilot_state(objects: &[Value], salt: &str, file: &str) -> Parsed {
    let mut parsed = Parsed::new();
    let session = match identity(Some(&json!(path::basename(&path::dirname(file))))) {
        Some(session) => session,
        None => {
            parsed.warn("SOURCE_ROW_INVALID");
            return parsed;
        }
    };
    let mut snapshots: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for row in objects {
        if row.get("type").and_then(|v| v.as_str()) != Some("session.shutdown") {
            continue;
        }
        let metrics = row.get("data").and_then(|d| d.get("modelMetrics"));
        if !object(metrics) {
            parsed.warn("USAGE_UNREPORTED");
            continue;
        }
        for (model, metrics) in metrics.unwrap().as_object().unwrap() {
            let u = metrics.get("usage");
            if !object(u) {
                parsed.warn("USAGE_UNREPORTED");
                continue;
            }
            let mut projected = Parsed::new();
            let id = identity(row.get("id")).map(|id| json!(stringify(&json!([session, model, id])))).unwrap_or(Value::Null);
            add(
                &mut projected,
                "copilot",
                &json!({"inputTokens": u.unwrap().get("inputTokens"), "outputTokens": u.unwrap().get("outputTokens"),
                    "cacheReadTokens": u.unwrap().get("cacheReadTokens"), "cacheWriteTokens": u.unwrap().get("cacheWriteTokens"),
                    "reasoningTokens": u.unwrap().get("reasoningTokens")}),
                &json!({"id": id, "session": session, "model": model, "time": row.get("timestamp"), "entry": "cli"}),
                salt,
                "inclusive",
            );
            for code in &projected.warnings {
                parsed.warn(code);
            }
            let current = match projected.records.first() {
                Some(current) => current.clone(),
                None => continue,
            };
            let id = current["id"].as_str().unwrap().to_string();
            let choice = select_usage_snapshot(snapshots.get(&id), &current);
            if let Some(issue) = choice.issue {
                parsed.warn(issue);
            }
            if !snapshots.contains_key(&id) {
                order.push(id.clone());
            }
            snapshots.insert(id, choice.record);
        }
    }
    parsed.records = order.iter().map(|id| snapshots[id].clone()).collect();
    if let Some(meta) = observe("copilot", Some(&json!(session)), None, salt, None) {
        parsed.sessions.push(meta);
    }
    parsed
}

const INTERVAL_FIELDS: [&str; 6] = ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"];

pub fn copilot_intervals(records: &[Value]) -> Parsed {
    let mut parsed = Parsed::new();
    let mut snapshots: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for record in records {
        let mut raw = record.as_object().cloned().unwrap_or_default();
        if let Some(Value::Object(cumulative)) = record.get("copilotCumulative") {
            for (key, value) in cumulative {
                raw.insert(key.clone(), value.clone());
            }
        }
        let raw = Value::Object(raw);
        let id = raw.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let choice = select_usage_snapshot(snapshots.get(&id), &raw);
        if let Some(issue) = choice.issue {
            parsed.warn(issue);
        }
        if !snapshots.contains_key(&id) {
            order.push(id.clone());
        }
        snapshots.insert(id, choice.record);
    }
    let mut sorted: Vec<Value> = order.iter().map(|id| snapshots[id].clone()).collect();
    sorted.sort_by(|a, b| {
        let at = a.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        let bt = b.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        at.cmp(bt).then_with(|| a.get("id").and_then(|v| v.as_str()).unwrap_or("").cmp(b.get("id").and_then(|v| v.as_str()).unwrap_or("")))
    });
    let mut previous: HashMap<String, Value> = HashMap::new();
    for current in sorted {
        let key = stringify(&json!([current.get("sessionKey"), current.get("model")]));
        let mut diff = current.as_object().cloned().unwrap_or_default();
        let cumulative: Map<String, Value> = INTERVAL_FIELDS
            .iter()
            .chain(["quality"].iter())
            .map(|field| (field.to_string(), current.get(*field).cloned().unwrap_or(Value::Null)))
            .collect();
        diff.insert("copilotCumulative".into(), Value::Object(cumulative));
        if let Some(before) = previous.get(&key) {
            let shrunk = INTERVAL_FIELDS.iter().any(|field| {
                let c = current.get(*field).and_then(|v| v.as_f64());
                let b = before.get(*field).and_then(|v| v.as_f64());
                matches!((c, b), (Some(c), Some(b)) if c < b)
            });
            if shrunk {
                parsed.warn("SOURCE_USAGE_REGRESSION");
                continue;
            }
            for field in INTERVAL_FIELDS {
                let c = current.get(field).and_then(|v| v.as_f64());
                let b = before.get(field).and_then(|v| v.as_f64());
                diff.insert(field.into(), match (c, b) { (Some(c), Some(b)) => json!(c - b), _ => Value::Null });
            }
            if INTERVAL_FIELDS.iter().any(|field| current.get(*field).map(|v| !v.is_null()).unwrap_or(false) && before.get(*field).map(|v| v.is_null()).unwrap_or(true)) {
                diff.insert("quality".into(), json!("partial"));
            }
        }
        previous.insert(key, current);
        diff.insert("accountingKind".into(), json!("session-model-interval"));
        parsed.records.push(Value::Object(diff));
    }
    parsed
}

fn otel_time(row: &Value) -> Option<String> {
    let value = ["startTime", "endTime", "hrTime", "timestamp"]
        .iter()
        .filter_map(|key| row.get(*key))
        .find(|v| !v.is_null());
    if let Some(Value::Array(items)) = value {
        if items.len() == 2 && items.iter().all(|v| v.as_f64().map(|f| f.is_finite()).unwrap_or(false)) {
            return timestamp(Some(&json!(items[0].as_f64().unwrap() * 1000.0 + items[1].as_f64().unwrap() / 1e6)));
        }
    }
    timestamp(value)
}

pub fn copilot_otel(objects: &[Value], salt: &str) -> Parsed {
    let mut parsed = Parsed::new();
    for row in objects {
        let a = row.get("attributes");
        if row.get("type").and_then(|v| v.as_str()) != Some("span") || !object(a) || a.unwrap().get("gen_ai.operation.name").and_then(|v| v.as_str()) != Some("chat") {
            continue;
        }
        let a = a.unwrap();
        if a.get("gen_ai.usage.input_tokens").map(|v| v.is_null()).unwrap_or(true) && a.get("gen_ai.usage.output_tokens").map(|v| v.is_null()).unwrap_or(true) {
            parsed.warn("USAGE_UNREPORTED");
            continue;
        }
        let session = identity(a.get("gen_ai.conversation.id")).or_else(|| identity(a.get("session.id")));
        let response = identity(a.get("gen_ai.response.id"));
        let trace = identity(row.get("traceId"));
        let span = identity(row.get("spanId"));
        let id = session.as_ref().and_then(|session| {
            if let Some(response) = &response {
                Some(json!(stringify(&json!(["response", session, response]))))
            } else if let (Some(trace), Some(span)) = (&trace, &span) {
                Some(json!(stringify(&json!(["span", trace, span]))))
            } else {
                None
            }
        });
        add(
            &mut parsed,
            "copilot",
            &json!({"input": a.get("gen_ai.usage.input_tokens"), "output": a.get("gen_ai.usage.output_tokens"),
                "cacheReadTokens": a.get("gen_ai.usage.cache_read.input_tokens"), "cacheWriteTokens": a.get("gen_ai.usage.cache_write.input_tokens"),
                "reasoning": a.get("gen_ai.usage.reasoning_tokens"), "total": a.get("gen_ai.usage.total_tokens")}),
            &json!({"id": id, "session": session, "model": a.get("gen_ai.response.model").filter(|v| !v.is_null()).or_else(|| a.get("gen_ai.request.model")),
                "time": otel_time(row), "entry": "otel"}),
            salt,
            "inclusive",
        );
    }
    parsed
}

pub fn parse(agent: &str, objects: &[Value], salt: &str, file: &str) -> Parsed {
    if agent == "pi" {
        return pi(objects, salt);
    }
    if agent == "cline" {
        return cline(objects, salt, file, "cline");
    }
    if path::basename(file) == "events.jsonl" && path::basename(&path::dirname(&path::dirname(file))) == "session-state" {
        copilot_state(objects, salt, file)
    } else {
        copilot_otel(objects, salt)
    }
}