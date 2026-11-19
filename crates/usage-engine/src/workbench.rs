// Workbench settings, selection, budget arithmetic and the observed-fact views
// (build/change/csv) shared by the window and the cost export.
use crate::time::parse_iso;
use crate::usage_math::shift;
use regex::Regex;
use serde_json::{json, Map, Value};

pub const PERIODS: [&str; 4] = ["daily", "weekly", "monthly", "total"];
const FIELDS: [&str; 5] = ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning"];

pub fn empty_settings() -> Value {
    json!({"version": 1, "budgets": {}, "acknowledged": {}})
}

fn object(value: &Value) -> bool {
    value.is_object()
}

pub fn settings(value: &Value) -> Result<Value, String> {
    let invalid = || "WORKBENCH_SETTING_INVALID".to_string();
    if !object(value) || value.get("version").and_then(|v| v.as_i64()) != Some(1) {
        return Err(invalid());
    }
    if value.as_object().unwrap().keys().any(|k| !["version", "budgets", "acknowledged"].contains(&k.as_str())) {
        return Err(invalid());
    }
    let budgets = value.get("budgets").filter(|v| object(v)).ok_or_else(invalid)?;
    let acknowledged = value.get("acknowledged").filter(|v| object(v)).ok_or_else(invalid)?;
    if budgets.as_object().unwrap().len() > 1000 || acknowledged.as_object().unwrap().len() > 1000 {
        return Err(invalid());
    }
    let scope = Regex::new(r"^(?:all|unknown|[a-f0-9]{64})$").unwrap();
    for (key, limit) in budgets.as_object().unwrap() {
        let split: Vec<&str> = key.split(':').collect();
        let limit = limit.as_f64().filter(|v| v.is_finite());
        if split.len() != 2 || !scope.is_match(split[0]) || !PERIODS.contains(&split[1]) || limit.map(|v| v <= 0.0 || v > 1000000.0).unwrap_or(true) {
            return Err(invalid());
        }
    }
    let hex = Regex::new(r"^[a-f0-9]{64}$").unwrap();
    for (key, fingerprint) in acknowledged.as_object().unwrap() {
        if !hex.is_match(key) || !hex.is_match(fingerprint.as_str().unwrap_or("")) {
            return Err(invalid());
        }
    }
    Ok(value.clone())
}

pub fn request(value: &Value) -> Result<Value, String> {
    let invalid = || "WORKBENCH_REQUEST_INVALID".to_string();
    if !object(value) || value.as_object().unwrap().keys().any(|k| !["period", "project"].contains(&k.as_str())) {
        return Err(invalid());
    }
    let period = match value.get("period") {
        None | Some(Value::Null) => "monthly",
        Some(Value::String(text)) => text.as_str(),
        _ => return Err(invalid()),
    };
    let project = match value.get("project") {
        None | Some(Value::Null) => "all",
        Some(Value::String(text)) => text.as_str(),
        _ => return Err(invalid()),
    };
    let scope = Regex::new(r"^(?:all|unknown|[a-f0-9]{64})$").unwrap();
    if !PERIODS.contains(&period) || !scope.is_match(project) {
        return Err(invalid());
    }
    Ok(json!({"period": period, "project": project}))
}

pub fn range(today: &str, period: &str) -> Value {
    if period == "total" {
        return json!({"from": null, "to": today});
    }
    let mut from = today.to_string();
    if period == "monthly" {
        from = format!("{}-01", &today[..7]);
    }
    if period == "weekly" {
        let ms = parse_iso(&format!("{today}T12:00:00Z")).unwrap_or(0);
        let days = ms.div_euclid(86_400_000);
        let dow = (days + 4).rem_euclid(7);
        from = shift(today, -((dow + 6) % 7));
    }
    json!({"from": from, "to": today})
}

