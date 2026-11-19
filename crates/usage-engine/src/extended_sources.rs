// Field projection only. No SDK execution, credentials, source mutation or network.
use crate::js_json::stringify;
use crate::normalize::{digest, normalize, number};
use crate::parsed::{or, truthy, Parsed};
use crate::pathx as path;
use crate::time::parse_iso;
use crate::usage_snapshot::{select_usage_snapshot, CONFLICT};
use crate::zstd_frame::frame_end;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::Read;

fn camel_usage(usage: &Value) -> Value {
    let mut out = Map::new();
    for field in ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"] {
        if let Some(value) = usage.get(field) {
            out.insert(field.into(), value.clone());
        }
    }
    Value::Object(out)
}

pub fn gemini(objects: &[Value], salt: &str, fallback: &str) -> Parsed {
    let mut parsed = Parsed::new();
    let mut messages: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut session = fallback.to_string();
    let add = |message: &Value, session: &str, messages: &mut HashMap<String, Value>, order: &mut Vec<String>, parsed: &mut Parsed| {
        if message.get("type").and_then(|v| v.as_str()) != Some("gemini") || !truthy(message.get("tokens")) || !message.get("id").map(|v| v.is_string()).unwrap_or(false) {
            return;
        }
        let t = &message["tokens"];
        let id = format!("{}:{}", session, message["id"].as_str().unwrap());
        let record = normalize(
            "gemini",
            &json!({"input": t.get("input"), "output": t.get("output"), "cached_input_tokens": t.get("cached"), "reasoning": t.get("thoughts"), "total": t.get("total")}),
            &json!({"id": id, "session": session, "model": message.get("model"), "time": message.get("timestamp"), "entry": "cli", "outputExcludesReasoning": true}),
            salt,
            "inclusive",
        );
        if let Some(mut record) = record {
            if number(t.get("tool")).map(|v| v > 0).unwrap_or(false) {
                let total = number(t.get("total")).map(|v| json!(v)).unwrap_or_else(|| record["totalTokens"].clone());
                record["totalTokens"] = total;
                record["quality"] = json!("partial");
            }
            let choice = select_usage_snapshot(messages.get(&id), &record);
            if choice.issue == Some(CONFLICT) {
                parsed.warn(CONFLICT);
            }
            if !messages.contains_key(&id) {
                order.push(id.clone());
            }
            messages.insert(id, choice.record);
        }
    };
    for obj in objects {
        if !obj.is_object() {
            continue;
        }
        if let Some(Value::String(id)) = obj.get("sessionId") {
            session = id.clone();
        }
        if let Some(Value::String(id)) = obj.get("$set").and_then(|s| s.get("sessionId")) {
            session = id.clone();
        }
        let list = or(obj.get("messages"), obj.get("$set").and_then(|s| s.get("messages")));
        if let Some(Value::Array(items)) = list {
            for message in items {
                add(message, &session, &mut messages, &mut order, &mut parsed);
            }
        }
        add(obj, &session, &mut messages, &mut order, &mut parsed);
    }
    parsed.records = order.iter().map(|id| messages[id].clone()).collect();
    parsed
}

pub fn cursor(objects: &[Value], salt: &str) -> Parsed {
    let mut parsed = Parsed::new();
    for obj in objects {
        if !truthy(obj.get("usage")) {
            parsed.warn("USAGE_UNREPORTED");
            continue;
        }
        let run_id = obj.get("runId").and_then(|v| v.as_str());
        let agent_id = obj.get("agentId").and_then(|v| v.as_str());
        let (run_id, agent_id) = match (run_id, agent_id) {
            (Some(r), Some(a)) => (r, a),
            _ => {
                parsed.warn("SOURCE_ROW_INVALID");
                continue;
            }
        };
        let record = normalize(
            "cursor",
            &camel_usage(&obj["usage"]),
            &json!({"id": format!("sdk:{agent_id}:{run_id}"), "session": agent_id, "model": obj.get("model").and_then(|m| m.get("id")),
                "time": obj.get("startedAt").filter(|v| !v.is_null()).or_else(|| obj.get("createdAt")), "entry": "sdk"}),
            salt,
            "exclusive",
        );
        match record {
            Some(record) => parsed.records.push(record),
            None => parsed.warn("SOURCE_ROW_INVALID"),
        }
    }
    parsed
}

