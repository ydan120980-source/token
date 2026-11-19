// Shared in-memory reconciliation for GUI startup and read-only saved queries.
use crate::js_json::stringify;
use crate::usage_snapshot::{keep_identity, select_usage_snapshot, CONFLICT};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub fn reconcile(state: &mut Value, before_change: &mut dyn FnMut(&Value), labels: &Value) {
    if state.get("duplicateIds").map(|v| v.is_null()).unwrap_or(true) {
        state["duplicateIds"] = json!({});
    }
    let mut shared: HashMap<String, String> = HashMap::new();
    let ids: Vec<String> = state["records"].as_object().map(|m| m.keys().cloned().collect()).unwrap_or_default();
    for id in ids {
        let record = state["records"][&id].clone();
        let shared_key = match record.get("sharedKey").and_then(|v| v.as_str()) {
            Some(key) => key.to_string(),
            None => continue,
        };
        if let Some(owner_id) = shared.get(&shared_key).cloned() {
            let owner = state["records"][&owner_id].clone();
            let choice = select_usage_snapshot(Some(&owner), &record);
            let duplicate_matches = state["duplicateIds"].get(&id).and_then(|v| v.as_str()) == Some(owner_id.as_str());
            // G9: JS compares object identity; structurally equal values keep the
            // same projection, so equality of content stands in for ===.
            if !duplicate_matches || stringify(&choice.record) != stringify(&owner) {
                before_change(state);
                state["duplicateIds"][&id] = json!(owner_id);
                state["records"][&owner_id] = keep_identity(&owner, &choice.record);
            }
            if choice.issue == Some(CONFLICT) {
                for agent in [owner.get("agent").and_then(|v| v.as_str()).unwrap_or(""), record.get("agent").and_then(|v| v.as_str()).unwrap_or("")] {
                    let status = state["statuses"].get(agent).cloned().unwrap_or_else(|| json!({"agent": agent, "label": labels.get(agent).cloned().unwrap_or(Value::Null), "lastSuccess": null}));
                    let mut next = status.clone();
                    if next.get("status").and_then(|v| v.as_str()) != Some("not-detected") {
                        next["status"] = json!("partial");
                    }
                    let mut errors: Vec<Value> = next.get("errors").and_then(|v| v.as_array()).cloned().unwrap_or_default();
                    if !errors.iter().any(|e| e.as_str() == Some(CONFLICT)) {
                        errors.push(json!(CONFLICT));
                    }
                    next["errors"] = Value::Array(errors);
                    state["statuses"][agent] = next;
                }
            }
        } else {
            let duplicate = state["duplicateIds"].get(&id).and_then(|v| v.as_str()).map(|s| s.to_string());
            if let Some(duplicate) = duplicate {
                if state["records"].get(&duplicate).and_then(|r| r.get("sharedKey")).and_then(|v| v.as_str()) == Some(shared_key.as_str()) {
                    before_change(state);
                    state["duplicateIds"].as_object_mut().unwrap().remove(&id);
                }
            }
            shared.insert(shared_key, id);
        }
    }
    let records: Vec<Value> = state["records"]
        .as_object()
        .map(|m| m.iter().filter(|(id, _)| state["duplicateIds"].get(*id).map(|v| v.is_null()).unwrap_or(true)).map(|(_, r)| r.clone()).collect())
        .unwrap_or_default();
    let detailed: HashSet<String> = records
        .iter()
        .filter(|r| r.get("agent").and_then(|v| v.as_str()) == Some("workbuddy") && r.get("accountingKind").and_then(|v| v.as_str()) != Some("session-aggregate"))
        .filter_map(|r| r.get("sessionKey").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .collect();
    let mut remove: Vec<String> = Vec::new();
    for record in &records {
        if record.get("agent").and_then(|v| v.as_str()) == Some("workbuddy")
            && record.get("accountingKind").and_then(|v| v.as_str()) == Some("session-aggregate")
            && record.get("sessionKey").and_then(|v| v.as_str()).map(|k| detailed.contains(k)).unwrap_or(false)
        {
            remove.push(record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string());
        }
    }
    for id in remove {
        before_change(state);
        state["records"].as_object_mut().unwrap().remove(&id);
    }
}