pub fn summary(row: Option<&Value>) -> Value {
    let get = |field: &str| row.and_then(|r| r.get(field)).and_then(|v| v.as_f64()).unwrap_or(0.0);
    let has_records = get("pricedRecords") > 0.0;
    let mut fields = Map::new();
    for field in FIELDS {
        fields.insert(field.into(), row.and_then(|r| r.get(field)).cloned().unwrap_or(Value::Null));
    }
    json!({
        "records": get("records"), "totalTokens": get("totalTokens"), "pricedRecords": get("pricedRecords"),
        "pricedTokens": get("pricedTokens"), "boundedTokens": get("boundedTokens"), "partialRecords": get("partialRecords"),
        "lower": if has_records { row.and_then(|r| r.get("estimatedCostUsd")).cloned().unwrap_or(Value::Null) } else { Value::Null },
        "upper": if has_records { row.and_then(|r| r.get("estimatedCostUpperUsd")).cloned().unwrap_or(Value::Null) } else { Value::Null },
        "unpricedTokens": if row.is_some() { get("totalTokens") - get("pricedTokens") } else { 0.0 },
        "unpricedRecords": if row.is_some() { get("records") - get("pricedRecords") } else { 0.0 },
        "fields": fields,
        "knownRecords": row.and_then(|r| r.get("knownRecords")).cloned().unwrap_or(json!({})),
        "pricingReasons": row.and_then(|r| r.get("pricingReasons")).cloned().unwrap_or(json!({}))
    })
}

pub fn budget(total: &Value, limit: Option<f64>) -> Value {
    let limit = match limit {
        Some(limit) => limit,
        None => return json!({"limitUsd": null, "state": "not-set", "remainingUsd": null, "remainingUpperUsd": null}),
    };
    let records = total.get("records").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let lower = total.get("lower").and_then(|v| v.as_f64());
    let upper = total.get("upper").and_then(|v| v.as_f64());
    let unpriced_records = total.get("unpricedRecords").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let state = if records == 0.0 {
        "no-data"
    } else if lower.is_none() {
        "unpriced"
    } else if lower.unwrap() >= limit {
        "exceeded"
    } else if upper.map(|u| u >= limit).unwrap_or(false) {
        "possibly-exceeded"
    } else if unpriced_records > 0.0 {
        "incomplete"
    } else {
        "observed-below"
    };
    json!({
        "limitUsd": limit, "state": state,
        "remainingUsd": upper.map(|u| limit - u),
        "remainingUpperUsd": lower.map(|l| limit - l)
    })
}

use crate::aggregate::add;
use crate::js_json::stringify;
use crate::normalize::digest;
use crate::pathx as path;
use crate::sessions::{directory, project_name};
use crate::store::Store;
use crate::usage_math::local_day;
use crate::usage_projection::Calendar;
use crate::valuation::to_full_estimate;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

const FORMATS: [(&str, &[&str]); 10] = [
    ("codex", &["JSONL"]),
    ("claude", &["JSONL"]),
    ("opencode", &["SQLite", "JSON"]),
    ("workbuddy", &["JSONL", "SQLite"]),
    ("mimo", &["SQLite"]),
    ("gemini", &["JSON", "JSONL"]),
    ("cursor", &["SDK SQLite", "NDJSON", "CSV"]),
    ("zcode", &["SQLite"]),
    ("deepseek", &["JSONL", "Zstandard"]),
    ("antigravity", &["JSONL", "SQLite 配对"]),
];

