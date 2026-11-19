// The collection scan: listing, stamps, per-file parsing and cross-source
// snapshot folding. Field projection only; no source mutation or network.
use crate::antigravity;
use crate::batch1_extra as extra;
use crate::batch1_sources as batch1;
use crate::extended_sources as extended;
use crate::js_json::stringify;
use crate::normalize::{normalize, number};
use crate::parsed::{object, or, truthy, Parsed};
use crate::pathx as path;
use crate::policy::{self, mtime_ms, read_bytes, sources, Audit};
use crate::sessions::{self, observe};
use crate::sqlite_memory::{query, read_database};
use crate::time::now_ms;
use crate::usage_snapshot::{keep_identity, select_usage_snapshot, CONFLICT};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const SESSION_SOURCES: [&str; 7] = ["codex", "claude", "opencode", "mimo", "workbuddy", "gemini", "deepseek"];

#[derive(Clone, Default)]
pub struct AgentResult {
    pub records: Vec<Value>,
    pub sessions: Vec<Value>,
    pub detected: bool,
    pub file_count: usize,
    pub skipped: usize,
    pub partial: bool,
    pub errors: Vec<String>,
    pub duration_ms: f64,
}

impl AgentResult {
    pub fn to_value(&self) -> Value {
        json!({"records": self.records, "sessions": self.sessions, "detected": self.detected, "fileCount": self.file_count,
            "skipped": self.skipped, "partial": self.partial, "errors": self.errors, "durationMs": self.duration_ms})
    }
}

pub type Scan = indexmap::IndexMap<String, AgentResult>;

pub fn scan_to_value(scan: &Scan) -> Value {
    Value::Object(scan.iter().map(|(agent, result)| (agent.clone(), result.to_value())).collect())
}

fn rows_to_values(rows: Vec<Map<String, Value>>) -> Vec<Value> {
    rows.into_iter().map(Value::Object).collect()
}

fn note(agent: &str, session: Option<&Value>, cwd: Option<&Value>, salt: &str, name: Option<&Value>, seen: &mut Map<String, Value>) {
    if SESSION_SOURCES.contains(&agent) {
        if let Some(entry) = observe(agent, session, cwd, salt, name) {
            sessions::merge(seen, &[entry]);
        }
    }
}

