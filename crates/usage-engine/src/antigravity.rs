// Antigravity (Google) local conversations: usage from PLANNER_RESPONSE rows,
// models from the conversation database's gen_metadata (field 1.19 only), the
// working directory and title from conversation_summaries.
use crate::normalize::{normalize, number, scalar_string};
use crate::parsed::Parsed;
use crate::pathx as path;
use crate::policy::Audit;
use crate::sessions::observe;
use crate::sqlite_memory::{query, read_database};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;

const FULL: &str = "transcript_full.jsonl";
const PLAIN: &str = "transcript.jsonl";

pub struct Located {
    pub id: String,
    pub product: String,
    pub database: String,
    pub summaries: String,
}

pub fn locate(file: &str) -> Located {
    let conversation = path::dirname(&path::dirname(&path::dirname(file)));
    let product = path::dirname(&path::dirname(&conversation));
    let id = path::basename(&conversation);
    Located {
        database: path::join(&[&product, "conversations", &format!("{id}.db")]),
        summaries: path::join(&[&product, "conversation_summaries.db"]),
        id,
        product: path::basename(&product),
    }
}

pub fn canonical(files: &[String]) -> Vec<String> {
    files
        .iter()
        .filter(|file| !(path::basename(file) == PLAIN && files.contains(&path::join(&[&path::dirname(file), FULL]))))
        .cloned()
        .collect()
}

pub fn allowed(file: &str) -> bool {
    let parts: Vec<&str> = file.split(['/', '\\']).collect();
    parts.len() >= 5
        && (parts[parts.len() - 1] == FULL || parts[parts.len() - 1] == PLAIN)
        && parts[parts.len() - 2] == "logs"
        && parts[parts.len() - 3] == ".system_generated"
        && parts[parts.len() - 5] == "brain"
}

pub fn companions(file: &str) -> Vec<String> {
    let located = locate(file);
    vec![located.database, located.summaries]
}

pub enum Field {
    Varint(f64),
    Bytes(Vec<u8>),
}

// Protocol buffer wire format: field number -> values. Malformed input throws.
pub fn message(bytes: &[u8]) -> Result<HashMap<u64, Vec<Field>>, String> {
    let invalid = || "ANTIGRAVITY_METADATA_INVALID".to_string();
    let mut fields: HashMap<u64, Vec<Field>> = HashMap::new();
    let mut i = 0usize;
    let varint = |i: &mut usize| -> Result<f64, String> {
        let mut value = 0f64;
        let mut scale = 1f64;
        for _ in 0..10 {
            if *i >= bytes.len() {
                return Err(invalid());
            }
            let byte = bytes[*i];
            *i += 1;
            value += (byte & 127) as f64 * scale;
            if byte & 128 == 0 {
                return Ok(value);
            }
            scale *= 128.0;
        }
        Err(invalid())
    };
    while i < bytes.len() {
        let key = varint(&mut i)?;
        let field = (key / 8.0).floor() as u64;
        let wire = (key % 8.0) as u64;
        let value = match wire {
            0 => Field::Varint(varint(&mut i)?),
            2 => {
                let length = varint(&mut i)? as usize;
                if i + length > bytes.len() {
                    return Err(invalid());
                }
                let value = Field::Bytes(bytes[i..i + length].to_vec());
                i += length;
                value
            }
            1 => {
                i += 8;
                continue;
            }
            5 => {
                i += 4;
                continue;
            }
            _ => return Err(invalid()),
        };
        fields.entry(field).or_default().push(value);
    }
    if i != bytes.len() {
        return Err(invalid());
    }
    Ok(fields)
}

// Ok(Some(name)): a model; Ok(None): well-formed generation without one (dropped);
// Err: undecodable row (kept as null so counts disagree instead of shifting).
fn model_of(blob: &[u8]) -> Result<Option<String>, ()> {
    let generation = match message(blob) {
        Ok(fields) => match fields.get(&1).and_then(|v| v.first()) {
            Some(Field::Bytes(bytes)) => bytes.clone(),
            _ => return Err(()),
        },
        Err(_) => return Err(()),
    };
    match message(&generation) {
        Ok(fields) => match fields.get(&19).and_then(|v| v.first()) {
            Some(Field::Bytes(name)) => Ok(Some(String::from_utf8_lossy(name).to_string())),
            _ => Ok(None),
        },
        Err(_) => Err(()),
    }
}

fn blob_bytes(value: &Value) -> Vec<u8> {
    value.as_array().map(|items| items.iter().filter_map(|v| v.as_u64()).map(|b| b as u8).collect()).unwrap_or_default()
}

fn models(file: &str, audit: &mut Audit) -> Option<Vec<Option<String>>> {
    let located = locate(file);
    if !fs::metadata(&located.database).map(|m| m.is_file()).unwrap_or(false) {
        return None;
    }
    read_database(&located.database, audit, &mut |db| {
        let rows = query(db, "SELECT data FROM gen_metadata ORDER BY idx")?;
        Ok(rows
            .iter()
            .filter_map(|row| match model_of(&blob_bytes(row.get("data").unwrap_or(&Value::Null))) {
                Ok(name) => Some(name),
                Err(_) => Some(None),
            })
            .collect::<Vec<Option<String>>>())
    })
    .ok()
}

