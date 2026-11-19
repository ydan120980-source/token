// Saved as the user's changes against automatic locations, so locations a later
// version adds still reach existing users (SOURCES-DISCOVERY-20261014.md).
use crate::pathx as path;
use crate::policy::{local_path, sources};
use serde_json::{json, Map, Value};

fn fold(value: String) -> String {
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

pub fn same(a: &str, b: &str) -> bool {
    fold(path::resolve(a)) == fold(path::resolve(b))
}

pub fn contains(list: Option<&Value>, file: &str) -> bool {
    list.and_then(|v| v.as_array())
        .map(|items| items.iter().filter_map(|v| v.as_str()).any(|entry| same(entry, file)))
        .unwrap_or(false)
}

pub fn empty() -> Value {
    json!({"added": {}, "excluded": {}, "disabled": []})
}

fn paths(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|items| items.iter().filter_map(|v| v.as_str()).filter(|entry| local_path(entry).is_ok()).map(|s| s.to_string()).collect())
        .unwrap_or_default()
}

pub fn sanitize(value: Option<&Value>) -> Option<Value> {
    let value = value?;
    if !value.is_object() {
        return None;
    }
    let mut scope = empty();
    let agents = sources();
    for key in ["added", "excluded"] {
        for agent in &agents {
            let list = paths(value.get(key).and_then(|v| v.get(agent)));
            if !list.is_empty() {
                scope[key][agent] = json!(list);
            }
        }
    }
    let disabled: Vec<String> = value
        .get("disabled")
        .and_then(|v| v.as_array())
        .map(|items| agents.iter().filter(|agent| items.iter().any(|v| v.as_str() == Some(agent.as_str()))).cloned().collect())
        .unwrap_or_default();
    scope["disabled"] = json!(disabled);
    Some(scope)
}

pub fn migrate(saved: Option<&Value>, defaults: &Value) -> Option<Value> {
    let mut scope = empty();
    for agent in sources() {
        let list = match saved.and_then(|v| v.get(&agent)).and_then(|v| v.as_array()) {
            Some(list) => list,
            None => continue,
        };
        if list.is_empty() {
            if defaults.get(&agent).and_then(|v| v.as_array()).map(|l| !l.is_empty()).unwrap_or(false) {
                scope["disabled"].as_array_mut().unwrap().push(json!(agent));
            }
            continue;
        }
        let extra: Vec<String> = list
            .iter()
            .filter_map(|v| v.as_str())
            .filter(|entry| !contains(defaults.get(&agent), entry))
            .map(|s| s.to_string())
            .collect();
        if !extra.is_empty() {
            scope["added"][&agent] = json!(extra);
        }
        if agent == "cursor" && !extra.is_empty() && !list.iter().filter_map(|v| v.as_str()).any(|entry| contains(defaults.get("cursor"), entry)) {
            scope["excluded"]["cursor"] = defaults.get("cursor").cloned().unwrap_or(json!([]));
        }
    }
    sanitize(Some(&scope))
}

pub fn effective(scope: &Value, defaults: &Value) -> Value {
    let mut out = Map::new();
    let disabled = scope.get("disabled").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for agent in sources() {
        if disabled.iter().any(|v| v.as_str() == Some(agent.as_str())) {
            out.insert(agent, json!([]));
            continue;
        }
        let mut list: Vec<String> = Vec::new();
        let mut push = |entry: &str| {
            if !list.iter().any(|e| same(e, entry)) && !contains(scope.get("excluded").and_then(|v| v.get(&agent)), entry) {
                list.push(entry.to_string());
            }
        };
        if let Some(items) = defaults.get(&agent).and_then(|v| v.as_array()) {
            for entry in items.iter().filter_map(|v| v.as_str()) {
                push(entry);
            }
        }
        if let Some(items) = scope.get("added").and_then(|v| v.get(&agent)).and_then(|v| v.as_array()) {
            for entry in items.iter().filter_map(|v| v.as_str()) {
                push(entry);
            }
        }
        out.insert(agent, json!(list));
    }
    Value::Object(out)
}