pub fn parse_objects(agent: &str, objects: &[Value], salt: &str, fallback_session: &str) -> Parsed {
    if agent == "kilo" {
        return extra::kilo(objects, salt);
    }
    if agent == "gemini" {
        return extended::gemini(objects, salt, fallback_session);
    }
    if agent == "cursor" {
        return extended::cursor(objects, salt);
    }
    let mut parsed = Parsed::new();
    let mut seen = Map::new();
    let mut session = fallback_session.to_string();
    let mut model = json!("unknown");
    let mut entry = json!("unknown");
    let mut provider: Option<Value> = None;
    let mut fork = false;
    let mut canonical_session = json!(fallback_session);
    let mut current: Option<String> = None;
    let mut previous: Option<Value> = None;
    let mut previous_signature: Option<String> = None;
    let mut lane_signatures: HashMap<String, String> = HashMap::new();
    for obj in objects {
        if !obj.is_object() {
            continue;
        }
        if agent == "codex" {
            let p = obj.get("payload").filter(|v| object(Some(v))).cloned().unwrap_or(json!({}));
            let obj_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if obj_type == "session_meta" {
                if truthy(p.get("id")) {
                    session = crate::normalize::scalar_string(&p["id"]);
                }
                provider = p.get("model_provider").cloned();
                let origin = crate::normalize::scalar_string(or(p.get("originator"), p.get("source")).unwrap_or(&json!("")));
                let lower = origin.to_lowercase();
                entry = json!(if lower.contains("desktop") || lower.contains("vscode") || lower.contains("app") {
                    "desktop"
                } else if lower.contains("cli") {
                    "cli"
                } else {
                    "unknown"
                });
                fork = truthy(p.get("forked_from_id")) || truthy(p.get("forked_from"));
                canonical_session = or(p.get("forked_from_id"), p.get("forked_from")).cloned().unwrap_or_else(|| json!(session.clone()));
                if truthy(p.get("id")) {
                    note(agent, p.get("id"), p.get("cwd"), salt, None, &mut seen);
                }
            }
            if obj_type == "turn_context" && truthy(p.get("model")) {
                model = p["model"].clone();
            }
            if obj_type != "event_msg" || p.get("type").and_then(|v| v.as_str()) != Some("token_count") || !truthy(p.get("info")) {
                continue;
            }
            let info = &p["info"];
            if truthy(info.get("model")) || truthy(info.get("model_name")) {
                model = or(info.get("model"), info.get("model_name")).cloned().unwrap();
            }
            let cumulative = info.get("total_token_usage").filter(|v| truthy(Some(v))).cloned();
            let last = info.get("last_token_usage").filter(|v| truthy(Some(v))).cloned();
            let signature = stringify(&json!([cumulative, last]));
            let lane = crate::normalize::scalar_string(
                or(p.get("rate_limits").and_then(|r| r.get("limit_id")), or(p.get("limit_id"), Some(&json!("default")))).unwrap(),
            );
            if let Some(cumulative) = &cumulative {
                if previous_signature.as_deref() == Some(signature.as_str()) || lane_signatures.get(&lane).map(|s| s == &signature).unwrap_or(false) {
                    previous = Some(cumulative.clone());
                    continue;
                }
            }
            previous_signature = Some(signature.clone());
            if cumulative.is_some() {
                lane_signatures.insert(lane, signature);
            }
            let mut usage = last.clone();
            if usage.is_none() {
                if let Some(cumulative) = &cumulative {
                    if !(fork && previous.is_none()) {
                        let mut built = Map::new();
                        let reset = previous.as_ref().map(|prev| cumulative.get("total_tokens").and_then(|v| v.as_f64()).unwrap_or(f64::NAN) < prev.get("total_tokens").and_then(|v| v.as_f64()).unwrap_or(f64::NAN)).unwrap_or(false);
                        if let Some(entries) = cumulative.as_object() {
                            for (key, value) in entries {
                                if let Some(value) = number(Some(value)) {
                                    let base = if reset { 0 } else { previous.as_ref().and_then(|prev| prev.get(key)).and_then(|v| v.as_f64()).unwrap_or(0.0) as i64 };
                                    built.insert(key.clone(), json!((value - base).max(0)));
                                }
                            }
                        }
                        usage = Some(Value::Object(built));
                    }
                }
            }
            previous = cumulative.clone().or(previous);
            let usage = match usage {
                Some(usage) => usage,
                None => continue,
            };
            let id = stringify(&json!([or(Some(&canonical_session), Some(&json!(session.clone()))), obj.get("timestamp"), cumulative.clone().unwrap_or_else(|| usage.clone())]));
            let record = normalize(
                agent,
                &usage,
                &json!({"session": session, "model": model, "entry": entry, "provider": provider, "time": obj.get("timestamp"), "id": id}),
                salt,
                "inclusive",
            );
            if let Some(mut record) = record {
                record["requestInputTokens"] = match &last {
                    Some(last) => json!(number(last.get("input_tokens"))),
                    None => Value::Null,
                };
                parsed.records.push(record);
            }
        } else if agent == "claude" {
            let message = obj.get("message");
            if let Some(Value::String(id)) = obj.get("sessionId") {
                current = Some(id.clone());
                note(agent, Some(&json!(id)), obj.get("cwd"), salt, None, &mut seen);
            }
            if obj.get("type").and_then(|v| v.as_str()) == Some("custom-title") {
                let target = match obj.get("sessionId") {
                    Some(Value::String(id)) => json!(id),
                    _ => json!(current.clone().unwrap_or_else(|| fallback_session.to_string())),
                };
                note(agent, Some(&target), None, salt, obj.get("customTitle"), &mut seen);
                continue;
            }
            let usage = match message.and_then(|m| m.get("usage")) {
                Some(usage) if obj.get("type").and_then(|v| v.as_str()) == Some("assistant") && truthy(Some(usage)) => usage,
                _ => continue,
            };
            let record = normalize(
                agent,
                usage,
                &json!({"id": or(message.and_then(|m| m.get("id")), obj.get("uuid")),
                    "session": or(obj.get("sessionId"), Some(&json!(fallback_session))),
                    "model": message.and_then(|m| m.get("model")), "time": obj.get("timestamp"), "entry": "cli"}),
                salt,
                "exclusive",
            );
            if let Some(record) = record {
                parsed.records.push(record);
            }
        } else if agent == "workbuddy" {
            let data = obj.get("providerData");
            if let Some(Value::String(_)) = obj.get("cwd") {
                note(agent, or(obj.get("sessionId"), Some(&json!(fallback_session))), obj.get("cwd"), salt, None, &mut seen);
            }
            let usage = or(data.and_then(|d| d.get("rawUsage")), or(data.and_then(|d| d.get("usage")), obj.get("usage")));
            let usage = match usage {
                Some(usage) if truthy(Some(usage)) => usage,
                _ => continue,
            };
            let record = normalize(
                agent,
                usage,
                &json!({"id": or(data.and_then(|d| d.get("messageId")), obj.get("id")),
                    "model": or(data.and_then(|d| d.get("requestModelId")), obj.get("model")),
                    "time": obj.get("timestamp"), "session": or(obj.get("sessionId"), Some(&json!(fallback_session)))}),
                salt,
                "inclusive",
            );
            if let Some(record) = record {
                parsed.records.push(record);
            }
        } else {
            if obj.get("role").and_then(|v| v.as_str()) != Some("assistant") || !truthy(obj.get("tokens")) {
                continue;
            }
            note(agent, or(obj.get("sessionID"), obj.get("session_id")), None, salt, None, &mut seen);
            let record = normalize(
                agent,
                &obj["tokens"],
                &json!({"id": obj.get("id"),
                    "session": or(obj.get("sessionID"), or(obj.get("session_id"), Some(&json!(fallback_session)))),
                    "model": or(obj.get("modelID"), or(obj.get("model").and_then(|m| m.get("id")), obj.get("model"))),
                    "provider": or(obj.get("providerID"), obj.get("model").and_then(|m| m.get("providerID"))),
                    "time": obj.get("time").and_then(|t| t.get("created")).filter(|v| !v.is_null()).or_else(|| obj.get("timestamp")),
                    "entry": or(obj.get("entry"), Some(&json!("unknown")))}),
                salt,
                "exclusive",
            );
            if let Some(record) = record {
                parsed.records.push(record);
            }
        }
    }
    parsed.sessions = seen.values().cloned().collect();
    parsed
}

