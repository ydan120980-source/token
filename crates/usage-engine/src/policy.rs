use crate::agent_catalog::builtin_agents;
use crate::pathx as path;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::time::UNIX_EPOCH;

pub struct Audit {
    pub reads: u64,
}

impl Audit {
    pub fn new() -> Self {
        Audit { reads: 0 }
    }
}

pub fn sources() -> Vec<String> {
    builtin_agents().as_object().unwrap().keys().cloned().collect()
}

pub fn labels() -> Value {
    let agents = builtin_agents();
    let mut out = Map::new();
    for (id, meta) in agents.as_object().unwrap() {
        out.insert(id.clone(), meta.get("label").cloned().unwrap_or(Value::Null));
    }
    Value::Object(out)
}

pub fn mtime_ms(meta: &fs::Metadata) -> f64 {
    match meta.modified() {
        Ok(time) => match time.duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_secs() as f64 * 1000.0 + d.subsec_nanos() as f64 / 1e6,
            Err(e) => -(e.duration().as_secs() as f64 * 1000.0 + e.duration().subsec_nanos() as f64 / 1e6),
        },
        Err(_) => f64::NAN,
    }
}

fn home_list(home: &str, env: &HashMap<String, String>, variable: &str, fallback: &str) -> Vec<String> {
    let mut result = vec![path::join(&[home, fallback])];
    if let Some(value) = env.get(variable).filter(|v| !v.is_empty()) {
        if let Ok(local) = local_path(value) {
            if !result.contains(&local) {
                result.push(local);
            }
        }
    }
    result
}

pub fn roots(home: &str, env: &HashMap<String, String>) -> Value {
    let codex: Vec<String> = home_list(home, env, "CODEX_HOME", ".codex")
        .iter()
        .flat_map(|dir| [path::join(&[dir, "sessions"]), path::join(&[dir, "archived_sessions"])])
        .collect();
    let claude: Vec<String> = home_list(home, env, "CLAUDE_CONFIG_DIR", ".claude")
        .iter()
        .flat_map(|dir| [path::join(&[dir, "projects"]), path::join(&[dir, "transcripts"])])
        .collect();
    let appdata = env
        .get("APPDATA")
        .filter(|v| !v.is_empty())
        .cloned()
        .unwrap_or_else(|| path::join(&[home, "AppData", "Roaming"]));
    let copilot: Vec<String> = home_list(home, env, "COPILOT_HOME", ".copilot").iter().map(|dir| path::join(&[dir, "session-state"])).collect();
    let antigravity: Vec<String> = ["antigravity", "antigravity-cli", "antigravity-ide"].iter().map(|product| path::join(&[home, ".gemini", product, "brain"])).collect();
    json!({
        "codex": codex,
        "claude": claude,
        "opencode": [path::join(&[home, ".local/share/opencode"])],
        "workbuddy": [path::join(&[home, ".workbuddy/projects"]), path::join(&[home, ".workbuddy/workbuddy.db"]), path::join(&[home, ".workbuddy-ai/projects"]), path::join(&[home, ".workbuddy-ai/workbuddy.db"])],
        "mimo": [path::join(&[home, ".local/share/mimocode"])],
        "gemini": [path::join(&[home, ".gemini/tmp"])],
        "cursor": [path::join(&[home, ".cursor/projects"])],
        "zcode": [path::join(&[home, ".zcode/cli/db/db.sqlite"])],
        "deepseek": [path::join(&[home, ".dsh/sessions"]), path::join(&[home, ".dsh/profiles/desktop/sessions"])],
        "antigravity": antigravity,
        "copilot": copilot,
        "cline": [path::join(&[&appdata, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "tasks"]), path::join(&[home, ".cline", "data", "sessions"])],
        "pi": [path::join(&[home, ".pi", "agent", "sessions"])],
        "continue": [path::join(&[home, ".continue", "dev_data", "devdata.sqlite"])],
        "kilo": [path::join(&[&appdata, "Code", "User", "globalStorage", "kilocode.kilo-code", "tasks"]), path::join(&[home, ".local", "share", "kilo", "kilo.db"])],
        "qwen": [path::join(&[home, ".qwen", "projects"])],
        "kimi": [path::join(&[home, ".kimi", "sessions"]), path::join(&[home, ".kimi-code", "sessions"])]
    })
}

pub fn local_path(value: &str) -> Result<String, String> {
    let rejected = Regex::new(r"(?i)(^|[/\\])(?:auth|credentials|config|settings|storage)\.(?:json|toml)$").unwrap();
    if !path::is_absolute(value) || value.starts_with("//") || value.starts_with("\\\\") || value.contains('\0') || rejected.is_match(value) {
        return Err("SOURCE_PATH_REJECTED".to_string());
    }
    Ok(path::resolve(value))
}