fn csv_rows(text: &str) -> Result<Vec<Vec<String>>, String> {
    let chars: Vec<char> = text.chars().collect();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut value = String::new();
    let mut quoted = false;
    let mut closed = false;
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        if quoted {
            if c == '"' {
                if chars.get(i + 1) == Some(&'"') {
                    value.push('"');
                    i += 1;
                } else {
                    quoted = false;
                    closed = true;
                }
            } else {
                value.push(c);
            }
        } else if c == '"' && value.is_empty() && !closed {
            quoted = true;
        } else if c == ',' || c == '\n' || c == '\r' {
            row.push(std::mem::take(&mut value));
            closed = false;
            if c != ',' {
                if c == '\r' && chars.get(i + 1) == Some(&'\n') {
                    i += 1;
                }
                if row.iter().any(|v| !v.is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
        } else {
            if closed || c == '"' {
                return Err("CURSOR_CSV_INVALID".to_string());
            }
            value.push(c);
        }
        if rows.len() > 1000000 || value.len() > 1024 * 1024 {
            return Err("SOURCE_LIMIT".to_string());
        }
        i += 1;
    }
    if quoted {
        return Err("CURSOR_CSV_INVALID".to_string());
    }
    if !row.is_empty() || !value.is_empty() {
        row.push(value);
        rows.push(row);
    }
    Ok(rows)
}

pub fn cursor_csv(text: &str, salt: &str) -> Result<Parsed, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut rows = csv_rows(text)?;
    let header = if rows.is_empty() { Vec::new() } else { rows.remove(0) };
    let keys: Vec<String> = header
        .iter()
        .map(|k| k.trim().to_lowercase().chars().filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit()).collect())
        .collect();
    let unique: std::collections::HashSet<&String> = keys.iter().collect();
    if unique.len() != keys.len() {
        return Err("CURSOR_CSV_SCHEMA".to_string());
    }
    let index = |names: &[&str]| -> i64 {
        for name in names {
            if let Some(at) = keys.iter().position(|k| k == name) {
                return at as i64;
            }
        }
        -1
    };
    let time_index = index(&["date", "timestamp"]);
    let model_index = index(&["model"]);
    let input_index = index(&["inputtokenswocachewrite", "inputtokens"]);
    let read_index = index(&["cachereadtokens"]);
    let write_index = index(&["cachewritetokens"]);
    let output_index = index(&["outputtokens"]);
    let total_index = index(&["totaltokens"]);
    let combined_index = index(&["inputtokenswcachewrite"]);
    let base_index = index(&["inputtokenswocachewrite"]);
    if [time_index, model_index, input_index, read_index, output_index].iter().any(|i| *i < 0) || (write_index < 0 && (combined_index < 0 || base_index < 0)) {
        return Err("CURSOR_CSV_SCHEMA".to_string());
    }
    let request_index = index(&["requestid", "usageid"]);
    let count = |v: Option<&String>| -> Option<i64> {
        let text = v?.trim();
        if Regex::new(r"^(?:0|[1-9]\d*)$").unwrap().is_match(text) {
            number(Some(&json!(text.parse::<f64>().ok()?)))
        } else {
            None
        }
    };
    fn cell(row: &[String], at: i64) -> Option<&String> {
        if at < 0 {
            None
        } else {
            row.get(at as usize)
        }
    }
    let time_pattern = Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$").unwrap();
    let mut seen: HashMap<String, i64> = HashMap::new();
    let mut parsed = Parsed::new();
    for row in &rows {
        let time = cell(row, time_index).cloned().unwrap_or_default();
        let day: String = time.chars().take(10).collect();
        let date_ok = parse_iso(&format!("{day}T00:00:00Z")).map(|ms| crate::time::iso_from_ms(ms)[..10] == day).unwrap_or(false);
        if row.len() != header.len() || !time_pattern.is_match(&time) || !date_ok {
            parsed.warn("SOURCE_ROW_INVALID");
            continue;
        }
        let combined = if combined_index < 0 { None } else { count(cell(row, combined_index)) };
        let base = if base_index < 0 { None } else { count(cell(row, base_index)) };
        let cache_write = if write_index >= 0 {
            count(cell(row, write_index))
        } else {
            match (combined, base) {
                (Some(c), Some(b)) => number(Some(&json!(c - b))),
                _ => None,
            }
        };
        let mut usage = Map::new();
        usage.insert("inputTokens".into(), json!(count(cell(row, input_index))));
        usage.insert("outputTokens".into(), json!(count(cell(row, output_index))));
        usage.insert("cacheReadTokens".into(), json!(count(cell(row, read_index))));
        usage.insert("cacheWriteTokens".into(), json!(cache_write));
        if total_index >= 0 {
            usage.insert("totalTokens".into(), json!(count(cell(row, total_index))));
        }
        if usage.values().any(|v| v.is_null()) {
            parsed.warn("SOURCE_ROW_INVALID");
            continue;
        }
        let record = normalize(
            "cursor",
            &Value::Object(usage),
            &json!({"id": "pending", "time": time, "model": cell(row, model_index), "entry": "export"}),
            salt,
            "exclusive",
        );
        let mut record = match record {
            Some(record) => record,
            None => {
                parsed.warn("SOURCE_ROW_INVALID");
                continue;
            }
        };
        let signature = csv_identity(&record);
        let occurrence = seen.get(&signature).copied().unwrap_or(0);
        seen.insert(signature.clone(), occurrence + 1);
        let request = if request_index >= 0 { cell(row, request_index).filter(|v| !v.is_empty()).cloned() } else { None };
        record["id"] = json!(digest(salt, &format!("cursor:csv:{}", request.clone().unwrap_or_else(|| format!("{signature}:{occurrence}")))));
        record["csvIdentity"] = match request {
            Some(_) => Value::Null,
            None => json!(digest(salt, &format!("cursor-export/2:{signature}:{occurrence}"))),
        };
        parsed.records.push(record);
    }
    Ok(parsed)
}