pub fn file_url_to_path(url: &str) -> Result<String, String> {
    let invalid = || "ERR_INVALID_FILE_URL_PATH".to_string();
    let rest = url.strip_prefix("file://").ok_or_else(invalid)?;
    let (authority, path_part) = match rest.find('/') {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, ""),
    };
    if !authority.is_empty() && authority != "localhost" {
        return Err(invalid());
    }
    let mut decoded: Vec<u8> = Vec::new();
    let bytes = path_part.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(invalid());
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|_| invalid())?;
            let byte = u8::from_str_radix(hex, 16).map_err(|_| invalid())?;
            if byte == b'/' || byte == b'\\' {
                return Err(invalid());
            }
            decoded.push(byte);
            i += 3;
        } else {
            decoded.push(bytes[i]);
            i += 1;
        }
    }
    let decoded = String::from_utf8(decoded).map_err(|_| invalid())?;
    if cfg!(windows) {
        let trimmed = decoded.strip_prefix('/').unwrap_or(&decoded);
        if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' && trimmed.as_bytes()[0].is_ascii_alphabetic() {
            return Ok(trimmed.replace('/', "\\"));
        }
        if decoded.starts_with('/') {
            return Ok(decoded.replace('/', "\\"));
        }
        return Err(invalid());
    }
    Ok(decoded)
}

fn workspace(file: &str, audit: &mut Audit) -> Value {
    let none = json!({"cwd": null, "title": null});
    let located = locate(file);
    if !Regex::new(r"^[\w-]{1,80}$").unwrap().is_match(&located.id) || !fs::metadata(&located.summaries).map(|m| m.is_file()).unwrap_or(false) {
        return none;
    }
    let id = located.id.clone();
    let result = read_database(&located.summaries, audit, &mut |db| {
        let columns: Vec<String> = query(db, "PRAGMA table_info(\"conversation_summaries\")")?.iter().filter_map(|r| r.get("name").and_then(|v| v.as_str()).map(|s| s.to_string())).collect();
        let sql = format!("SELECT workspace_uris{} FROM conversation_summaries WHERE conversation_id = ?1", if columns.iter().any(|c| c == "title") { ", title" } else { "" });
        let mut statement = db.prepare(&sql).map_err(|e| format!("SQL_ERROR:{e}"))?;
        let has_title = columns.iter().any(|c| c == "title");
        let rows = statement
            .query_map([&id], |row| {
                let uris: Option<String> = row.get(0)?;
                let title: Option<String> = if has_title { row.get(1)? } else { None };
                Ok((uris, title))
            })
            .map_err(|e| format!("SQL_ERROR:{e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("SQL_ERROR:{e}"))?);
        }
        Ok(out)
    });
    let rows = match result {
        Ok(rows) => rows,
        Err(_) => return none,
    };
    if rows.len() != 1 {
        return none;
    }
    let (uris, title) = &rows[0];
    let cwd = uris
        .as_deref()
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| {
            let items = value.as_array()?;
            if items.len() != 1 {
                return None;
            }
            let uri = items[0].as_str()?;
            if !uri.starts_with("file:///") {
                return None;
            }
            file_url_to_path(uri).ok()
        });
    json!({"cwd": cwd, "title": title})
}

pub fn parse(objects: &[Value], file: &str, salt: &str, audit: &mut Audit) -> Parsed {
    let mut parsed = Parsed::new();
    let located = locate(file);
    let entry_name = match located.product.as_str() {
        "antigravity" | "antigravity-ide" => "desktop",
        "antigravity-cli" => "cli",
        _ => "unknown",
    };
    let mut calls: Vec<&Value> = objects
        .iter()
        .filter(|row| {
            row.is_object()
                && row.get("type").and_then(|v| v.as_str()) == Some("PLANNER_RESPONSE")
                && number(row.get("input_tokens")).is_some()
                && row.get("step_index").and_then(|v| v.as_f64()).map(|v| v.is_finite() && v.fract() == 0.0 && v.abs() <= 9_007_199_254_740_991.0).unwrap_or(false)
        })
        .collect();
    calls.sort_by(|a, b| a["step_index"].as_f64().unwrap().partial_cmp(&b["step_index"].as_f64().unwrap()).unwrap());
    let names = if calls.is_empty() { None } else { models(file, audit) };
    let paired = names.as_ref().map(|n| n.len() == calls.len()).unwrap_or(false);
    for (index, call) in calls.iter().enumerate() {
        let model = if paired { names.as_ref().unwrap()[index].clone().filter(|m| !m.is_empty()).map(|m| json!(m)).unwrap_or(json!("unknown")) } else { json!("unknown") };
        let record = normalize(
            "antigravity",
            &json!({"input_tokens": call.get("input_tokens"), "output_tokens": call.get("output_tokens"), "cached_input_tokens": call.get("cache_read_tokens")}),
            &json!({"id": format!("{}:{}", located.id, scalar_string(&call["step_index"])), "session": located.id, "model": model, "time": call.get("created_at"), "entry": entry_name}),
            salt,
            "exclusive",
        );
        if let Some(record) = record {
            parsed.records.push(record);
        }
    }
    if !calls.is_empty() && !paired {
        parsed.warn("ANTIGRAVITY_MODEL_UNPAIRED");
    }
    let place = if calls.is_empty() { None } else { Some(workspace(file, audit)) };
    if let Some(place) = place {
        if let Some(entry) = observe("antigravity", Some(&json!(located.id)), place.get("cwd"), salt, place.get("title")) {
            parsed.sessions.push(entry);
        }
    }
    parsed
}