fn session_rows(agent: &str, db: &rusqlite::Connection, table: &str, column: &str, salt: &str) -> Result<Vec<Value>, String> {
    let tables: HashSet<String> = query(db, "SELECT name FROM sqlite_master WHERE type='table'")?.iter().filter_map(|r| r.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
    if !tables.contains(table) {
        return Ok(Vec::new());
    }
    let columns: HashSet<String> = query(db, &format!("PRAGMA table_info(\"{table}\")"))?.iter().filter_map(|r| r.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
    if !columns.contains("id") || !columns.contains(column) {
        return Ok(Vec::new());
    }
    let mut found = Map::new();
    for row in query(db, &format!("SELECT id, \"{column}\" AS directory FROM \"{table}\""))? {
        if let Some(entry) = observe(agent, row.get("id"), row.get("directory"), salt, None) {
            sessions::merge(&mut found, &[entry]);
        }
    }
    Ok(found.values().cloned().collect())
}

pub fn parse_database(agent: &str, file: &str, salt: &str, audit: &mut Audit) -> Result<Parsed, String> {
    read_database(file, audit, &mut |db| {
        if agent == "continue" {
            return Ok(extra::continue_rows(&rows_to_values(query(db, "SELECT id, model, provider, tokens_prompt, tokens_generated, timestamp FROM tokens_generated")?), salt));
        }
        if agent == "kilo" {
            return Ok(extra::kilo_database(&rows_to_values(query(db, "SELECT id, session_id, data FROM message")?), salt));
        }
        if agent == "cursor" {
            let mut parsed = Parsed::new();
            let mut invalid = false;
            for row in query(db, "SELECT run_id, agent_id, model, created_at, started_at, usage_json FROM runs WHERE usage_json IS NOT NULL")? {
                let usage: Value = match row.get("usage_json").and_then(|v| v.as_str()).and_then(|text| serde_json::from_str(text).ok()) {
                    Some(usage) => usage,
                    None => {
                        invalid = true;
                        continue;
                    }
                };
                let object = json!({"runId": row.get("run_id"), "agentId": row.get("agent_id"), "model": {"id": row.get("model")},
                    "createdAt": row.get("created_at"), "startedAt": row.get("started_at"), "usage": usage});
                let single = extended::cursor(&[object], salt);
                parsed.records.extend(single.records);
                if single.warnings.iter().any(|w| w == "SOURCE_ROW_INVALID") {
                    invalid = true;
                }
            }
            if invalid {
                parsed.warn("SOURCE_ROW_INVALID");
            }
            return Ok(parsed);
        }
        if agent == "zcode" {
            let mut parsed = extended::zcode(&rows_to_values(query(db, "SELECT id, session_id, provider_id, model_id, started_at, completed_at, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, provider_total_tokens, computed_total_tokens FROM model_usage")?), salt);
            parsed.sessions = session_rows(agent, db, "session", "directory", salt)?;
            return Ok(parsed);
        }
        if agent == "workbuddy" {
            let mut parsed = Parsed::new();
            for row in query(db, "SELECT session_id, used, updated_at FROM session_usage WHERE used IS NOT NULL")? {
                let record = normalize(
                    agent,
                    &json!({"total_tokens": row.get("used")}),
                    &json!({"id": format!("aggregate:{}", row.get("session_id").and_then(|v| v.as_str()).unwrap_or("")),
                        "session": row.get("session_id"), "time": row.get("updated_at"), "model": "unknown"}),
                    salt,
                    "inclusive",
                );
                if let Some(mut record) = record {
                    record["accountingKind"] = json!("session-aggregate");
                    parsed.records.push(record);
                }
            }
            parsed.sessions = session_rows(agent, db, "sessions", "cwd", salt)?;
            return Ok(parsed);
        }
        let tables: HashSet<String> = query(db, "SELECT name FROM sqlite_master WHERE type='table'")?.iter().filter_map(|r| r.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
        let mut rows = Vec::new();
        if tables.contains("message") {
            rows.extend(query(db, "SELECT id, session_id, data FROM message")?);
        }
        if tables.contains("session_message") {
            rows.extend(query(db, "SELECT id, session_id, data, type FROM session_message WHERE type='assistant'")?);
        }
        if !tables.contains("message") && !tables.contains("session_message") {
            return Err("DATABASE_SCHEMA_UNSUPPORTED".to_string());
        }
        let versions: HashMap<String, String> = if agent == "mimo" && tables.contains("session") {
            query(db, "SELECT id, version FROM session")?
                .iter()
                .filter_map(|r| Some((r.get("id")?.as_str()?.to_string(), r.get("version")?.as_str()?.to_string())))
                .collect()
        } else {
            HashMap::new()
        };
        let mut objects = Vec::new();
        let mut invalid = false;
        for row in &rows {
            let data: Value = match row.get("data").and_then(|v| v.as_str()).and_then(|text| serde_json::from_str(text).ok()) {
                Some(data) => data,
                None => {
                    invalid = true;
                    continue;
                }
            };
            if !object(Some(&data)) {
                invalid = true;
                continue;
            }
            let mut obj = data.as_object().cloned().unwrap_or_default();
            let role = data.get("role").filter(|v| truthy(Some(v))).cloned().or_else(|| row.get("type").cloned());
            if let Some(role) = role {
                obj.insert("role".into(), role);
            }
            let id = data.get("id").filter(|v| truthy(Some(v))).cloned().or_else(|| row.get("id").cloned());
            if let Some(id) = id {
                obj.insert("id".into(), id);
            }
            obj.insert("session_id".into(), row.get("session_id").cloned().unwrap_or(Value::Null));
            let version = row.get("session_id").and_then(|v| v.as_str()).and_then(|id| versions.get(id));
            obj.insert("entry".into(), json!(match version {
                Some(version) if version.starts_with("desktop-") => "desktop",
                Some(_) => "cli",
                None => "unknown",
            }));
            objects.push(Value::Object(obj));
        }
        let mut parsed = parse_objects(agent, &objects, salt, "database");
        if (agent == "opencode" || agent == "mimo") && tables.contains("session") {
            let columns: HashSet<String> = query(db, "PRAGMA table_info(session)")?.iter().filter_map(|r| r.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
            if columns.contains("directory") {
                let sql = format!("SELECT id, directory{} FROM session", if columns.contains("title") { ", title" } else { "" });
                let rows: HashMap<String, Map<String, Value>> = query(db, &sql)?.into_iter().filter_map(|r| Some((r.get("id")?.as_str()?.to_string(), r))).collect();
                parsed.sessions = parsed
                    .sessions
                    .iter()
                    .map(|entry| {
                        let row = entry.get("id").and_then(|v| v.as_str()).and_then(|id| rows.get(id));
                        let mut next = entry.as_object().cloned().unwrap_or_default();
                        let cwd = sessions::directory(row.and_then(|r| r.get("directory"))).or_else(|| entry.get("cwd").filter(|v| !v.is_null()).and_then(|v| v.as_str()).map(|s| s.to_string()));
                        next.insert("cwd".into(), json!(cwd));
                        let title = sessions::title(row.and_then(|r| r.get("title")))
                            .or_else(|| entry.get("title").filter(|v| !v.is_null()).and_then(|v| v.as_str()).map(|s| s.to_string()));
                        next.insert("title".into(), json!(title));
                        Value::Object(next)
                    })
                    .collect();
            }
        }
        if invalid {
            parsed.warn("SOURCE_ROW_INVALID");
        }
        Ok(parsed)
    })
}

pub fn file_stamp(file: &str, agent: &str) -> Result<String, String> {
    let stat = fs_metadata(file)?;
    let mut stamp = format!("{}:{}", stat.len(), stringify(&json!(mtime_ms(&stat))));
    if file.ends_with(".db") || file.ends_with(".sqlite") {
        match fs_metadata(&format!("{file}-wal")) {
            Ok(wal) => stamp += &format!("|wal:{}:{}", wal.len(), stringify(&json!(mtime_ms(&wal)))),
            Err(code) if code == "ENOENT" => {}
            Err(code) => return Err(code),
        }
    }
    if agent == "antigravity" {
        for companion in antigravity::companions(file) {
            match file_stamp(&companion, "") {
                Ok(inner) => stamp += &format!("|db:{inner}"),
                Err(code) if code == "ENOENT" => {}
                Err(code) => return Err(code),
            }
        }
    }
    Ok(stamp)
}

fn fs_metadata(file: &str) -> Result<std::fs::Metadata, String> {
    std::fs::metadata(file).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "ENOENT".to_string() } else { "SOURCE_UNREADABLE".to_string() })
}

fn continue_indexes(selected_roots: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(Value::Array(roots)) = selected_roots.get("continue") {
        for root in roots.iter().filter_map(|v| v.as_str()) {
            if path::basename(root) != "devdata.sqlite" {
                continue;
            }
            let dir = path::join(&[&path::dirname(&path::dirname(root)), "sessions"]);
            if let Ok(listed) = policy::files_under("transcript:continue-index", &dir, &mut Audit::new(), None) {
                for file in listed.files {
                    if path::dirname(&file) == dir {
                        out.push(file);
                    }
                }
            }
        }
    }
    out
}

fn continue_sessions(selected_roots: &Value, salt: &str, audit: &mut Audit) -> Vec<Value> {
    let mut seen = Vec::new();
    for file in continue_indexes(selected_roots) {
        let rows: Value = match read_bytes(&file, audit).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()) {
            Some(rows) => rows,
            None => continue,
        };
        if let Some(Value::Array(items)) = Some(&rows) {
            for row in items.iter().take(5000) {
                let created = row.get("dateCreated");
                let millis = match created {
                    Some(Value::Number(n)) => n.as_f64().filter(|v| v.is_finite() && *v > 0.0),
                    Some(Value::String(text)) => text.parse::<f64>().ok().filter(|v| v.is_finite() && *v > 0.0),
                    _ => None,
                };
                let at = match millis {
                    Some(millis) if millis.abs() <= 8_640_000_000_000_000.0 => Some(crate::time::iso_from_ms(millis.trunc() as i64)),
                    _ => crate::normalize::timestamp(created),
                };
                let at = match at {
                    Some(at) => at,
                    None => continue,
                };
                let cwd = match row.get("workspaceDirectory") {
                    Some(Value::String(text)) if text.starts_with("file:") => antigravity::file_url_to_path(text).ok(),
                    Some(Value::String(text)) => Some(text.clone()),
                    _ => None,
                };
                if let Some(mut meta) = observe("continue", row.get("sessionId"), cwd.as_ref().map(|c| json!(c)).as_ref(), salt, row.get("title")) {
                    meta["at"] = json!(at);
                    seen.push(meta);
                }
            }
        }
    }
    seen
}

fn index_stamps(agent: &str, selected_roots: &Value) -> Vec<Option<String>> {
    if agent == "continue" {
        return continue_indexes(selected_roots).iter().map(|file| file_stamp(file, agent).ok()).collect();
    }
    if agent != "codex" {
        return Vec::new();
    }
    let roots: Vec<String> = selected_roots.get("codex").and_then(|v| v.as_array()).map(|l| l.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect()).unwrap_or_default();
    policy::thread_indexes(&roots).iter().map(|file| file_stamp(file, agent).ok()).collect()
}

pub(crate) fn canonical(agent: &str, files: &[String]) -> Vec<String> {
    if agent == "deepseek" {
        extended::canonical_files(files)
    } else if agent == "antigravity" {
        antigravity::canonical(files)
    } else {
        files.to_vec()
    }
}

struct ListedFiles {
    detected: bool,
    files: Vec<String>,
    errors: Vec<String>,
}

fn list_files(agent: &str, selected_roots: &Value, audit: &mut Audit) -> ListedFiles {
    let mut detected = false;
    let mut files: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    if let Some(Value::Array(roots)) = selected_roots.get(agent) {
        for root in roots.iter().filter_map(|v| v.as_str()) {
            if std::fs::metadata(root).is_ok() {
                detected = true;
            }
            match policy::files_under(agent, root, audit, None) {
                Ok(listed) => {
                    for file in listed.files {
                        if !files.contains(&file) {
                            files.push(file);
                        }
                    }
                    if listed.limited {
                        errors.push("SOURCE_LIMIT".to_string());
                    }
                    if listed.aliased {
                        errors.push("SOURCE_ALIAS_REJECTED".to_string());
                    }
                    if listed.unreadable {
                        errors.push("SOURCE_UNREADABLE".to_string());
                    }
                }
                Err(error) => errors.push(if regex::Regex::new(r"^[A-Z_]+$").unwrap().is_match(&error) { error } else { "SOURCE_UNREADABLE".to_string() }),
            }
        }
    }
    ListedFiles { detected, files, errors }
}

pub struct SurveyEntry {
    pub agent: String,
    pub detected: bool,
    pub errors: Vec<String>,
    pub all: Vec<String>,
    pub files: Vec<String>,
    pub stamps: HashMap<String, Option<String>>,
    pub index: Vec<Option<String>>,
}

pub fn survey(selected_roots: &Value, audit: &mut Audit) -> Vec<SurveyEntry> {
    let mut agents = Vec::new();
    for agent in sources() {
        let listed = list_files(&agent, selected_roots, audit);
        let mut stamps = HashMap::new();
        for file in &listed.files {
            stamps.insert(file.clone(), file_stamp(file, &agent).ok());
        }
        agents.push(SurveyEntry {
            files: canonical(&agent, &listed.files),
            all: listed.files,
            detected: listed.detected,
            errors: listed.errors,
            index: index_stamps(&agent, selected_roots),
            stamps,
            agent,
        });
    }
    agents
}

pub fn source_stamp(selected_roots: &Value, salt: &str, audit: &mut Audit, prepared: Option<&[SurveyEntry]>) -> String {
    let owned;
    let walk = match prepared {
        Some(walk) => walk,
        None => {
            owned = survey(selected_roots, audit);
            &owned
        }
    };
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    for entry in walk {
        hasher.update(stringify(&json!([entry.agent, selected_roots.get(&entry.agent).cloned().unwrap_or(json!([])), entry.detected, entry.errors, entry.index])).as_bytes());
        for file in &entry.all {
            let stamp = entry.stamps.get(file).cloned().flatten().unwrap_or_else(|| "unreadable".to_string());
            hasher.update(format!("\0{file}\0{stamp}").as_bytes());
        }
    }
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Clone, Default)]
pub struct Outcome {
    pub records: Option<Vec<Value>>,
    pub sessions: Vec<Value>,
    pub partial: bool,
    pub skipped: usize,
    pub errors: Vec<String>,
    pub failure: Option<String>,
}

