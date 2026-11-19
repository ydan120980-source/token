use crate::agent_catalog::{builtin_agents, custom_id};
use crate::js_json::stringify;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

pub fn revision(agents: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(stringify(agents).as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn catalog(state: &Value) -> Value {
    let mut agents = builtin_agents();
    let map = agents.as_object_mut().unwrap();
    if let Some(custom) = state.get("customSources").and_then(|v| v.as_object()) {
        for (id, source) in custom {
            if !custom_id(id) {
                continue;
            }
            let name = source.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let archived = source.get("archived") == Some(&json!(true));
            let mut meta = Map::new();
            meta.insert("name".into(), json!(name));
            meta.insert("label".into(), json!(name));
            meta.insert("hint".into(), json!(if archived { "已移除 · 历史统计保留" } else { "自定义 JSONL · 逐请求用量" }));
            meta.insert("icon".into(), json!("ui/layout-grid"));
            meta.insert("quota".into(), json!(false));
            meta.insert("custom".into(), json!(true));
            meta.insert("archived".into(), json!(archived));
            map.insert(id.clone(), Value::Object(meta));
        }
    }
    agents
}