pub fn allowed_file(agent: &str, file: &str) -> bool {
    let base = path::basename(file);
    let lower = base.to_ascii_lowercase();
    if Regex::new(r"(?i)^(?:auth|credentials|config|settings|storage|tokens?)(?:[._-]|$)").unwrap().is_match(&base) {
        return false;
    }
    if Regex::new(r"^custom-[a-f0-9-]{36}$").unwrap().is_match(agent) {
        return Regex::new(r"(?i)\.(?:jsonl|ndjson)$").unwrap().is_match(&base);
    }
    let parts: Vec<&str> = file.split(['/', '\\']).collect();
    let parent = path::basename(&path::dirname(file));
    let grand = path::basename(&path::dirname(&path::dirname(file)));
    match agent {
        "transcript:cline" | "transcript:kilo" => {
            (base == "api_conversation_history.json" && grand == "tasks")
                || (agent == "transcript:cline" && base.ends_with(".messages.json") && base == format!("{parent}.messages.json"))
        }
        "transcript:cursor" => {
            Regex::new(r"^[A-Za-z0-9_-]{1,128}\.jsonl$").unwrap().is_match(&base) && parts.contains(&"agent-transcripts") && parent != "subagents"
        }
        "transcript:cursor-sub" => {
            Regex::new(r"^[A-Za-z0-9_-]{1,128}\.jsonl$").unwrap().is_match(&base) && parent == "subagents" && parts.contains(&"agent-transcripts")
        }
        "transcript:legacy" => Regex::new(r"^[\w.-]{1,128}\.json$").unwrap().is_match(&base),
        "transcript:continue-index" => base == "sessions.json",
        "transcript:continue" => base != "sessions.json" && Regex::new(r"^[A-Za-z0-9_-]{1,128}\.json$").unwrap().is_match(&base),
        "pi" => base.ends_with(".jsonl"),
        "continue" => base == "devdata.sqlite",
        "kilo" => base == "kilo.db" || (base == "ui_messages.json" && grand == "tasks"),
        "qwen" => base.ends_with(".jsonl") && parent == "chats",
        "kimi" => base == "wire.jsonl",
        "cline" => (base == "ui_messages.json" && grand == "tasks") || (base.ends_with(".messages.json") && base == format!("{parent}.messages.json")),
        "copilot" => (base == "events.jsonl" && grand == "session-state") || (base.ends_with(".jsonl") && parts.contains(&"otel")),
        "codex" | "claude" => base.ends_with(".jsonl"),
        "workbuddy" => base.ends_with(".jsonl") || base == "workbuddy.db",
        "mimo" => Regex::new(r"^mimocode(?:[-\w]*)\.db$").unwrap().is_match(&base),
        "gemini" => {
            Regex::new(r"^(?:session-[\w.-]+|[a-f0-9-]{8,})\.(?:json|jsonl)$").unwrap().is_match(&base) && parts.contains(&"chats")
        }
        "cursor" => base == "index.db" || lower == "runs.ndjson" || Regex::new(r"(?i)\.csv$").unwrap().is_match(&base),
        "zcode" => base == "db.sqlite",
        "deepseek" => Regex::new(r"^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$").unwrap().is_match(&base),
        "antigravity" => {
            (base == "transcript_full.jsonl" || base == "transcript.jsonl")
                && parts.len() >= 5
                && parts[parts.len() - 2] == "logs"
                && parts[parts.len() - 3] == ".system_generated"
                && parts[parts.len() - 5] == "brain"
        }
        "opencode" => (base.ends_with(".json") && parts.contains(&"message")) || Regex::new(r"^opencode(?:[-\w]*)\.db$").unwrap().is_match(&base),
        _ => false,
    }
}

pub const DEPTH_LIMIT: usize = 16;
pub const FILES_LIMIT: usize = 100000;
const SKIPPED_DIRECTORIES: [&str; 5] = ["node_modules", ".git", "auth", "credentials", "cache"];

#[derive(Default)]
pub struct Listed {
    pub files: Vec<String>,
    pub limited: bool,
    pub aliased: bool,
    pub unreadable: bool,
}