fn hash(value: &Value) -> String {
    let mut hasher = Sha256::new();
    hasher.update(stringify(value).as_bytes());
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn truthy_opt(value: Option<&Value>) -> bool {
    value.map(crate::normalize::truthy).unwrap_or(false)
}

fn maintenance_issue(store: &Store, config: &Value, selection: &Value, code: &str, agent: Value, evidence: &Value, target: &str, extra: &str) -> Value {
    let salt = store.state["salt"].as_str().unwrap_or("");
    let id = digest(salt, &stringify(&json!(["maintenance", selection["project"], selection["period"], code, agent, extra])));
    let fingerprint = hash(evidence);
    let acknowledged = config.get("acknowledged").and_then(|a| a.get(&id)).and_then(|v| v.as_str()) == Some(fingerprint.as_str());
    json!({"id": id, "code": code, "agent": agent, "target": target, "evidence": evidence, "fingerprint": fingerprint, "acknowledged": acknowledged})
}

fn budget_issue(store: &Store, config: &Value, row: &Value, overview: bool) -> Option<Value> {
    let state = row.get("state").and_then(|v| v.as_str()).unwrap_or("");
    let mut allowed = vec!["exceeded", "possibly-exceeded", "incomplete", "unpriced"];
    if overview {
        allowed.extend(["no-data", "scope-missing"]);
    }
    if !allowed.contains(&state) {
        return None;
    }
    let scope = row.get("scope").and_then(|v| v.as_str()).unwrap_or("");
    let period = row.get("period").and_then(|v| v.as_str()).unwrap_or("");
    let total = row.get("total").cloned().unwrap_or(json!({}));
    let code = format!("BUDGET_{}", state.replace('-', "_").to_uppercase());
    let evidence = json!({"scope": scope, "period": period, "limitUsd": row.get("limitUsd"),
        "lower": total.get("lower"), "upper": total.get("upper"), "unpricedTokens": total.get("unpricedTokens")});
    Some(maintenance_issue(store, config, &json!({"project": scope, "period": period}), &code, Value::Null, &evidence, "workbench", &format!("{scope}{period}")))
}

struct Period {
    span: Value,
    totals: Map<String, Value>,
}

pub fn build(store: &mut Store, value: &Value, snapshot: &Value, calendar: Option<&Calendar>) -> Result<Value, String> {
    let selection = request(value)?;
    let config = store.workbench_settings.clone();
    let catalog = store.catalog();
    let records = store.records();
    let today = snapshot["today"].as_str().unwrap_or("");
    let timezone = snapshot["timezone"].as_str().unwrap_or("");
    let span = range(today, selection["period"].as_str().unwrap_or("monthly"));
    let unknown = json!({"id": "unknown", "name": "未知项目"});
    let mut options: Map<String, Value> = Map::new();
    let mut projects: Map<String, Value> = Map::new();
    let mut sources: Map<String, Value> = Map::new();
    let mut project_sources: HashMap<String, Map<String, Value>> = HashMap::new();
    let mut totals: Map<String, Value> = Map::new();
    let mut sessions: HashMap<String, HashSet<String>> = HashMap::new();
    let mut source_sessions: HashMap<String, HashSet<String>> = HashMap::new();
    let mut pricing: Map<String, Value> = Map::new();
    let mut project_cache: HashMap<String, Value> = HashMap::new();
    let mut session_projects: HashMap<String, Value> = HashMap::new();
    let mut periods: Vec<(String, Period)> = Vec::new();
    if let Some(budgets) = config.get("budgets").and_then(|v| v.as_object()) {
        for key in budgets.keys() {
            let period = key.split(':').nth(1).unwrap_or("");
            if !periods.iter().any(|(p, _)| p == period) {
                periods.push((period.to_string(), Period { span: range(today, period), totals: Map::new() }));
            }
        }
    }
    let salt = store.state["salt"].as_str().unwrap_or("").to_string();
    let saved_sessions = store.state.get("sessions").cloned().unwrap_or(json!({}));
    let info = |record: &Value, project_cache: &mut HashMap<String, Value>, session_projects: &mut HashMap<String, Value>| -> Value {
        let session_key = record.get("sessionKey").and_then(|v| v.as_str()).unwrap_or("");
        let saved = saved_sessions.get(session_key);
        let saved = match saved {
            Some(saved) if saved.get("agent") == record.get("agent") => saved,
            _ => return unknown.clone(),
        };
        if let Some(cached) = session_projects.get(session_key) {
            return cached.clone();
        }
        let cwd = match directory(saved.get("cwd")) {
            Some(cwd) => cwd,
            None => {
                session_projects.insert(session_key.to_string(), unknown.clone());
                return unknown.clone();
            }
        };
        let normalized_path = if regex::Regex::new(r"(?i)^[a-z]:").unwrap().is_match(&cwd) { path::normalize(&cwd) } else { path::normalize_posix(&cwd) };
        let normalized = normalized_path.replace('\\', "/").trim_end_matches('/').to_lowercase();
        if !project_cache.contains_key(&normalized) {
            project_cache.insert(normalized.clone(), json!({"id": digest(&salt, &format!("project:{normalized}")), "name": project_name(Some(&cwd)).unwrap_or_else(|| "未知项目".to_string())}));
        }
        let project = project_cache[&normalized].clone();
        session_projects.insert(session_key.to_string(), project.clone());
        project
    };
    let in_span = |date: &str, span: &Value| -> bool {
        let to = span["to"].as_str().unwrap_or("");
        let from = span.get("from").and_then(|v| v.as_str());
        date <= to && from.map(|f| date >= f).unwrap_or(true)
    };
    for record in &records {
        let project = info(record, &mut project_cache, &mut session_projects);
        let project_id = project["id"].as_str().unwrap_or("").to_string();
        options.insert(project_id.clone(), project.clone());
        let timestamp = record["timestamp"].as_str().unwrap_or("");
        let date = calendar.and_then(|c| c.cached_date(timestamp)).unwrap_or_else(|| local_day(timezone, parse_iso(timestamp).unwrap_or(0)));
        let selected = in_span(&date, &span);
        let matching: Vec<usize> = periods.iter().enumerate().filter(|(_, (_, p))| in_span(&date, &p.span)).map(|(i, _)| i).collect();
        if !selected && matching.is_empty() {
            continue;
        }
        let full = to_full_estimate(&store.estimate(record));
        for i in &matching {
            let totals_map = &mut periods[*i].1.totals;
            add(totals_map, "all", &json!({}), record, &full.eval, &full.parts, full.savings, full.lower_bound);
            add(totals_map, &project_id, &json!({}), record, &full.eval, &full.parts, full.savings, full.lower_bound);
        }
        if !selected {
            continue;
        }
        add(&mut projects, &project_id, &json!({}), record, &full.eval, &full.parts, full.savings, full.lower_bound);
        add(project_sources.entry(project_id.clone()).or_default(), record["agent"].as_str().unwrap_or(""), &json!({}), record, &full.eval, &full.parts, full.savings, full.lower_bound);
        if let Some(session_key) = record.get("sessionKey").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            sessions.entry(project_id.clone()).or_default().insert(session_key.to_string());
        }
        let selection_project = selection["project"].as_str().unwrap_or("all");
        if selection_project != "all" && selection_project != project_id {
            continue;
        }
        add(&mut totals, "all", &json!({}), record, &full.eval, &full.parts, full.savings, full.lower_bound);
        add(&mut sources, record["agent"].as_str().unwrap_or(""), &json!({}), record, &full.eval, &full.parts, full.savings, full.lower_bound);
        if let Some(session_key) = record.get("sessionKey").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            source_sessions.entry(record["agent"].as_str().unwrap_or("").to_string()).or_default().insert(session_key.to_string());
        }
        if full.eval.lower.is_none() {
            let key = stringify(&json!([record.get("agent"), record.get("provider"), record.get("model"), full.eval.reason, full.eval.cause.clone().map(|c| json!(c)).unwrap_or(Value::Null)]));
            let mut issue = pricing.get(&key).cloned().unwrap_or_else(|| json!({"agent": record.get("agent"), "provider": record.get("provider"), "model": record.get("model"),
                "reason": full.eval.reason, "cause": full.eval.cause.clone().map(|c| json!(c)).unwrap_or(Value::Null), "records": 0, "tokens": 0}));
            issue["records"] = json!(issue["records"].as_i64().unwrap_or(0) + 1);
            issue["tokens"] = json!(issue["tokens"].as_i64().unwrap_or(0) + record["totalTokens"].as_i64().unwrap_or(0));
            pricing.insert(key, issue);
        }
    }
    let selection_project = selection["project"].as_str().unwrap_or("all");
    if selection_project != "all" && !options.contains_key(selection_project) {
        return Err("WORKBENCH_SCOPE_INVALID".to_string());
    }
    let mut project_options: Vec<Value> = options.values().cloned().collect();
    project_options.sort_by(|a, b| {
        crate::collate::compare(a["name"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or(""))
            .then_with(|| crate::collate::compare(a["id"].as_str().unwrap_or(""), b["id"].as_str().unwrap_or("")))
    });
    let mut names: HashMap<String, usize> = HashMap::new();
    for p in &project_options {
        *names.entry(p["name"].as_str().unwrap_or("").to_string()).or_default() += 1;
    }
    let mut occurrences: HashMap<String, usize> = HashMap::new();
    for p in project_options.iter_mut() {
        let name = p["name"].as_str().unwrap_or("").to_string();
        let n = occurrences.entry(name.clone()).or_default();
        *n += 1;
        let label = if names[&name] > 1 { format!("{name}（项目 {n}）") } else { name.clone() };
        p["label"] = json!(label);
    }
    for p in &project_options {
        options.insert(p["id"].as_str().unwrap_or("").to_string(), p.clone());
    }
    let mut budget_keys: Vec<String> = config.get("budgets").and_then(|v| v.as_object()).map(|m| m.keys().cloned().collect()).unwrap_or_default();
    budget_keys.sort_by(|a, b| crate::collate::compare(a, b));
    let mut budgets: Vec<Value> = Vec::new();
    for key in budget_keys {
        let mut parts = key.split(':');
        let scope = parts.next().unwrap_or("");
        let period = parts.next().unwrap_or("");
        let limit = config["budgets"][&key].as_f64();
        let p = options.get(scope);
        let total_row = periods.iter().find(|(name, _)| name == period).and_then(|(_, p)| p.totals.get(scope));
        let total = summary(total_row);
        let period_span = periods.iter().find(|(name, _)| name == period).map(|(_, p)| p.span.clone()).unwrap_or(json!({}));
        let mut row = json!({"scope": scope, "period": period,
            "projectName": if scope == "all" { json!("全部项目") } else { p.map(|p| p["name"].clone()).unwrap_or(Value::Null) },
            "projectLabel": if scope == "all" { json!("全部项目") } else { p.map(|p| p["label"].clone()).unwrap_or(Value::Null) },
            "range": period_span});
        for (field, value) in budget(&total, limit).as_object().unwrap() {
            row[field] = value.clone();
        }
        row["total"] = total;
        if scope != "all" && p.is_none() {
            row["state"] = json!("scope-missing");
            row["remainingUsd"] = Value::Null;
            row["remainingUpperUsd"] = Value::Null;
        }
        budgets.push(row);
    }
    let budget_issues: Vec<Value> = budgets.iter().filter_map(|row| budget_issue(store, &config, row, true)).collect();
    let budget_overview = json!({"budgets": budgets, "issues": budget_issues.iter().take(500).cloned().collect::<Vec<_>>(),
        "omittedIssues": budget_issues.len().saturating_sub(500)});
    let mut project_rows: Vec<Value> = projects
        .iter()
        .filter(|(id, _)| selection_project == "all" || *id == selection_project)
        .map(|(id, row)| {
            let mut out = json!({"id": id, "name": options[id]["name"]});
            for (field, value) in summary(Some(row)).as_object().unwrap() {
                out[field] = value.clone();
            }
            out["sessions"] = json!(sessions.get(id).map(|s| s.len()).unwrap_or(0));
            let agents: Vec<Value> = project_sources
                .get(id)
                .map(|m| {
                    m.iter()
                        .map(|(agent, r)| {
                            let mut a = json!({"agent": agent});
                            for (field, value) in summary(Some(r)).as_object().unwrap() {
                                a[field] = value.clone();
                            }
                            a
                        })
                        .collect()
                })
                .unwrap_or_default();
            out["agents"] = Value::Array(agents);
            out
        })
        .collect();
    project_rows.sort_by(|a, b| {
        let al = a["lower"].as_f64().unwrap_or(-1.0);
        let bl = b["lower"].as_f64().unwrap_or(-1.0);
        bl.partial_cmp(&al).unwrap().then_with(|| b["totalTokens"].as_f64().unwrap_or(0.0).partial_cmp(&a["totalTokens"].as_f64().unwrap_or(0.0)).unwrap())
            .then_with(|| crate::collate::compare(a["id"].as_str().unwrap_or(""), b["id"].as_str().unwrap_or("")))
    });
    let total = summary(totals.get("all"));
    let limit_key = format!("{}:{}", selection_project, selection["period"].as_str().unwrap_or(""));
    let limit = config.get("budgets").and_then(|b| b.get(&limit_key)).filter(|v| !v.is_null()).and_then(|v| v.as_f64());
    let budget_view = budget(&total, limit);
    let mut issues: Vec<Value> = Vec::new();
    let mut issue = |code: &str, agent: Value, evidence: &Value, target: &str, extra: &str| {
        issues.push(maintenance_issue(store, &config, &selection, code, agent, evidence, target, extra));
    };
    let statuses: HashMap<String, Value> = snapshot["sources"]
        .as_array()
        .map(|l| l.iter().filter_map(|s| Some((s.get("agent")?.as_str()?.to_string(), s.clone()))).collect())
        .unwrap_or_default();
    let disabled = store.settings["sources"]["disabled"].as_array().cloned().unwrap_or_default();
    let mut source_rows: Vec<Value> = Vec::new();
    for (agent, meta) in catalog.as_object().unwrap() {
        let source = store.state.get("customSources").and_then(|s| s.get(agent));
        let status = statuses.get(agent).cloned().unwrap_or(json!({}));
        let row = summary(sources.get(agent));
        let records_count = row["records"].as_f64().unwrap_or(0.0);
        let mut known = Map::new();
        for field in FIELDS {
            let known_records = row["knownRecords"].get(field).and_then(|v| v.as_f64()).unwrap_or(0.0);
            known.insert(field.into(), json!({"records": known_records, "coverage": if records_count > 0.0 { json!(known_records / records_count) } else { Value::Null }}));
        }
        let template = source.and_then(|s| s.get("definition")).and_then(|d| d.get("template")).and_then(|v| v.as_str());
        let input = match template {
            Some("mapped") => source.and_then(|s| s["definition"].get("inputSemantics")).and_then(|v| v.as_str()).unwrap_or("inclusive").to_string(),
            Some("claude") => "exclusive".to_string(),
            Some(_) => "inclusive".to_string(),
            None => {
                if ["claude", "opencode", "mimo", "cursor", "deepseek", "antigravity"].contains(&agent.as_str()) {
                    "exclusive".to_string()
                } else if agent == "zcode" {
                    "schema-dependent".to_string()
                } else {
                    "inclusive".to_string()
                }
            }
        };
        let output = match template {
            Some("mapped") if source.and_then(|s| s["definition"].get("outputIncludesReasoning")).and_then(|v| v.as_bool()) == Some(false) => "excludes-reasoning".to_string(),
            Some(_) => "includes-reasoning".to_string(),
            None => {
                if ["opencode", "mimo", "gemini"].contains(&agent.as_str()) {
                    "excludes-reasoning".to_string()
                } else if agent == "zcode" {
                    "schema-dependent".to_string()
                } else {
                    "includes-reasoning".to_string()
                }
            }
        };
        let mut errors: Vec<String> = Vec::new();
        for code in status.get("errors").and_then(|v| v.as_array()).cloned().unwrap_or_default().iter().filter_map(|v| v.as_str()) {
            if regex::Regex::new(r"^[A-Z_]+$").unwrap().is_match(code) && !errors.iter().any(|e| e == code) {
                errors.push(code.to_string());
            }
        }
        let evidence = json!({"records": status.get("observedRecords").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or_else(|| row["records"].clone()), "codes": errors});
        for code in &errors {
            issue(code, json!(agent), &evidence, "sources", "");
        }
        if row["partialRecords"].as_f64().unwrap_or(0.0) > 0.0 {
            issue("USAGE_QUALITY_PARTIAL", json!(agent), &json!({"records": row["partialRecords"], "totalRecords": row["records"]}), "cost", "");
        }
        let formats: Value = match template {
            Some("claude") => json!(["Claude JSONL"]),
            Some("mapped") => json!(["字段映射 JSONL"]),
            Some(_) => json!(["标准事件 JSONL"]),
            None => json!(FORMATS.iter().find(|(a, _)| a == agent).map(|(_, f)| f.to_vec()).unwrap_or_default()),
        };
        let mut out = json!({
            "agent": agent, "name": meta.get("name"), "custom": meta.get("custom") == Some(&json!(true)), "archived": meta.get("archived") == Some(&json!(true)),
            "enabled": match source { Some(s) => truthy_opt(s.get("enabled")) && !truthy_opt(s.get("archived")), None => !disabled.iter().any(|d| d.as_str() == Some(agent.as_str())) },
            "formats": formats, "inputSemantics": input, "outputSemantics": output, "quota": agent == "codex", "readOnly": true,
            "ruleVersion": source.and_then(|s| s.get("version")).filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null),
            "mixedRules": truthy_opt(source.and_then(|s| s.get("diagnostics")).and_then(|d| d.get("mixedRules"))),
            "parserVersion": status.get("parserVersion").filter(|v| v.is_string()).cloned().unwrap_or(Value::Null),
            "status": status.get("status").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or(json!("unverified")),
            "realSampleVerified": status.get("realSampleVerified") == Some(&json!(true)),
            "lastSuccess": status.get("lastSuccess").filter(|v| crate::normalize::truthy(v)).cloned().unwrap_or(Value::Null)
        });
        for (field, value) in row.as_object().unwrap() {
            out[field] = value.clone();
        }
        out["known"] = Value::Object(known);
        out["sessions"] = json!(source_sessions.get(agent).map(|s| s.len()).unwrap_or(0));
        source_rows.push(out);
    }
    for p in pricing.values() {
        issue("USAGE_UNPRICED", p["agent"].clone(), p, "cost", &stringify(&json!([p["model"], p["reason"], p["cause"]])));
    }
    if total["records"].as_f64().unwrap_or(0.0) > 0.0 {
        if let Some(unknown_row) = project_rows.iter().find(|p| p["id"] == json!("unknown")) {
            issue("PROJECT_UNATTRIBUTED", Value::Null, &json!({"records": unknown_row["records"]}), "sessions", "");
        }
    }
    let mut selected_row = json!({"scope": selection_project, "period": selection["period"]});
    for (field, value) in budget_view.as_object().unwrap() {
        selected_row[field] = value.clone();
    }
    selected_row["total"] = total.clone();
    if let Some(selected_issue) = budget_issue(store, &config, &selected_row, false) {
        issues.push(selected_issue);
    }
    Ok(json!({
        "schemaVersion": "WorkbenchV1", "sequence": snapshot["sequence"], "timezone": snapshot["timezone"], "today": snapshot["today"],
        "selection": selection, "range": span, "projectOptions": project_options, "projects": project_rows, "total": total,
        "sources": source_rows, "budget": budget_view, "budgetOverview": budget_overview,
        "issues": issues.iter().take(500).cloned().collect::<Vec<_>>(), "omittedIssues": issues.len().saturating_sub(500),
        "priceBasis": snapshot["priceCatalog"], "historyStarts": snapshot.get("coverageStart").cloned().unwrap_or(Value::Null),
        "scope": "observed-api-equivalent", "factRevision": snapshot["sequence"]
    }))
}