pub fn parse_file(agent: &str, file: &str, salt: &str, audit: &mut Audit) -> Outcome {
    let mut outcome = Outcome::default();
    let result = (|| -> Result<Parsed, String> {
        if file.ends_with(".db") || file.ends_with(".sqlite") {
            return parse_database(agent, file, salt, audit);
        }
        if regex::Regex::new(r"(?i)\.csv$").unwrap().is_match(file) {
            let bytes = read_bytes(file, audit)?;
            return extended::cursor_csv(&String::from_utf8_lossy(&bytes), salt);
        }
        let bytes = read_bytes(file, audit)?;
        let text = if agent == "deepseek" {
            extended::decode_deepseek(&bytes, file.ends_with(".zstd"), &mut || {
                outcome.partial = true;
                outcome.errors.push("DEEPSEEK_LOG_INCOMPLETE".to_string());
            })?
        } else {
            String::from_utf8_lossy(&bytes).to_string()
        };
        let mut objects: Vec<Value> = Vec::new();
        if file.ends_with(".json") {
            objects.push(serde_json::from_str(&text).map_err(|_| "SOURCE_PARSE_FAILED".to_string())?);
        } else {
            for line in text.split('\n') {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str(line) {
                    Ok(obj) => objects.push(obj),
                    Err(_) => {
                        outcome.partial = true;
                        outcome.skipped += 1;
                        if agent == "deepseek" {
                            break;
                        }
                    }
                }
            }
        }
        let mut parsed = if agent == "kilo" {
            batch1::cline(&objects, salt, file, "kilo")
        } else if agent == "qwen" {
            extra::qwen(&objects, salt)
        } else if agent == "kimi" {
            extra::kimi(&objects, salt, file)
        } else if ["copilot", "cline", "pi"].contains(&agent) {
            batch1::parse(agent, &objects, salt, file)
        } else if agent == "deepseek" {
            extended::deepseek(&objects, salt, file)?
        } else if agent == "antigravity" {
            antigravity::parse(&objects, file, salt, audit)
        } else {
            parse_objects(agent, &objects, salt, &path::basename(file))
        };
        if agent == "deepseek" {
            let header = objects.first();
            let entry = header
                .filter(|h| h.get("type").and_then(|v| v.as_str()) == Some("session"))
                .and_then(|h| observe(agent, h.get("id"), h.get("cwd"), salt, None));
            parsed.sessions = entry.map(|e| vec![e]).unwrap_or_default();
        }
        if agent == "gemini" {
            let cwd = policy::project_root(file, audit);
            let mut found = Map::new();
            for obj in &objects {
                let session = or(obj.get("sessionId"), obj.get("$set").and_then(|s| s.get("sessionId")));
                if let Some(entry) = observe(agent, session, cwd.as_ref().map(|c| json!(c)).as_ref(), salt, None) {
                    sessions::merge(&mut found, &[entry]);
                }
            }
            parsed.sessions = found.values().cloned().collect();
        }
        Ok(parsed)
    })();
    match result {
        Ok(parsed) => {
            for warning in parsed.warnings {
                outcome.errors.push(warning);
            }
            let records = parsed.records;
            let used: HashSet<String> = records.iter().filter_map(|r| r.get("sessionKey").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
            outcome.sessions = parsed.sessions.into_iter().filter(|entry| entry.get("key").and_then(|v| v.as_str()).map(|k| used.contains(k)).unwrap_or(false)).collect();
            outcome.records = Some(records);
        }
        Err(error) => {
            outcome.failure = Some(if regex::Regex::new(r"^[A-Z_]+$").unwrap().is_match(&error) { error } else { "SOURCE_PARSE_FAILED".to_string() });
        }
    }
    outcome
}

#[derive(Clone)]
pub struct CachedFile {
    pub stamp: String,
    pub outcome: Outcome,
}

pub struct ScanCache {
    pub salt: String,
    pub files: HashMap<String, CachedFile>,
    pub fingerprints: Option<HashMap<String, (String, String)>>,
    fingerprint_order: Vec<String>,
    pub listing: Option<String>,
    seen: HashSet<String>,
}

impl ScanCache {
    pub fn new(salt: &str, fingerprints: bool) -> Self {
        ScanCache {
            salt: salt.to_string(),
            files: HashMap::new(),
            fingerprints: if fingerprints { Some(HashMap::new()) } else { None },
            fingerprint_order: Vec::new(),
            listing: None,
            seen: HashSet::new(),
        }
    }

    fn remember(&mut self, key: &str, stamp: &str, signature: &str) {
        let fingerprints = self.fingerprints.as_mut().unwrap();
        if fingerprints.len() >= 100000 && !fingerprints.contains_key(key) {
            if let Some(first) = self.fingerprint_order.first().cloned() {
                fingerprints.remove(&first);
                self.fingerprint_order.remove(0);
            }
        }
        if !fingerprints.contains_key(key) {
            self.fingerprint_order.push(key.to_string());
        }
        fingerprints.insert(key.to_string(), (stamp.to_string(), signature.to_string()));
    }
}

fn outcome_signature(outcome: &Outcome) -> String {
    let value = json!({"records": outcome.records, "sessions": outcome.sessions, "partial": outcome.partial,
        "skipped": outcome.skipped, "errors": outcome.errors, "failure": outcome.failure});
    let mut hasher = Sha256::new();
    hasher.update(stringify(&value).as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn listing_signature(walk: &[SurveyEntry]) -> String {
    stringify(&Value::Array(walk.iter().map(|entry| json!([entry.agent, entry.detected, entry.errors, entry.index])).collect()))
}

fn parsed_file(agent: &str, file: &str, salt: &str, audit: &mut Audit, cache: Option<&mut ScanCache>, known_stamp: Option<Option<&str>>) -> Outcome {
    let cache = match cache {
        Some(cache) => cache,
        None => return parse_file(agent, file, salt, audit),
    };
    let key = format!("{agent}\0{file}");
    cache.seen.insert(key.clone());
    let stamp: Option<String> = match known_stamp {
        Some(known) => known.map(|s| s.to_string()),
        None => file_stamp(file, agent).ok(),
    };
    if let Some(hit) = cache.files.get(&key) {
        if let Some(stamp) = &stamp {
            if &hit.stamp == stamp {
                return hit.outcome.clone();
            }
        }
    }
    let outcome = parse_file(agent, file, salt, audit);
    match (&outcome.failure, &stamp) {
        (Some(_), _) | (_, None) => {
            cache.files.remove(&key);
            if let Some(fingerprints) = cache.fingerprints.as_mut() {
                fingerprints.remove(&key);
            }
        }
        (None, Some(stamp)) => {
            cache.files.insert(key.clone(), CachedFile { stamp: stamp.clone(), outcome: outcome.clone() });
            if cache.fingerprints.is_some() {
                let signature = outcome_signature(&outcome);
                cache.remember(&key, stamp, &signature);
            }
        }
    }
    outcome
}

pub struct RefreshReport {
    pub changed: bool,
    pub failures: usize,
}

pub fn refresh_cache(selected_roots: &Value, salt: &str, audit: &mut Audit, cache: &mut ScanCache, prepared: Option<&[SurveyEntry]>) -> RefreshReport {
    if cache.salt != salt {
        cache.files.clear();
        if let Some(fingerprints) = cache.fingerprints.as_mut() {
            fingerprints.clear();
        }
        cache.fingerprint_order.clear();
        cache.salt = salt.to_string();
        cache.listing = None;
    }
    let mut report = RefreshReport { changed: false, failures: 0 };
    let mut seen: HashSet<String> = HashSet::new();
    let owned;
    let walk = match prepared {
        Some(walk) => walk,
        None => {
            owned = survey(selected_roots, audit);
            &owned
        }
    };
    for entry in walk {
        for file in &entry.files {
            let key = format!("{}\0{file}", entry.agent);
            seen.insert(key.clone());
            let stamp = entry.stamps.get(file).cloned().flatten();
            let hit_stamp = cache.files.get(&key).map(|h| h.stamp.clone());
            let fingerprint = cache.fingerprints.as_ref().and_then(|f| f.get(&key).cloned());
            if let Some(stamp) = &stamp {
                if hit_stamp.as_deref() == Some(stamp.as_str()) || fingerprint.as_ref().map(|(s, _)| s == stamp).unwrap_or(false) {
                    continue;
                }
            }
            let outcome = parse_file(&entry.agent, file, salt, audit);
            if outcome.failure.is_some() || stamp.is_none() {
                cache.files.remove(&key);
                if let Some(fingerprints) = cache.fingerprints.as_mut() {
                    fingerprints.remove(&key);
                }
                report.failures += 1;
                report.changed = true;
                continue;
            }
            let stamp = stamp.unwrap();
            let serialized = outcome_signature(&outcome);
            let changed = match &fingerprint {
                Some((_, old)) => old != &serialized,
                None => match cache.files.get(&key) {
                    Some(hit) => outcome_signature(&hit.outcome) != serialized,
                    None => true,
                },
            };
            if changed {
                report.changed = true;
            }
            cache.files.insert(key.clone(), CachedFile { stamp: stamp.clone(), outcome });
            if cache.fingerprints.is_some() {
                cache.remember(&key, &stamp, &serialized);
            }
        }
    }
    let signature = listing_signature(walk);
    if cache.listing.as_deref() != Some(signature.as_str()) {
        cache.listing = Some(signature);
        report.changed = true;
    }
    let keys: Vec<String> = cache.files.keys().cloned().collect();
    for key in keys {
        if !seen.contains(&key) {
            cache.files.remove(&key);
            report.changed = true;
        }
    }
    if cache.fingerprints.is_some() {
        let keys: Vec<String> = cache.fingerprints.as_ref().unwrap().keys().cloned().collect();
        for key in keys {
            if !seen.contains(&key) {
                cache.fingerprints.as_mut().unwrap().remove(&key);
                report.changed = true;
            }
        }
    }
    report
}

pub struct ScanOptions<'a> {
    pub cache: Option<&'a mut ScanCache>,
    pub prepared: Option<&'a [SurveyEntry]>,
}

pub fn scan_sources(selected_roots: &Value, salt: &str, audit: &mut Audit, options: ScanOptions) -> Scan {
    let ScanOptions { mut cache, prepared } = options;
    if let Some(cache) = cache.as_mut() {
        if cache.salt != salt {
            cache.files.clear();
            if let Some(fingerprints) = cache.fingerprints.as_mut() {
                fingerprints.clear();
            }
            cache.fingerprint_order.clear();
            cache.salt = salt.to_string();
        }
        cache.seen = HashSet::new();
    }
    let mut result = Scan::new();
    let mut physical: HashSet<String> = HashSet::new();
    // shared key -> (owner agent, owner id, owner record)
    let mut shared: HashMap<String, (String, String, Value)> = HashMap::new();
    let owned;
    let walk = match prepared {
        Some(walk) => walk,
        None => {
            owned = survey(selected_roots, audit);
            &owned
        }
    };
    for entry in walk {
        let agent = entry.agent.clone();
        let mut records: HashMap<String, Value> = HashMap::new();
        let mut record_order: Vec<String> = Vec::new();
        let mut detailed_sessions: HashSet<String> = HashSet::new();
        let mut seen_sessions = Map::new();
        let mut file_count = 0usize;
        let mut skipped = 0usize;
        let mut partial = false;
        let started = now_ms();
        let detected = entry.detected;
        let mut errors: Vec<String> = entry.errors.clone();
        let add_error = |errors: &mut Vec<String>, code: &str| {
            if !errors.iter().any(|e| e == code) {
                errors.push(code.to_string());
            }
        };
        let mut all_files = entry.files.clone();
        if agent == "cursor"
            && all_files.iter().any(|f| regex::Regex::new(r"(?i)\.csv$").unwrap().is_match(f))
            && all_files.iter().any(|f| regex::Regex::new(r"(?i)\.(?:ndjson|db)$").unwrap().is_match(f))
        {
            add_error(&mut errors, "CURSOR_SOURCE_MODE_CONFLICT");
            all_files.clear();
        }
        if agent == "copilot"
            && all_files.iter().any(|f| path::basename(f) == "events.jsonl" && path::basename(&path::dirname(&path::dirname(f))) == "session-state")
            && all_files.iter().any(|f| f.split(['/', '\\']).any(|p| p == "otel"))
        {
            add_error(&mut errors, "COPILOT_SOURCE_MODE_CONFLICT");
            all_files.clear();
        }
        let mut encoding_conflicts: HashSet<String> = HashSet::new();
        if agent == "deepseek" {
            let mut counts: HashMap<String, usize> = HashMap::new();
            for file in &all_files {
                *counts.entry(path::dirname(file)).or_default() += 1;
            }
            for (dir, count) in counts {
                if count > 1 {
                    encoding_conflicts.insert(dir);
                    add_error(&mut errors, "DEEPSEEK_ENCODING_CONFLICT");
                }
            }
        }
        all_files.sort_by_key(|f| f.ends_with(".db"));
        for file in &all_files {
            if encoding_conflicts.contains(&path::dirname(file)) {
                continue;
            }
            if now_ms() - started > 55000 {
                add_error(&mut errors, "SOURCE_TIMEOUT");
                break;
            }
            if physical.contains(file) {
                continue;
            }
            file_count += 1;
            let known_stamp = if entry.stamps.contains_key(file) { Some(entry.stamps[file].as_deref()) } else { None };
            let outcome = parsed_file(&agent, file, salt, audit, cache.as_deref_mut(), known_stamp);
            if outcome.partial {
                partial = true;
            }
            skipped += outcome.skipped;
            for code in &outcome.errors {
                add_error(&mut errors, code);
            }
            if let Some(failure) = &outcome.failure {
                add_error(&mut errors, failure);
                continue;
            }
            let parsed = outcome.records.unwrap_or_default();
            physical.insert(file.clone());
            sessions::merge(&mut seen_sessions, &outcome.sessions);
            for record in parsed {
                if let Some(shared_key) = record.get("sharedKey").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                    if let Some((owner_agent, owner_id, owner)) = shared.get(&shared_key).cloned() {
                        if owner_agent != agent {
                            let choice = select_usage_snapshot(Some(&owner), &record);
                            let snapshot = keep_identity(&owner, &choice.record);
                            if let Some(previous) = result.get_mut(&owner_agent) {
                                for row in previous.records.iter_mut() {
                                    if row.get("id").and_then(|v| v.as_str()) == Some(owner_id.as_str()) {
                                        *row = snapshot.clone();
                                    }
                                }
                            }
                            shared.insert(shared_key.clone(), (owner_agent.clone(), owner_id, snapshot));
                            if choice.issue == Some(CONFLICT) {
                                add_error(&mut errors, CONFLICT);
                                if let Some(source) = result.get_mut(&owner_agent) {
                                    source.partial = true;
                                    if !source.errors.iter().any(|e| e == CONFLICT) {
                                        source.errors.push(CONFLICT.to_string());
                                    }
                                }
                            }
                            skipped += 1;
                            continue;
                        }
                    }
                }
                if agent == "workbuddy" {
                    let session_key = record.get("sessionKey").and_then(|v| v.as_str()).unwrap_or("");
                    if file.ends_with(".db") && detailed_sessions.contains(session_key) {
                        continue;
                    }
                    if !file.ends_with(".db") && !session_key.is_empty() {
                        detailed_sessions.insert(session_key.to_string());
                    }
                }
                let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let old = records.get(&id);
                let choice = select_usage_snapshot(old, &record);
                if choice.issue == Some(CONFLICT) {
                    add_error(&mut errors, CONFLICT);
                }
                if !records.contains_key(&id) {
                    record_order.push(id.clone());
                }
                records.insert(id.clone(), choice.record.clone());
                if let Some(shared_key) = record.get("sharedKey").and_then(|v| v.as_str()) {
                    shared.insert(shared_key.to_string(), (agent.clone(), id, choice.record));
                }
            }
        }
        if agent == "codex" && !seen_sessions.is_empty() {
            let roots: Vec<String> = selected_roots.get("codex").and_then(|v| v.as_array()).map(|l| l.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect()).unwrap_or_default();
            let names = policy::thread_names(&roots, audit);
            if !names.is_empty() {
                for session in seen_sessions.values_mut() {
                    let id = session.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    if let Some(name) = names.get(id) {
                        if let Some(title) = sessions::title(Some(&json!(name))) {
                            session["title"] = json!(title);
                        }
                    }
                }
            }
        }
        let mut retained: Vec<Value> = record_order
            .iter()
            .map(|id| records[id].clone())
            .filter(|record| {
                record.get("accountingKind").and_then(|v| v.as_str()) != Some("session-aggregate")
                    || !record.get("sessionKey").and_then(|v| v.as_str()).map(|k| detailed_sessions.contains(k)).unwrap_or(false)
            })
            .collect();
        if agent == "copilot" && retained.iter().any(|r| r.get("entry").and_then(|v| v.as_str()) == Some("cli")) {
            let intervals = batch1::copilot_intervals(&retained);
            for code in intervals.warnings {
                add_error(&mut errors, &code);
            }
            retained = intervals.records;
        }
        let listed = if agent == "continue" { continue_sessions(selected_roots, salt, audit) } else { Vec::new() };
        let mut sessions_out: Vec<Value> = seen_sessions.values().cloned().collect();
        sessions_out.extend(listed);
        result.insert(
            agent.clone(),
            AgentResult {
                records: retained,
                sessions: sessions_out,
                detected,
                file_count,
                skipped,
                partial: partial || !errors.is_empty(),
                errors,
                duration_ms: (now_ms() - started) as f64,
            },
        );
    }
    if let Some(cache) = cache.as_mut() {
        cache.listing = Some(listing_signature(walk));
        let keys: Vec<String> = cache.files.keys().cloned().collect();
        for key in keys {
            if !cache.seen.contains(&key) {
                cache.files.remove(&key);
            }
        }
        if cache.fingerprints.is_some() {
            let keys: Vec<String> = cache.fingerprints.as_ref().unwrap().keys().cloned().collect();
            for key in keys {
                if !cache.seen.contains(&key) {
                    cache.fingerprints.as_mut().unwrap().remove(&key);
                }
            }
        }
    }
    result
}