pub fn csv_identity(record: &Value) -> String {
    stringify(&json!([record.get("timestamp"), record.get("model"), record.get("inputUncached"), record.get("output"), record.get("cacheRead"), record.get("cacheWrite")]))
}

pub fn generation(file: &str) -> Option<i64> {
    let base = path::basename(file);
    let captures = Regex::new(r"^session(?:\.v([1-9]\d*))?\.jsonl(?:\.zstd)?$").unwrap().captures(&base)?;
    Some(captures.get(1).map(|m| m.as_str().parse::<i64>().unwrap_or(0)).unwrap_or(0))
}

pub fn canonical_files(files: &[String]) -> Vec<String> {
    let mut groups: Vec<(String, i64, Vec<String>)> = Vec::new();
    for file in files {
        let dir = path::dirname(file);
        let version = generation(file).unwrap_or(0);
        match groups.iter_mut().find(|(d, _, _)| *d == dir) {
            Some((_, old_version, old_files)) if version > *old_version => {
                *old_version = version;
                *old_files = vec![file.clone()];
            }
            Some((_, old_version, old_files)) if version == *old_version => {
                if !old_files.contains(file) {
                    old_files.push(file.clone());
                }
            }
            Some(_) => {}
            None => groups.push((dir, version, vec![file.clone()])),
        }
    }
    groups.into_iter().flat_map(|(_, _, files)| files).collect()
}