pub fn change(store: &mut Store, value: &Value) -> Result<Value, String> {
    if !value.is_object() {
        return Err("WORKBENCH_SETTING_INVALID".to_string());
    }
    let mut next = store.workbench_settings.clone();
    let kind = value.get("kind").and_then(|v| v.as_str()).unwrap_or("");
    if kind == "budget" {
        if value.as_object().unwrap().keys().any(|k| !["kind", "project", "period", "limitUsd"].contains(&k.as_str())) {
            return Err("WORKBENCH_SETTING_INVALID".to_string());
        }
        let selection = request(&json!({"project": value.get("project"), "period": value.get("period")}))?;
        if value.get("limitUsd") != Some(&Value::Null) {
            let snapshot = store.snapshot()?;
            build(store, &selection, &snapshot, None)?;
        }
        let key = format!("{}:{}", selection["project"].as_str().unwrap(), selection["period"].as_str().unwrap());
        if value.get("limitUsd") == Some(&Value::Null) {
            next["budgets"].as_object_mut().unwrap().remove(&key);
        } else {
            next["budgets"][&key] = value["limitUsd"].clone();
        }
    } else if kind == "acknowledge" {
        if value.as_object().unwrap().keys().any(|k| !["kind", "id", "fingerprint", "acknowledged", "project", "period"].contains(&k.as_str())) || !value.get("acknowledged").map(|v| v.is_boolean()).unwrap_or(false) {
            return Err("WORKBENCH_SETTING_INVALID".to_string());
        }
        let selection = request(&json!({"project": value.get("project"), "period": value.get("period")}))?;
        let snapshot = store.snapshot()?;
        let overview = build(store, &json!({}), &snapshot, None)?["budgetOverview"].clone();
        let row = overview["budgets"].as_array().and_then(|rows| {
            rows.iter().find(|row| row["scope"] == selection["project"] && row["period"] == selection["period"])
        });
        let candidate = row.and_then(|row| budget_issue(store, &next, row, true));
        let wanted_id = value.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let wanted_fingerprint = value.get("fingerprint").and_then(|v| v.as_str()).unwrap_or("");
        let matched = candidate.filter(|c| c["id"].as_str() == Some(wanted_id) && c["fingerprint"].as_str() == Some(wanted_fingerprint));
        let issue = match matched {
            Some(candidate) => Some(candidate),
            None => {
                let snapshot = store.snapshot()?;
                let view = build(store, &selection, &snapshot, None)?;
                view["issues"].as_array().and_then(|issues| {
                    issues.iter().find(|issue| issue["id"].as_str() == Some(wanted_id) && issue["fingerprint"].as_str() == Some(wanted_fingerprint)).cloned()
                })
            }
        };
        if issue.is_none() {
            return Err("WORKBENCH_ISSUE_STALE".to_string());
        }
        if value["acknowledged"].as_bool().unwrap() {
            next["acknowledged"][wanted_id] = json!(wanted_fingerprint);
        } else {
            next["acknowledged"].as_object_mut().unwrap().remove(wanted_id);
        }
    } else {
        return Err("WORKBENCH_SETTING_INVALID".to_string());
    }
    settings(&next)
}

