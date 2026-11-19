// Custom JSONL/NDJSON sources: claude-compatible, mapped per-request or standard
// event parsers (CUSTOM-JSONL-SOURCES-20261017.md). No executable plugins.
use crate::js_json::stringify;
use crate::normalize::{digest, normalize, number};
use crate::parsed::object;
use crate::pathx as path;
use crate::policy::{files_under, local_path, mtime_ms, Audit, Listed};
use crate::time::{iso_from_ms, parse_iso};
use crate::usage_snapshot::{select_usage_snapshot, CONFLICT};
use regex::Regex;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::BufReader;

pub const FIELDS: [&str; 11] = ["id", "session", "time", "model", "provider", "input", "output", "cacheRead", "cacheWrite", "reasoning", "total"];
const TOKENS: [&str; 6] = ["input", "output", "cacheRead", "cacheWrite", "reasoning", "total"];
pub const MAX_LINE: usize = 1024 * 1024;

fn standard_mapping() -> Value {
    json!({"id": "id", "session": "sessionId", "time": "timestamp", "model": "model", "provider": "provider",
        "input": "inputTokens", "output": "outputTokens", "cacheRead": "cacheReadTokens", "cacheWrite": "cacheWriteTokens",
        "reasoning": "reasoningTokens", "total": "totalTokens"})
}

fn claude_mapping() -> Value {
    json!({"id": "message.id", "session": "sessionId", "time": "timestamp", "model": "message.model", "provider": "provider",
        "input": "message.usage.input_tokens", "output": "message.usage.output_tokens",
        "cacheRead": "message.usage.cache_read_input_tokens", "cacheWrite": "message.usage.cache_creation_input_tokens",
        "reasoning": "message.usage.reasoning_output_tokens", "total": "message.usage.total_tokens"})
}

pub fn hash(value: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(stringify(value).as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn keys(value: &Value, allowed: &[&str]) -> Result<(), String> {
    if !object(Some(value)) || value.as_object().unwrap().keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("CUSTOM_CONFIG_INVALID".to_string());
    }
    Ok(())
}

fn field(value: &Value) -> Result<String, String> {
    let text = value.as_str().unwrap_or("");
    let bad = text.is_empty()
        || text.encode_utf16().count() > 240
        || text.split('.').any(|part| {
            !Regex::new(r"^[a-zA-Z0-9_$-]+$").unwrap().is_match(part) || ["__proto__", "prototype", "constructor"].contains(&part)
        });
    if bad {
        return Err("CUSTOM_FIELD_INVALID".to_string());
    }
    Ok(text.to_string())
}

fn get<'a>(value: &'a Value, dotted: &str) -> Option<&'a Value> {
    if dotted.is_empty() {
        return None;
    }
    let mut current = value;
    for part in dotted.split('.') {
        let next = match current {
            Value::Object(map) => map.get(part),
            Value::Array(items) => part.parse::<usize>().ok().and_then(|i| items.get(i)),
            _ => None,
        };
        current = next?;
    }
    Some(current)
}