pub fn decode_deepseek(bytes: &[u8], compressed: bool, on_incomplete: &mut dyn FnMut()) -> Result<String, String> {
    if !compressed {
        return Ok(String::from_utf8_lossy(bytes).to_string());
    }
    let mut chunks: Vec<u8> = Vec::new();
    let mut offset = 0usize;
    while offset < bytes.len() {
        let end = match frame_end(bytes, offset) {
            Ok(Some(end)) => end,
            Ok(None) => {
                on_incomplete();
                break;
            }
            Err(_) => return Err("SOURCE_COMPRESSION_INVALID".to_string()),
        };
        let remaining = 512 * 1024 * 1024 - chunks.len();
        let mut decoder = zstd::stream::read::Decoder::new(&bytes[offset..end]).map_err(|_| "SOURCE_COMPRESSION_INVALID".to_string())?;
        let mut decoded = Vec::new();
        let mut limited = (&mut decoder).take(remaining as u64 + 1);
        limited.read_to_end(&mut decoded).map_err(|_| "SOURCE_COMPRESSION_INVALID".to_string())?;
        if decoded.len() > remaining {
            return Err("SOURCE_COMPRESSION_INVALID".to_string());
        }
        offset = end;
        chunks.extend_from_slice(&decoded);
        if chunks.len() >= 512 * 1024 * 1024 {
            return Err("SOURCE_COMPRESSION_INVALID".to_string());
        }
    }
    Ok(String::from_utf8_lossy(&chunks).to_string())
}

pub fn deepseek(objects: &[Value], salt: &str, file: &str) -> Result<Parsed, String> {
    let mut parsed = Parsed::new();
    let header = objects.first();
    let version = generation(file);
    let header_ok = header
        .map(|h| {
            h.get("type").and_then(|v| v.as_str()) == Some("session")
                && h.get("id").map(|v| v.is_string()).unwrap_or(false)
                && h.get("isSeeded").map(|v| v.is_boolean()).unwrap_or(false)
                && version.map(|v| h.get("version").and_then(|x| x.as_i64()) == Some(v)).unwrap_or(false)
                && version.map(|v| [2, 3, 4].contains(&v)).unwrap_or(false)
        })
        .unwrap_or(false);
    if !header_ok {
        return Err("DEEPSEEK_FORMAT_UNSUPPORTED".to_string());
    }
    let header = header.unwrap();
    let header_id = header["id"].as_str().unwrap();
    let events = &objects[1..];
    let mut cut: i64 = -1;
    let is_seeded = header["isSeeded"].as_bool().unwrap();
    let end_seed = |event: &&Value| {
        event.get("type").and_then(|v| v.as_str()) == Some("session/end-seed") && event.get("data").and_then(|d| d.get("inherited")).and_then(|v| v.as_bool()) == Some(true)
    };
    if is_seeded {
        for event in events {
            if end_seed(&event) {
                cut = event.get("seq").and_then(|v| v.as_i64()).unwrap_or(-1);
            }
        }
        if number(Some(&json!(cut))).is_none() {
            return Err("DEEPSEEK_SEED_INVALID".to_string());
        }
    } else if events.iter().any(|e| end_seed(&e)) {
        return Err("DEEPSEEK_SEED_INVALID".to_string());
    }
    let mut model: Option<Value> = None;
    let mut provider: Option<Value> = None;
    let mut expected: i64 = 0;
    let mut attempts: HashMap<String, i64> = HashMap::new();
    for event in events {
        let seq = event.get("seq").and_then(|v| v.as_i64());
        let matches = seq == Some(expected);
        expected += 1;
        if !event.is_object() || !matches {
            parsed.warn("DEEPSEEK_LOG_INCOMPLETE");
            break;
        }
        let seq = seq.unwrap();
        let data = event.get("data").filter(|v| truthy(Some(v))).cloned().unwrap_or(json!({}));
        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if event_type == "request/header" {
            model = data.get("header").and_then(|h| h.get("config")).and_then(|c| c.get("model")).cloned();
            provider = data.get("header").and_then(|h| h.get("config")).and_then(|c| c.get("provider")).cloned();
        }
        if event_type == "request/context" {
            model = data.get("model").cloned();
            provider = data.get("provider").cloned();
        }
        if event_type != "assistant/message" && event_type != "assistant/attempt" {
            continue;
        }
        let turn = number(data.get("turn"));
        let step = number(data.get("step"));
        let (turn, step) = match (turn, step) {
            (Some(t), Some(s)) => (t, s),
            _ => {
                if seq > cut {
                    parsed.warn("SOURCE_ROW_INVALID");
                }
                continue;
            }
        };
        let lane = format!("{turn}:{step}");
        let attempt = attempts.get(&lane).copied().unwrap_or(0);
        attempts.insert(lane.clone(), attempt + 1);
        if seq <= cut {
            continue;
        }
        let mut usage = data.get("usage").filter(|v| truthy(Some(v))).cloned();
        if usage.is_none() {
            if let Some(Value::Array(stream)) = data.get("stream") {
                for part in stream {
                    if part.get("type").and_then(|v| v.as_str()) == Some("chunk") && part.get("chunk").and_then(|c| c.get("type")).and_then(|v| v.as_str()) == Some("usage") {
                        usage = part.get("chunk").and_then(|c| c.get("usage")).cloned();
                    }
                }
            }
        }
        let usage = match usage {
            Some(usage) => usage,
            None => {
                parsed.warn("USAGE_UNREPORTED");
                continue;
            }
        };
        let source = data.get("message").and_then(|m| m.get("source"));
        let record = normalize(
            "deepseek",
            &camel_usage(&usage),
            &json!({"id": format!("{header_id}:call:{lane}:{attempt}"), "session": header_id,
                "model": source.and_then(|s| s.get("model")).filter(|v| !v.is_null()).or(model.as_ref()),
                "provider": source.and_then(|s| s.get("provider")).filter(|v| !v.is_null()).or(provider.as_ref()),
                "time": event.get("time"), "entry": "harness"}),
            salt,
            "exclusive",
        );
        match record {
            Some(record) => parsed.records.push(record),
            None => parsed.warn("SOURCE_ROW_INVALID"),
        }
    }
    Ok(parsed)
}