pub fn csv(view: &Value) -> String {
    fn cell(v: &Value, text: bool) -> String {
        if v.is_null() {
            return String::new();
        }
        let mut s = match v {
            Value::String(s) => s.clone(),
            other => stringify(other),
        };
        if text && regex::Regex::new(r"^\s*[=+\-@]").unwrap().is_match(&s) {
            s = format!("'{s}");
        }
        if s.contains(['"', ',', '\r', '\n']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s
        }
    }
    fn usd(value: &Value) -> Value {
        match value.as_f64() {
            None => Value::Null,
            Some(v) => {
                let precise = format!("{v:.11e}").parse::<f64>().unwrap_or(v);
                json!(precise)
            }
        }
    }
    let mut lines: Vec<Vec<Value>> = vec![vec![json!("项目"), json!("范围开始"), json!("范围结束"), json!("Token"), json!("记录"), json!("会话"), json!("估算下限 USD"), json!("估算上限 USD"), json!("未定价 Token"), json!("已计价记录")]];
    let labels: HashMap<String, String> = view["projectOptions"].as_array().cloned().unwrap_or_default()
        .iter().filter_map(|p| Some((p.get("id")?.as_str()?.to_string(), p.get("label")?.as_str()?.to_string()))).collect();
    let range_from = view["range"].get("from").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).map(|s| json!(s)).unwrap_or(json!("累计"));
    for p in view["projects"].as_array().cloned().unwrap_or_default() {
        let id = p["id"].as_str().unwrap_or("");
        lines.push(vec![
            json!(labels.get(id).cloned().unwrap_or_else(|| p["name"].as_str().unwrap_or("").to_string())),
            range_from.clone(),
            view["range"]["to"].clone(),
            p["totalTokens"].clone(), p["records"].clone(), p["sessions"].clone(),
            usd(&p["lower"]), usd(&p["upper"]), p["unpricedTokens"].clone(), p["pricedRecords"].clone(),
        ]);
    }
    let body: Vec<String> = lines
        .iter()
        .enumerate()
        .map(|(i, row)| row.iter().enumerate().map(|(index, v)| cell(v, i == 0 || index == 0)).collect::<Vec<_>>().join(","))
        .collect();
    format!("\u{feff}{}\r\n", body.join("\r\n"))
}