pub fn definition(value: &Value) -> Result<Value, String> {
    keys(value, &["schemaVersion", "name", "template", "mode", "mapping", "filters", "timeUnit", "inputSemantics", "outputIncludesReasoning"])?;
    let name = value.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let template = value.get("template").and_then(|v| v.as_str()).unwrap_or("");
    if value.get("schemaVersion").and_then(|v| v.as_str()) != Some("CustomSourceV1")
        || name.trim().is_empty()
        || name.encode_utf16().count() > 80
        || name.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        || !["claude", "mapped", "standard"].contains(&template)
    {
        return Err("CUSTOM_CONFIG_INVALID".to_string());
    }
    if value.get("mode").and_then(|v| v.as_str()) != Some("per-request") {
        return Err("CUSTOM_COUNTER_UNSUPPORTED".to_string());
    }
    let mapped = template == "mapped";
    let mut out = json!({"schemaVersion": "CustomSourceV1", "name": name.trim(), "template": template, "mode": "per-request"});
    if mapped {
        let mapping_value = value.get("mapping").cloned().unwrap_or(Value::Null);
        keys(&mapping_value, &FIELDS)?;
        let mut mapping = Map::new();
        for (name, path_value) in mapping_value.as_object().unwrap() {
            if crate::normalize::truthy(path_value) {
                mapping.insert(name.clone(), json!(field(path_value)?));
            }
        }
        let has = |key: &str| mapping.get(key).map(|v| crate::normalize::truthy(v)).unwrap_or(false);
        if !has("id") || !has("time") || !(has("input") || has("output") || has("total")) {
            return Err("CUSTOM_FIELD_INVALID".to_string());
        }
        let semantics = value.get("inputSemantics").and_then(|v| v.as_str()).unwrap_or("");
        let time_unit = value.get("timeUnit").and_then(|v| v.as_str()).unwrap_or("");
        if !["inclusive", "exclusive"].contains(&semantics) || !value.get("outputIncludesReasoning").map(|v| v.is_boolean()).unwrap_or(false) || !["iso", "s", "ms"].contains(&time_unit) {
            return Err("CUSTOM_CONFIG_INVALID".to_string());
        }
        let filters_value = value.get("filters").and_then(|v| v.as_array()).ok_or_else(|| "CUSTOM_CONFIG_INVALID".to_string())?;
        if filters_value.len() > 8 {
            return Err("CUSTOM_CONFIG_INVALID".to_string());
        }
        let mut filters = Vec::new();
        for filter in filters_value {
            keys(filter, &["path", "values"])?;
            let filter_path = field(filter.get("path").unwrap_or(&Value::Null))?;
            let values = filter.get("values").and_then(|v| v.as_array()).ok_or_else(|| "CUSTOM_CONFIG_INVALID".to_string())?;
            if values.is_empty()
                || values.len() > 16
                || values.iter().any(|v| match v {
                    Value::Null => false,
                    Value::String(s) => s.encode_utf16().count() > 180,
                    Value::Number(n) => !n.as_f64().map(|f| f.is_finite()).unwrap_or(false),
                    Value::Bool(_) => false,
                    _ => true,
                })
            {
                return Err("CUSTOM_CONFIG_INVALID".to_string());
            }
            filters.push(json!({"path": filter_path, "values": values}));
        }
        out["mapping"] = Value::Object(mapping);
        out["filters"] = Value::Array(filters);
        out["timeUnit"] = json!(time_unit);
        out["inputSemantics"] = json!(semantics);
        out["outputIncludesReasoning"] = value["outputIncludesReasoning"].clone();
    } else if ["mapping", "filters", "timeUnit", "inputSemantics", "outputIncludesReasoning"].iter().any(|key| value.get(*key).is_some()) {
        return Err("CUSTOM_CONFIG_INVALID".to_string());
    }
    Ok(out)
}

pub fn parser_hash(config: &Value) -> String {
    let mut rules = config.as_object().cloned().unwrap_or_default();
    rules.remove("name");
    hash(&Value::Object(rules))
}

pub fn settings(config: &Value) -> Value {
    if config.get("template").and_then(|v| v.as_str()) == Some("mapped") {
        return config.clone();
    }
    let claude = config.get("template").and_then(|v| v.as_str()) == Some("claude");
    json!({"mapping": if claude { claude_mapping() } else { standard_mapping() }, "filters": [], "timeUnit": "iso",
        "inputSemantics": if claude { "exclusive" } else { "inclusive" }, "outputIncludesReasoning": true})
}

pub enum Outcome {
    Record(Value),
    Invalid,
    Filtered,
    Unsupported,
}