fn without(list: Option<&Value>, file: &str) -> Vec<String> {
    list.and_then(|v| v.as_array())
        .map(|items| items.iter().filter_map(|v| v.as_str()).filter(|entry| !same(entry, file)).map(|s| s.to_string()).collect())
        .unwrap_or_default()
}

fn set(scope: &mut Value, key: &str, agent: &str, list: Vec<String>) {
    if list.is_empty() {
        scope[key].as_object_mut().unwrap().remove(agent);
    } else {
        scope[key][agent] = json!(list);
    }
}

fn list_of(scope: &Value, key: &str, agent: &str) -> Vec<String> {
    scope.get(key).and_then(|v| v.get(agent)).and_then(|v| v.as_array())
        .map(|items| items.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect())
        .unwrap_or_default()
}

pub fn change_add(scope: &Value, defaults: &Value, agent: &str, file: &str) -> Value {
    let mut next = scope.clone();
    next["disabled"] = json!(next["disabled"].as_array().cloned().unwrap_or_default().iter().filter(|v| v.as_str() != Some(agent)).cloned().collect::<Vec<_>>());
    if agent == "cursor" {
        next["added"]["cursor"] = json!([file]);
        let default_list: Vec<String> = defaults.get("cursor").and_then(|v| v.as_array()).map(|l| l.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect()).unwrap_or_default();
        set(&mut next, "excluded", agent, default_list);
        return next;
    }
    if contains(defaults.get(agent), file) {
        let rest = without(next.get("excluded").and_then(|v| v.get(agent)), file);
        set(&mut next, "excluded", agent, rest);
    } else if !contains(next.get("added").and_then(|v| v.get(agent)), file) {
        let mut list = list_of(&next, "added", agent);
        list.push(file.to_string());
        set(&mut next, "added", agent, list);
    }
    next
}

pub fn change_remove(scope: &Value, defaults: &Value, agent: &str, file: &str) -> Value {
    let mut next = scope.clone();
    if contains(next.get("added").and_then(|v| v.get(agent)), file) {
        let rest = without(next.get("added").and_then(|v| v.get(agent)), file);
        set(&mut next, "added", agent, rest);
        if agent == "cursor" && next["added"].get("cursor").is_none() {
            next["excluded"].as_object_mut().unwrap().remove("cursor");
        }
    } else if contains(defaults.get(agent), file) && !contains(next.get("excluded").and_then(|v| v.get(agent)), file) {
        let mut list = list_of(&next, "excluded", agent);
        list.push(file.to_string());
        set(&mut next, "excluded", agent, list);
    }
    next
}

pub fn change_include(scope: &Value, agent: &str, file: &str) -> Value {
    let mut next = scope.clone();
    let rest = without(next.get("excluded").and_then(|v| v.get(agent)), file);
    set(&mut next, "excluded", agent, rest);
    next
}

pub fn change_enable(scope: &Value, agent: &str, enabled: bool) -> Value {
    let mut next = scope.clone();
    let mut rest: Vec<Value> = next["disabled"].as_array().cloned().unwrap_or_default().into_iter().filter(|v| v.as_str() != Some(agent)).collect();
    if !enabled {
        rest.push(json!(agent));
    }
    next["disabled"] = Value::Array(rest);
    next
}

pub fn change_reset(scope: &Value, agent: &str) -> Value {
    let mut next = scope.clone();
    next["added"].as_object_mut().unwrap().remove(agent);
    next["excluded"].as_object_mut().unwrap().remove(agent);
    next["disabled"] = json!(next["disabled"].as_array().cloned().unwrap_or_default().iter().filter(|v| v.as_str() != Some(agent)).cloned().collect::<Vec<_>>());
    next
}

pub fn change_all(scope: &Value, enabled: bool) -> Value {
    let mut next = scope.clone();
    next["disabled"] = if enabled { json!([]) } else { json!(sources()) };
    next
}