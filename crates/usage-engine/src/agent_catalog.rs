use serde_json::{json, Map, Value};

const DEFINITIONS: [(&str, &str, &str, &str); 17] = [
    ("codex", "Codex", "Codex Desktop / CLI", "会话日志 · Desktop / CLI"),
    ("claude", "Claude Code", "Claude Code", "项目会话 · assistant 用量"),
    ("opencode", "OpenCode", "OpenCode", "SQLite 或历史 message JSON"),
    ("workbuddy", "WorkBuddy", "WorkBuddy", "会话明细优先 · 数据库总量作为补充"),
    ("mimo", "MiMo Code", "MiMo Code / Desktop", "SQLite · CLI / Desktop"),
    ("gemini", "Gemini CLI", "Gemini CLI", "本地 chats · JSON / JSONL"),
    ("cursor", "Cursor", "Cursor SDK / 用量导出", "自动读取 SDK index.db；也可选择 runs.ndjson 或逐请求 CSV。普通聊天记录未提供用量时无法计量"),
    ("zcode", "ZCode", "ZCode", "本地 model_usage · 每次模型调用"),
    ("deepseek", "DeepSeek Harness", "DeepSeek Harness", "本地会话 · JSONL / Zstandard · v2–v4"),
    ("antigravity", "Antigravity", "Antigravity", "对话记录 · 用量来自 transcript，模型来自对话库"),
    ("copilot", "GitHub Copilot", "GitHub Copilot CLI", "本地 session-state · 可选 OTel 调用记录"),
    ("cline", "Cline", "Cline IDE / CLI", "任务调用用量 · IDE / CLI"),
    ("pi", "Pi", "Pi coding agent", "v3 会话 JSONL · assistant 用量"),
    ("continue", "Continue", "Continue", "本地 devdata.sqlite · 客户端估算用量"),
    ("kilo", "Kilo Code", "Kilo Code IDE / CLI", "任务用量 · IDE / CLI 数据库"),
    ("qwen", "Qwen Code", "Qwen Code", "本地 chats JSONL · usageMetadata"),
    ("kimi", "Kimi", "Kimi CLI / Code", "本地 wire JSONL · 逐调用用量"),
];

const USAGE_ONLY: [&str; 7] = ["copilot", "cline", "pi", "continue", "kilo", "qwen", "kimi"];

pub fn is_builtin(id: &str) -> bool {
    DEFINITIONS.iter().any(|(agent, ..)| *agent == id)
}

pub fn builtin_icon(id: &str) -> Option<String> {
    if is_builtin(id) {
        Some(format!("agents/{id}"))
    } else {
        None
    }
}

pub fn custom_id(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("custom-") else { return false };
    rest.len() == 36 && rest.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

pub fn builtin_agents() -> Value {
    let mut agents = Map::new();
    for (id, name, label, hint) in DEFINITIONS {
        let mut meta = Map::new();
        meta.insert("name".into(), json!(name));
        meta.insert("label".into(), json!(label));
        meta.insert("hint".into(), json!(hint));
        meta.insert("icon".into(), json!(format!("agents/{id}")));
        meta.insert("quota".into(), json!(id == "codex"));
        if USAGE_ONLY.contains(&id) {
            meta.insert("usageOnly".into(), json!(true));
        }
        agents.insert(id.into(), Value::Object(meta));
    }
    Value::Object(agents)
}