fn fold(value: String) -> String {
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn realpath(value: &str) -> std::io::Result<String> {
    let resolved = fs::canonicalize(value)?;
    let text = resolved.to_string_lossy().to_string();
    // canonicalize yields \\?\ extended paths on Windows; keep them consistent
    // on both sides of the placement comparison.
    Ok(text)
}

pub fn files_under(agent: &str, root: &str, _audit: &mut Audit, descend: Option<&dyn Fn(&str, &str) -> bool>) -> Result<Listed, String> {
    let root = local_path(root)?;
    let mut output = Listed::default();
    let stat = match fs::symlink_metadata(&root) {
        Ok(stat) => stat,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(output),
        Err(_) => return Err("SOURCE_UNREADABLE".to_string()),
    };
    if stat.file_type().is_symlink() {
        return Err("SOURCE_SYMLINK_REJECTED".to_string());
    }
    let real = realpath(&root).map_err(|_| "SOURCE_UNREADABLE".to_string())?;
    fn walk(output: &mut Listed, agent: &str, root: &str, real: &str, directory: &str, depth: usize, descend: Option<&dyn Fn(&str, &str) -> bool>) -> Result<(), String> {
        if depth > DEPTH_LIMIT {
            output.limited = true;
            return Ok(());
        }
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(_) => {
                if depth == 0 {
                    return Err("SOURCE_UNREADABLE".to_string());
                }
                output.unreadable = true;
                return Ok(());
            }
        };
        let here = realpath(directory).ok().map(fold);
        let placed = here.as_deref() == Some(fold(path::join(&[real, &path::relative(root, directory)])).as_str());
        let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            if output.files.len() >= FILES_LIMIT {
                output.limited = true;
                return Ok(());
            }
            let file_type = match entry.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if file_type.is_symlink() {
                continue;
            }
            let full = path::join(&[directory, &entry.file_name().to_string_lossy()]);
            if file_type.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !SKIPPED_DIRECTORIES.contains(&name.as_str()) && descend.map(|f| f(directory, &name)).unwrap_or(true) {
                    walk(output, agent, root, real, &full, depth + 1, descend)?;
                }
            } else if file_type.is_file() && allowed_file(agent, &full) {
                if placed {
                    output.files.push(full);
                } else {
                    output.aliased = true;
                }
            }
        }
        Ok(())
    }
    if stat.is_dir() {
        walk(&mut output, agent, &root, &real, &root, 0, descend)?;
    } else if stat.is_file() && allowed_file(agent, &root) {
        output.files.push(root);
    }
    Ok(output)
}

pub fn read_bytes(file: &str, audit: &mut Audit) -> Result<Vec<u8>, String> {
    let stat = fs::symlink_metadata(file).map_err(|_| "SOURCE_SIZE_OR_LINK".to_string())?;
    if !stat.is_file() || stat.file_type().is_symlink() || stat.len() > 512 * 1024 * 1024 {
        return Err("SOURCE_SIZE_OR_LINK".to_string());
    }
    let mut handle = fs::File::open(file).map_err(|_| "SOURCE_SIZE_OR_LINK".to_string())?;
    audit.reads += 1;
    let mut bytes = Vec::new();
    handle.read_to_end(&mut bytes).map_err(|_| "SOURCE_SIZE_OR_LINK".to_string())?;
    let after = handle.metadata().map_err(|_| "SOURCE_SIZE_OR_LINK".to_string())?;
    if stat.len() != after.len() || mtime_ms(&stat) != mtime_ms(&after) {
        return Err("SOURCE_BUSY".to_string());
    }
    Ok(bytes)
}

pub fn project_root(file: &str, audit: &mut Audit) -> Option<String> {
    let parts: Vec<&str> = file.split(['/', '\\']).collect();
    let at = parts.iter().rposition(|p| *p == "chats")?;
    if at < 1 {
        return None;
    }
    let mut target_parts = parts[..at].to_vec();
    target_parts.push(".project_root");
    let target = target_parts.join("\\");
    let stat = fs::symlink_metadata(&target).ok()?;
    if !stat.is_file() || stat.file_type().is_symlink() || stat.len() > 4096 {
        return None;
    }
    let bytes = read_bytes(&target, audit).ok()?;
    Some(String::from_utf8_lossy(&bytes).trim().to_string())
}

pub fn thread_indexes(roots: &[String]) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for root in roots {
        let base = path::basename(root);
        if base == "sessions" || base == "archived_sessions" {
            let target = path::join(&[&path::dirname(root), "session_index.jsonl"]);
            if !files.contains(&target) {
                files.push(target);
            }
        }
    }
    files
}

pub fn thread_names(roots: &[String], audit: &mut Audit) -> HashMap<String, String> {
    let mut names = HashMap::new();
    for target in thread_indexes(roots) {
        let stat = match fs::symlink_metadata(&target) {
            Ok(stat) => stat,
            Err(_) => continue,
        };
        if !stat.is_file() || stat.file_type().is_symlink() || stat.len() > 16 * 1024 * 1024 {
            continue;
        }
        let bytes = match read_bytes(&target, audit) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        for line in String::from_utf8_lossy(&bytes).split('\n') {
            let row: Value = match serde_json::from_str(line) {
                Ok(row) => row,
                Err(_) => continue,
            };
            if let (Some(Value::String(id)), Some(Value::String(name))) = (row.get("id"), row.get("thread_name")) {
                if !name.trim().is_empty() {
                    names.insert(id.clone(), name.clone());
                }
            }
        }
    }
    names
}