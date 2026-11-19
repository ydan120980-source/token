// Session metadata: raw ID and working directory kept locally for the session
// list and resume command; never part of UsageSnapshotV1 (SESSIONS-LAYER1).
use crate::normalize::session_key;
use crate::pathx as path;
use regex::Regex;
use serde_json::{json, Map, Value};

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn has_control(value: &str) -> bool {
    value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}

pub fn js_trim(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

fn raw_id(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) if !text.is_empty() && utf16_len(text) <= 200 && !has_control(text) => Some(text.clone()),
        _ => None,
    }
}

pub fn directory(value: Option<&Value>) -> Option<String> {
    let text = match value {
        Some(Value::String(text)) => text,
        _ => return None,
    };
    if utf16_len(text) > 1024 || has_control(text) {
        return None;
    }
    let trimmed = js_trim(text);
    let win = path::is_absolute(trimmed) && !trimmed.starts_with("//") && !trimmed.starts_with("\\\\");
    let posix = trimmed.starts_with('/') && !trimmed.starts_with("//");
    if win || posix {
        Some(trimmed.to_string())
    } else {
        None
    }
}

pub fn title(value: Option<&Value>) -> Option<String> {
    let text = match value {
        Some(Value::String(text)) => text,
        _ => return None,
    };
    let control = Regex::new(r"[\x00-\x1f\x7f]+").unwrap();
    let spaces = Regex::new(r"\s+").unwrap();
    let cleaned = control.replace_all(text, " ");
    let line = spaces.replace_all(&cleaned, " ");
    let line = js_trim(&line);
    if line.is_empty() {
        return None;
    }
    Some(line.chars().take(120).collect())
}

pub fn observe(agent: &str, session: Option<&Value>, cwd: Option<&Value>, salt: &str, name: Option<&Value>) -> Option<Value> {
    let id = raw_id(session)?;
    let key = session_key(agent, Some(&json!(id)), salt);
    Some(json!({"key": key, "id": id, "cwd": directory(cwd), "title": title(name)}))
}

// A later file fills a missing directory but never replaces one; a later title
// replaces an earlier one (a rename is appended after the title it replaces).
pub fn merge(map: &mut Map<String, Value>, entries: &[Value]) {
    for entry in entries {
        let key = entry.get("key").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let next = match map.get(&key) {
            Some(old) => json!({
                "key": key,
                "id": old.get("id").cloned().unwrap_or(Value::Null),
                "cwd": old.get("cwd").filter(|v| !v.is_null()).cloned().unwrap_or_else(|| entry.get("cwd").cloned().unwrap_or(Value::Null)),
                "title": entry.get("title").filter(|v| !v.is_null()).cloned().or_else(|| old.get("title").cloned()).unwrap_or(Value::Null)
            }),
            None => json!({
                "key": key,
                "id": entry.get("id").cloned().unwrap_or(Value::Null),
                "cwd": entry.get("cwd").cloned().unwrap_or(Value::Null),
                "title": entry.get("title").cloned().unwrap_or(Value::Null)
            }),
        };
        map.insert(key, next);
    }
}

pub fn project_name(cwd: Option<&str>) -> Option<String> {
    let cwd = cwd.filter(|c| !c.is_empty())?;
    let parts: Vec<&str> = cwd.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    Some(parts.last().map(|p| p.to_string()).unwrap_or_else(|| cwd.to_string()))
}

fn resume_base(agent: &str, id: &str) -> Option<String> {
    match agent {
        "codex" => Some(format!("codex resume {id}")),
        "claude" => Some(format!("claude --resume {id}")),
        "opencode" => Some(format!("opencode -s {id}")),
        "gemini" => Some(format!("gemini --resume {id}")),
        "mimo" => Some(format!("mimo -s {id}")),
        "antigravity" => Some(format!("agy --conversation={id}")),
        _ => None,
    }
}

pub fn resume_command(agent: &str, session: Option<&Value>) -> Option<String> {
    let session = session?;
    let id = session.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if !Regex::new(r"^[A-Za-z0-9_-]{1,128}$").unwrap().is_match(id) {
        return None;
    }
    let command = resume_base(agent, id)?;
    match session.get("cwd").and_then(|v| v.as_str()).filter(|c| !c.is_empty()) {
        Some(cwd) => {
            // PowerShell closes single-quoted strings on U+2018..U+201B too;
            // every quote character is doubled like the ASCII quote.
            let escaped: String = cwd.chars().flat_map(|c| if c == '\'' || ('\u{2018}'..='\u{201b}').contains(&c) { vec![c, c] } else { vec![c] }).collect();
            Some(format!("Set-Location -LiteralPath '{escaped}'; {command}"))
        }
        None => Some(command),
    }
}