pub fn parse(obj: &Value, source: &Value, salt: &str) -> Outcome {
    let config = &source["definition"];
    let options = settings(config);
    if !object(Some(obj)) {
        return Outcome::Invalid;
    }
    let template = config.get("template").and_then(|v| v.as_str()).unwrap_or("");
    if template == "claude" && (obj.get("type").and_then(|v| v.as_str()) != Some("assistant") || !object(obj.get("message").and_then(|m| m.get("usage")))) {
        return Outcome::Filtered;
    }
    if template == "standard" && obj.get("schemaVersion").and_then(|v| v.as_str()) != Some("AgentUsageEventV1") {
        return Outcome::Filtered;
    }
    if template == "standard" && obj.get("mode").and_then(|v| v.as_str()) != Some("per-request") {
        return Outcome::Unsupported;
    }
    if let Some(Value::Array(filters)) = options.get("filters") {
        for filter in filters {
            let path = filter["path"].as_str().unwrap_or("");
            let needle = get(obj, path);
            let values = filter["values"].as_array().cloned().unwrap_or_default();
            let matched = values.iter().any(|v| match (v, needle) {
                (Value::Null, Some(Value::Null)) => true,
                (a, Some(b)) => stringify(a) == stringify(b),
                _ => false,
            });
            if !matched {
                return Outcome::Filtered;
            }
        }
    }
    let mapping = &options["mapping"];
    let mut values = Map::new();
    for key in FIELDS {
        let path = mapping.get(key).and_then(|v| v.as_str()).unwrap_or("");
        values.insert(key.into(), get(obj, path).cloned().unwrap_or(Value::Null));
    }
    // JS distinguishes undefined (absent) from null; absent paths stay absent.
    for key in FIELDS {
        let path = mapping.get(key).and_then(|v| v.as_str()).unwrap_or("");
        if path.is_empty() || get(obj, path).is_none() {
            values.remove(key);
        }
    }
    if template == "claude" && !crate::normalize::truthy(values.get("id").unwrap_or(&Value::Null)) {
        if let Some(uuid) = obj.get("uuid") {
            values.insert("id".into(), uuid.clone());
        }
    }
    let id = values.get("id");
    let id_ok = matches!(id, Some(Value::String(s)) if !s.is_empty() && s.encode_utf16().count() <= 200 && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}'));
    let session = values.get("session");
    let session_ok = match session {
        None | Some(Value::Null) => true,
        Some(Value::String(s)) => s.encode_utf16().count() <= 200,
        _ => false,
    };
    if !id_ok || !session_ok {
        return Outcome::Invalid;
    }
    if TOKENS.iter().any(|key| values.get(*key).map(|v| !v.is_null() && number(Some(v)).is_none()).unwrap_or(false)) {
        return Outcome::Invalid;
    }
    let mut time = values.get("time").cloned().unwrap_or(Value::Null);
    let time_unit = options.get("timeUnit").and_then(|v| v.as_str()).unwrap_or("iso");
    if time_unit == "iso" {
        let text = time.as_str().unwrap_or("");
        if !Regex::new(r"^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$").unwrap().is_match(text) {
            return Outcome::Invalid;
        }
    } else {
        let raw = time.as_f64().filter(|v| v.is_finite() && *v >= 0.0);
        let ms = match raw {
            Some(raw) => raw * if time_unit == "s" { 1000.0 } else { 1.0 },
            None => return Outcome::Invalid,
        };
        if ms.abs() > 8_640_000_000_000_000.0 {
            return Outcome::Invalid;
        }
        time = json!(iso_from_ms(ms as i64));
    }
    let usage = json!({"input_tokens": values.get("input"), "output_tokens": values.get("output"),
        "cache_read_input_tokens": values.get("cacheRead"), "cache_creation_input_tokens": values.get("cacheWrite"),
        "reasoning_output_tokens": values.get("reasoning"), "total_tokens": values.get("total")});
    let semantics = options.get("inputSemantics").and_then(|v| v.as_str()).unwrap_or("inclusive");
    let record = normalize(
        source["id"].as_str().unwrap_or(""),
        &usage,
        &json!({"id": stringify(&json!([values.get("session").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or(json!("")), values.get("id")])),
            "session": values.get("session"), "time": time, "model": values.get("model"),
            "provider": values.get("provider").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or(json!("unknown")),
            "outputExcludesReasoning": !options.get("outputIncludesReasoning").and_then(|v| v.as_bool()).unwrap_or(true)}),
        salt,
        semantics,
    );
    let mut record = match record {
        Some(record) => record,
        None => return Outcome::Invalid,
    };
    let request_input = if semantics == "inclusive" {
        number(values.get("input")).map(|v| json!(v)).unwrap_or(Value::Null)
    } else {
        let input = number(values.get("input"));
        let read = number(values.get("cacheRead"));
        let write = number(values.get("cacheWrite"));
        match (input, read, write) {
            (Some(i), Some(r), Some(w)) => json!(i + r + w),
            _ => Value::Null,
        }
    };
    record["requestInputTokens"] = request_input;
    Outcome::Record(record)
}