pub fn zcode(rows: &[Value], salt: &str) -> Parsed {
    let mut parsed = Parsed::new();
    for row in rows {
        if !row.get("id").map(|v| v.is_string()).unwrap_or(false) {
            parsed.warn("SOURCE_ROW_INVALID");
            continue;
        }
        let input = number(row.get("input_tokens"));
        let output = number(row.get("output_tokens"));
        let total = number(row.get("computed_total_tokens"));
        let caches = number(row.get("cache_read_input_tokens")).unwrap_or(0) + number(row.get("cache_creation_input_tokens")).unwrap_or(0);
        let reasoning = number(row.get("reasoning_tokens")).unwrap_or(0);
        let mut semantics = "inclusive";
        let mut separate_reasoning = false;
        if let (Some(input), Some(output), Some(total)) = (input, output, total) {
            if total != input + output {
                if total == input + output + caches {
                    semantics = "exclusive";
                } else if total == input + output + caches + reasoning {
                    semantics = "exclusive";
                    separate_reasoning = true;
                }
            }
        }
        let usage = json!({
            "input_tokens": row.get("input_tokens"), "output_tokens": row.get("output_tokens"),
            "reasoning_output_tokens": row.get("reasoning_tokens"),
            "cache_read_input_tokens": row.get("cache_read_input_tokens"),
            "cache_creation_input_tokens": row.get("cache_creation_input_tokens"),
            "total_tokens": row.get("provider_total_tokens").filter(|v| !v.is_null()).or_else(|| row.get("computed_total_tokens"))
        });
        let record = normalize(
            "zcode",
            &usage,
            &json!({"id": row.get("id"), "session": row.get("session_id"), "model": row.get("model_id"), "provider": row.get("provider_id"),
                "time": row.get("started_at").filter(|v| !v.is_null()).or_else(|| row.get("completed_at")),
                "entry": "cli", "outputExcludesReasoning": separate_reasoning}),
            salt,
            semantics,
        );
        match record {
            Some(mut record) => {
                if let Some(total) = total {
                    if json!(total) != record["totalTokens"] {
                        record["quality"] = json!("total-mismatch");
                    }
                }
                parsed.records.push(record);
            }
            None => {
                if total.is_some() {
                    parsed.warn("SOURCE_ROW_INVALID");
                }
            }
        }
    }
    parsed
}