pub fn merge(files: &Value) -> (Vec<Value>, u64, u64) {
    let mut records: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    let mut duplicates = 0u64;
    let mut conflicts = 0u64;
    let mut keys: Vec<&String> = files.as_object().map(|m| m.keys().collect()).unwrap_or_default();
    keys.sort();
    for key in keys {
        if let Some(Value::Array(list)) = files[key].get("records") {
            for record in list {
                let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let old = records.get(&id);
                let choice = select_usage_snapshot(old, record);
                if old.is_some() {
                    duplicates += 1;
                }
                if choice.issue == Some(CONFLICT) {
                    conflicts += 1;
                }
                if !records.contains_key(&id) {
                    order.push(id.clone());
                }
                records.insert(id, choice.record);
            }
        }
    }
    (order.iter().map(|id| records[id].clone()).collect(), duplicates, conflicts)
}

// Node's stat.ino is the NTFS file index; MetadataExt::file_index is unstable,
// so read it through GetFileInformationByHandle on a attributes-only handle.
#[cfg(windows)]
fn file_index(file: &str) -> u64 {
    use std::os::windows::ffi::OsStrExt;
    #[repr(C)]
    #[derive(Default)]
    struct ByHandleInformation {
        attributes: u32,
        created: u64,
        accessed: u64,
        written: u64,
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    extern "system" {
        fn CreateFileW(name: *const u16, access: u32, share: u32, security: *mut std::ffi::c_void, disposition: u32, flags: u32, template: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn GetFileInformationByHandle(handle: *mut std::ffi::c_void, info: *mut ByHandleInformation) -> i32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
    let wide: Vec<u16> = std::ffi::OsStr::new(file).encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        // FILE_READ_ATTRIBUTES, share read|write|delete, OPEN_EXISTING.
        let handle = CreateFileW(wide.as_ptr(), 0x80, 0x7, std::ptr::null_mut(), 3, 0, std::ptr::null_mut());
        if handle.is_null() || handle == isize::MAX as *mut std::ffi::c_void {
            return 0;
        }
        let mut info = ByHandleInformation::default();
        let ok = GetFileInformationByHandle(handle, &mut info);
        CloseHandle(handle);
        if ok == 0 {
            return 0;
        }
        ((info.index_high as u64) << 32) | info.index_low as u64
    }
}

pub fn stamp(file: &str) -> Result<String, String> {
    let meta = fs::metadata(file).map_err(|_| "SOURCE_UNREADABLE".to_string())?;
    let ino = {
        #[cfg(windows)]
        {
            file_index(file)
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            meta.ino()
        }
    };
    Ok(format!("{}:{}:{}", meta.len(), crate::js_json::stringify(&json!(mtime_ms(&meta))), ino))
}

pub fn listing(source: &Value, audit: &mut Audit) -> Result<(Vec<String>, Vec<String>), String> {
    let mut files: Vec<String> = Vec::new();
    let mut issues: Vec<String> = Vec::new();
    let id = source["id"].as_str().unwrap_or("");
    if let Some(Value::Array(roots)) = source.get("roots") {
        for root in roots.iter().filter_map(|v| v.as_str()) {
            let found: Listed = files_under(id, root, audit, None)?;
            if found.limited && !issues.iter().any(|i| i == "SOURCE_LIMIT") {
                issues.push("SOURCE_LIMIT".to_string());
            }
            if found.aliased && !issues.iter().any(|i| i == "SOURCE_ALIAS_REJECTED") {
                issues.push("SOURCE_ALIAS_REJECTED".to_string());
            }
            if found.unreadable && !issues.iter().any(|i| i == "SOURCE_UNREADABLE") {
                issues.push("SOURCE_UNREADABLE".to_string());
            }
            for file in found.files {
                if !files.contains(&file) {
                    files.push(file);
                }
            }
        }
    }
    files.sort();
    Ok((files, issues))
}

pub fn fingerprint(source: &Value) -> Result<String, String> {
    let (files, issues) = listing(source, &mut Audit::new())?;
    let stamps: Vec<Value> = files.iter().map(|file| json!([file, stamp(file).ok()])).collect();
    Ok(hash(&json!([source.get("definition"), source.get("roots"), issues, stamps])))
}

struct ReadStats {
    bytes: usize,
    lines: usize,
}

fn read_file(file: &str, visit: &mut dyn FnMut(&str), audit: &mut Audit, sample: bool, deadline_ms: f64, sample_bytes: usize, sample_lines: usize) -> Result<ReadStats, String> {
    let initial = fs::symlink_metadata(file).map_err(|_| "SOURCE_SIZE_OR_LINK".to_string())?;
    if !initial.is_file() || initial.file_type().is_symlink() || initial.len() > 512 * 1024 * 1024 {
        return Err("SOURCE_SIZE_OR_LINK".to_string());
    }
    let before = stamp(file)?;
    let handle = fs::File::open(file).map_err(|_| "SOURCE_UNREADABLE".to_string())?;
    audit.reads += 1;
    let mut reader = BufReader::with_capacity(65536, handle);
    let mut bytes = 0usize;
    let mut lines = 0usize;
    let mut pending: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 65536];
    loop {
        if crate::time::now_ms() as f64 > deadline_ms {
            return Err("SOURCE_TIMEOUT".to_string());
        }
        let read = {
            use std::io::Read;
            let limit = if sample { sample_bytes.saturating_sub(bytes).min(chunk.len()) } else { chunk.len() };
            if limit == 0 {
                0
            } else {
                reader.read(&mut chunk[..limit]).map_err(|_| "SOURCE_UNREADABLE".to_string())?
            }
        };
        if read == 0 {
            break;
        }
        bytes += read;
        pending.extend_from_slice(&chunk[..read]);
        while let Some(at) = pending.iter().position(|b| *b == b'\n') {
            if at > MAX_LINE {
                return Err("CUSTOM_LINE_LIMIT".to_string());
            }
            let line_bytes = pending[..at].to_vec();
            pending.drain(..at + 1);
            let mut line = String::from_utf8_lossy(&line_bytes).to_string();
            if line.ends_with('\r') {
                line.pop();
            }
            if !line.trim().is_empty() {
                visit(&line);
            }
            lines += 1;
            if sample && (lines >= sample_lines || bytes >= sample_bytes) {
                return Ok(ReadStats { bytes, lines });
            }
        }
        if pending.len() > MAX_LINE {
            return Err("CUSTOM_LINE_LIMIT".to_string());
        }
    }
    if !sample && !pending.is_empty() {
        return Err("CUSTOM_INCOMPLETE_LINE".to_string());
    }
    if stamp(file)? != before {
        return Err("SOURCE_BUSY".to_string());
    }
    Ok(ReadStats { bytes, lines })
}

pub fn scan(source: &Value, salt: &str, previous: &Value, audit: &mut Audit) -> Value {
    let config_hash = parser_hash(&source["definition"]);
    let version = source.get("version").and_then(|v| v.as_i64()).unwrap_or(1);
    let mut files = previous.as_object().cloned().unwrap_or_default();
    let mut diagnostics = json!({"invalid": 0, "filtered": 0, "unsupported": 0, "retained": 0, "errors": []});
    let deadline = crate::time::now_ms() as f64 + 55000.0;
    let (found_files, issues) = match listing(source, audit) {
        Ok(found) => found,
        Err(error) => {
            diagnostics["errors"].as_array_mut().unwrap().push(json!(error));
            (Vec::new(), Vec::new())
        }
    };
    for issue in issues {
        diagnostics["errors"].as_array_mut().unwrap().push(json!(issue));
    }
    let mut complete: HashSet<String> = HashSet::new();
    for file in &found_files {
        let key = digest(salt, &format!("{}:file:{}", source["id"].as_str().unwrap_or(""), file.to_lowercase()));
        if crate::time::now_ms() as f64 > deadline {
            diagnostics["errors"].as_array_mut().unwrap().push(json!("SOURCE_TIMEOUT"));
            break;
        }
        let file_stamp = match stamp(file) {
            Ok(file_stamp) => file_stamp,
            Err(error) => {
                diagnostics["errors"].as_array_mut().unwrap().push(json!(if Regex::new(r"^[A-Z_]+$").unwrap().is_match(&error) { error } else { "SOURCE_UNREADABLE".to_string() }));
                continue;
            }
        };
        let cached = files.get(&key);
        if cached.map(|c| c.get("stamp").and_then(|v| v.as_str()) == Some(file_stamp.as_str()) && c.get("configHash").and_then(|v| v.as_str()) == Some(config_hash.as_str())).unwrap_or(false) {
            complete.insert(key);
            continue;
        }
        let mut records = Vec::new();
        let mut counts = json!({"invalid": 0, "filtered": 0, "unsupported": 0});
        let mut failure: Option<String> = None;
        let result = read_file(
            file,
            &mut |line| {
                let obj: Value = match serde_json::from_str(line) {
                    Ok(obj) => obj,
                    Err(_) => {
                        counts["invalid"] = json!(counts["invalid"].as_u64().unwrap_or(0) + 1);
                        return;
                    }
                };
                match parse(&obj, source, salt) {
                    Outcome::Record(record) => records.push(record),
                    Outcome::Invalid => counts["invalid"] = json!(counts["invalid"].as_u64().unwrap_or(0) + 1),
                    Outcome::Unsupported => counts["unsupported"] = json!(counts["unsupported"].as_u64().unwrap_or(0) + 1),
                    Outcome::Filtered => counts["filtered"] = json!(counts["filtered"].as_u64().unwrap_or(0) + 1),
                }
            },
            audit,
            false,
            deadline,
            MAX_LINE,
            200,
        );
        if let Err(error) = result {
            failure = Some(error);
        }
        if let Some(error) = failure {
            diagnostics["errors"].as_array_mut().unwrap().push(json!(if Regex::new(r"^[A-Z_]+$").unwrap().is_match(&error) { error } else { "SOURCE_UNREADABLE".to_string() }));
            continue;
        }
        files.insert(key.clone(), json!({"stamp": file_stamp, "configHash": config_hash, "version": version, "records": records, "counts": counts}));
        complete.insert(key);
    }
    let keys: Vec<String> = files.keys().cloned().collect();
    for key in keys {
        if !complete.contains(&key) {
            diagnostics["retained"] = json!(diagnostics["retained"].as_u64().unwrap_or(0) + 1);
        }
        let file = &files[&key];
        if file.get("configHash").and_then(|v| v.as_str()) != Some(config_hash.as_str()) {
            diagnostics["mixedRules"] = json!(diagnostics.get("mixedRules").and_then(|v| v.as_u64()).unwrap_or(0) + 1);
        }
        for kind in ["invalid", "filtered", "unsupported"] {
            let count = file.get("counts").and_then(|c| c.get(kind)).and_then(|v| v.as_u64()).unwrap_or(0);
            diagnostics[kind] = json!(diagnostics[kind].as_u64().unwrap_or(0) + count);
        }
    }
    let mut errors: Vec<Value> = Vec::new();
    for error in diagnostics["errors"].as_array().cloned().unwrap_or_default() {
        if !errors.contains(&error) {
            errors.push(error);
        }
    }
    diagnostics["errors"] = Value::Array(errors);
    let (records, duplicates, conflicts) = merge(&Value::Object(files.clone()));
    diagnostics["duplicates"] = json!(duplicates);
    diagnostics["conflicts"] = json!(conflicts);
    json!({"files": files, "records": records, "diagnostics": diagnostics, "fileCount": found_files.len(), "configHash": config_hash})
}

pub fn sample(source: &Value, audit: &mut Audit) -> Value {
    let mut fields: Vec<Value> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut rows = 0usize;
    let mut bytes = 0usize;
    fn walk(obj: &Value, prefix: &str, depth: usize, fields: &mut Vec<Value>, seen: &mut HashSet<String>) {
        if !object(Some(obj)) || depth > 12 || fields.len() >= 300 {
            return;
        }
        for (key, value) in obj.as_object().unwrap() {
            if !Regex::new(r"^[a-zA-Z0-9_$-]+$").unwrap().is_match(key) || ["__proto__", "prototype", "constructor", "content", "text", "messages", "prompt", "completion"].contains(&key.as_str()) {
                continue;
            }
            let dotted = if prefix.is_empty() { key.clone() } else { format!("{prefix}.{key}") };
            if object(Some(value)) {
                walk(value, &dotted, depth + 1, fields, seen);
            } else if !seen.contains(&dotted) {
                seen.insert(dotted.clone());
                let kind = match value {
                    Value::Null => "null",
                    Value::Array(_) => "array",
                    Value::Bool(_) => "boolean",
                    Value::Number(_) => "number",
                    Value::String(_) => "string",
                    _ => "object",
                };
                fields.push(json!({"path": dotted, "type": kind, "example": null}));
            }
        }
    }
    let (files, _) = listing(source, audit).unwrap_or_default();
    for file in files {
        if rows >= 200 || bytes >= MAX_LINE {
            break;
        }
        let result = read_file(
            &file,
            &mut |line| {
                if let Ok(obj) = serde_json::from_str::<Value>(line) {
                    walk(&obj, "", 0, &mut fields, &mut seen);
                }
            },
            audit,
            true,
            crate::time::now_ms() as f64 + 5000.0,
            MAX_LINE - bytes,
            200 - rows,
        );
        if let Ok(read) = result {
            rows += read.lines;
            bytes += read.bytes;
        }
    }
    json!({"fields": fields, "rows": rows, "bytes": bytes})
}

pub fn canonical(root: &str) -> Result<String, String> {
    let root = local_path(root)?;
    let mut existing = root.clone();
    let mut tail: Vec<String> = Vec::new();
    while fs::metadata(&existing).is_err() {
        let parent = path::dirname(&existing);
        if parent == existing {
            break;
        }
        tail.insert(0, path::basename(&existing));
        existing = parent;
    }
    let base = if fs::metadata(&existing).is_ok() { fs::canonicalize(&existing).map(|p| p.to_string_lossy().to_string()).unwrap_or(existing.clone()) } else { existing.clone() };
    let mut parts: Vec<&str> = vec![&base];
    parts.extend(tail.iter().map(|s| s.as_str()));
    Ok(path::resolve(&path::join(&parts)).to_lowercase())
}

pub fn overlaps(a: &str, b: &str) -> bool {
    let (x, y) = match (canonical(a), canonical(b)) {
        (Ok(x), Ok(y)) => (x, y),
        _ => return false,
    };
    x == y || x.starts_with(&format!("{y}\\")) || y.starts_with(&format!("{x}\\"))
}

pub fn check_roots(source: &Value, reserved: &[String], own: &[String]) -> Result<(), String> {
    let roots = source.get("roots").and_then(|v| v.as_array()).ok_or_else(|| "CUSTOM_ROOT_REQUIRED".to_string())?;
    if roots.is_empty() || roots.len() > 16 {
        return Err("CUSTOM_ROOT_REQUIRED".to_string());
    }
    let roots: Vec<&str> = roots.iter().filter_map(|v| v.as_str()).collect();
    for root in &roots {
        local_path(root)?;
        if own.iter().any(|other| overlaps(root, other)) {
            return Err("SOURCE_PRODUCT_OVERLAP".to_string());
        }
        if reserved.iter().any(|other| overlaps(root, other)) {
            return Err("CUSTOM_SOURCE_OVERLAP".to_string());
        }
    }
    for i in 0..roots.len() {
        for j in 0..i {
            if overlaps(roots[i], roots[j]) {
                return Err("CUSTOM_SOURCE_OVERLAP".to_string());
            }
        }
    }
    Ok(())
}

pub fn valid_saved(sources: Option<&Value>) -> bool {
    let sources = match sources {
        None => return true,
        Some(Value::Object(map)) => map,
        _ => return false,
    };
    fn valid(id: &str, source: &Value, previous: bool) -> bool {
        if !Regex::new(r"^custom-[a-f0-9-]{36}$").unwrap().is_match(id) || !object(Some(source)) {
            return false;
        }
        if source.get("id").and_then(|v| v.as_str()) != Some(id) {
            return false;
        }
        let name = match definition(source.get("definition").unwrap_or(&Value::Null)) {
            Ok(def) => def["name"].as_str().unwrap_or("").to_string(),
            Err(_) => return false,
        };
        if source.get("name").and_then(|v| v.as_str()) != Some(name.as_str()) {
            return false;
        }
        let version = source.get("version").and_then(|v| v.as_i64()).unwrap_or(-1);
        if !(1..=9_007_199_254_740_991).contains(&version)
            || !source.get("enabled").map(|v| v.is_boolean()).unwrap_or(false)
            || !source.get("archived").map(|v| v.is_boolean()).unwrap_or(false)
        {
            return false;
        }
        let roots = match source.get("roots").and_then(|v| v.as_array()) {
            Some(roots) if !roots.is_empty() && roots.len() <= 16 => roots,
            _ => return false,
        };
        if !object(source.get("files")) {
            return false;
        }
        for root in roots.iter().filter_map(|v| v.as_str()) {
            if local_path(root).is_err() {
                return false;
            }
        }
        if let Some(reserved) = source.get("reservedRoots") {
            match reserved.as_array() {
                Some(list) => {
                    for root in list.iter().filter_map(|v| v.as_str()) {
                        if local_path(root).is_err() {
                            return false;
                        }
                    }
                }
                None => return false,
            }
        }
        let hex64 = Regex::new(r"^[a-f0-9]{64}$").unwrap();
        for (key, file) in source["files"].as_object().unwrap() {
            if !hex64.is_match(key) || !object(Some(file)) || !hex64.is_match(file.get("configHash").and_then(|v| v.as_str()).unwrap_or("")) {
                return false;
            }
            let file_version = file.get("version").and_then(|v| v.as_i64()).unwrap_or(i64::MIN);
            if file_version == i64::MIN || file_version.abs() > 9_007_199_254_740_991 {
                return false;
            }
            let records = match file.get("records").and_then(|v| v.as_array()) {
                Some(records) => records,
                None => return false,
            };
            for record in records {
                if record.get("agent").and_then(|v| v.as_str()) != Some(id)
                    || !hex64.is_match(record.get("id").and_then(|v| v.as_str()).unwrap_or(""))
                    || number(record.get("totalTokens")).is_none()
                    || record.get("timestamp").and_then(|v| v.as_str()).and_then(parse_iso).is_none()
                {
                    return false;
                }
                for field in ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning"] {
                    let value = record.get(field).cloned().unwrap_or(Value::Null);
                    if !value.is_null() && number(Some(&value)).is_none() {
                        return false;
                    }
                }
            }
        }
        match source.get("previous") {
            None | Some(Value::Null) => true,
            Some(prev) => !previous && valid(id, prev, true),
        }
    }
    sources.iter().all(|(id, source)| valid(id, source, false))
}