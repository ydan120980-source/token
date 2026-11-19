use crate::agent_catalog::{builtin_agents, builtin_icon, custom_id, is_builtin};
use crate::source_registry::revision;
use serde_json::{json, Map, Value};

const SOURCE_ERRORS: [&str; 36] = [
    "CUSTOM_COUNTER_UNSUPPORTED", "CUSTOM_HISTORY_RETAINED", "CUSTOM_LINE_LIMIT", "CUSTOM_INCOMPLETE_LINE",
    "ANTIGRAVITY_MODEL_UNPAIRED", "SOURCE_USAGE_REGRESSION", "SOURCE_USAGE_CONFLICT", "SOURCE_PATH_REJECTED",
    "SOURCE_LIMIT", "SOURCE_UNREADABLE", "SOURCE_SYMLINK_REJECTED", "SOURCE_ALIAS_REJECTED", "SOURCE_SIZE_OR_LINK",
    "SOURCE_BUSY", "SOURCE_TIMEOUT", "SOURCE_PARSE_FAILED", "SOURCE_ROW_INVALID", "USAGE_UNREPORTED",
    "DATABASE_FORMAT_UNSUPPORTED", "DATABASE_SCHEMA_UNSUPPORTED", "WAL_HEADER_INVALID", "WAL_PAGE_INVALID",
    "WAL_CHECKSUM_INVALID", "WAL_SIZE_LIMIT", "DEEPSEEK_FORMAT_UNSUPPORTED", "DEEPSEEK_SEED_INVALID",
    "DEEPSEEK_ENCODING_CONFLICT", "DEEPSEEK_LOG_INCOMPLETE", "SOURCE_COMPRESSION_UNSUPPORTED", "SOURCE_COMPRESSION_INVALID",
    "CURSOR_CSV_INVALID", "CURSOR_CSV_SCHEMA", "CURSOR_SOURCE_MODE_CONFLICT", "COPILOT_SOURCE_MODE_CONFLICT",
    "SOURCE_FORMAT_UNSUPPORTED", "SOURCE_USAGE_ESTIMATED",
];
const FIELDS: [&str; 10] = [
    "totalTokens", "inputUncached", "output", "cacheRead", "cacheWrite", "reasoning", "records", "pricedTokens",
    "estimatedCostUsd", "partialRecords",
];
const NON_NULLABLE: [&str; 4] = ["totalTokens", "records", "pricedTokens", "partialRecords"];
const REASONS: [&str; 10] = [
    "exact", "long-context", "cache-write-unreported", "model-unpriced", "price-unverified", "usage-incomplete",
    "rate-missing", "context-unreported", "reasoning-unreported", "time-tariff-unreported",
];
const CAUSES: [&str; 10] = [
    "conflict", "partial", "invalid-cache", "invalid-reasoning", "total-mismatch", "missing-inputUncached",
    "missing-output", "missing-cacheRead", "missing-cacheWrite", "missing-reasoning",
];
const KNOWN: [&str; 6] = ["inputUncached", "output", "cacheRead", "cacheWrite", "reasoning", "outputPlain"];

fn text(value: Option<&Value>, fallback: Option<&str>) -> Value {
    match value {
        Some(Value::String(s)) if s.len() <= 180 => json!(s),
        _ => json!(fallback),
    }
}

fn count(value: Option<&Value>, nullable: bool) -> Result<Value, String> {
    match value {
        None | Some(Value::Null) => {
            if nullable {
                Ok(Value::Null)
            } else {
                Err("INVALID_STATISTIC".to_string())
            }
        }
        Some(v) => {
            let n = v.as_f64().filter(|n| n.is_finite() && *n >= 0.0).ok_or("INVALID_STATISTIC")?;
            let _ = n;
            Ok(v.clone())
        }
    }
}

fn safe_positive(value: &Value) -> bool {
    value.as_f64().map(|n| n.is_finite() && n >= 0.0 && n.fract() == 0.0 && n <= 9_007_199_254_740_991.0 && n > 0.0).unwrap_or(false)
}

fn date_shape(value: Option<&Value>) -> bool {
    match value {
        Some(Value::String(s)) => {
            let b = s.as_bytes();
            s.len() == 10
                && b[4] == b'-'
                && b[7] == b'-'
                && s.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
        }
        _ => false,
    }
}

fn filtered_map(source: Option<&Value>, keys: &[&str], positive_integer: bool) -> Value {
    let mut out = Map::new();
    if let Some(map) = source.and_then(|v| v.as_object()) {
        for (key, value) in map {
            let allowed = keys.contains(&key.as_str());
            let ok = if positive_integer { safe_positive(value) } else { value.as_f64().map(|n| n.is_finite() && n >= 0.0).unwrap_or(false) };
            if allowed && ok {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(out)
}

pub fn select_snapshot(snapshot: &Value, catalog: Option<&Value>) -> Result<Value, String> {
    let builtin = builtin_agents();
    let default_catalog = builtin.as_object().unwrap();
    let catalog_map = catalog.and_then(|v| v.as_object()).unwrap_or(default_catalog);
    let mut source_catalog = Map::new();
    for (id, meta) in catalog_map {
        if !is_builtin(id) && !custom_id(id) {
            continue;
        }
        let mut entry = Map::new();
        entry.insert("name".into(), text(meta.get("name"), Some(id)));
        entry.insert("label".into(), text(meta.get("label"), Some(id)));
        entry.insert("hint".into(), text(meta.get("hint"), Some("")));
        entry.insert("icon".into(), json!(builtin_icon(id).unwrap_or_else(|| "ui/layout-grid".to_string())));
        entry.insert("quota".into(), json!(id == "codex"));
        entry.insert("custom".into(), json!(!is_builtin(id)));
        entry.insert("archived".into(), json!(meta.get("archived") == Some(&json!(true))));
        source_catalog.insert(id.clone(), Value::Object(entry));
    }
    let schema = snapshot.get("schemaVersion").and_then(|v| v.as_str()).unwrap_or("");
    let daily = snapshot.get("daily").and_then(|v| v.as_array()).ok_or("INVALID_USAGE_SNAPSHOT")?;
    if (schema != "UsageSnapshotV1" && schema != "LocalUsagePreviewV1") || daily.len() > 100_000 {
        return Err("INVALID_USAGE_SNAPSHOT".to_string());
    }
    if let Some(hourly) = snapshot.get("hourly") {
        if !hourly.is_array() || hourly.as_array().unwrap().len() > 50_000 {
            return Err("INVALID_USAGE_SNAPSHOT".to_string());
        }
    }
    let select = |row: &Value, hourly: bool| -> Result<Value, String> {
        let agent = row.get("agent").and_then(|v| v.as_str()).unwrap_or("");
        if !catalog_map.contains_key(agent) || !date_shape(row.get("date")) {
            return Err("INVALID_USAGE_ROW".to_string());
        }
        if hourly {
            let hour = row.get("hour").and_then(|v| v.as_f64()).filter(|h| h.fract() == 0.0 && *h >= 0.0 && *h <= 23.0);
            if hour.is_none() {
                return Err("INVALID_USAGE_ROW".to_string());
            }
        }
        let mut selected = Map::new();
        selected.insert("date".into(), row.get("date").cloned().unwrap());
        if hourly {
            selected.insert("hour".into(), row.get("hour").cloned().unwrap());
        }
        selected.insert("agent".into(), json!(agent));
        let entry = row.get("entry").and_then(|v| v.as_str()).unwrap_or("");
        selected.insert("entry".into(), json!(if ["desktop", "cli", "sdk", "export", "harness"].contains(&entry) { entry } else { "unknown" }));
        selected.insert("provider".into(), text(row.get("provider"), Some("unknown")));
        selected.insert("model".into(), text(row.get("model"), Some("模型未记录")));
        for field in ["totalTokens", "inputUncached", "output", "cacheRead", "cacheWrite", "reasoning", "records", "pricedTokens", "estimatedCostUsd", "partialRecords", "estimatedCostUpperUsd", "boundedTokens", "pricingReasons", "unpricedTokens", "incompleteTokens", "costParts", "cacheSavingsUsd", "knownUsage", "knownRecords"] {
            selected.insert(field.into(), Value::Null);
        }
        selected.insert("partialRecords".into(), json!(0));
        selected.insert("boundedTokens".into(), json!(0));
        for field in FIELDS {
            let raw = match row.get(field) {
                None => {
                    if field == "partialRecords" {
                        json!(0)
                    } else {
                        Value::Null
                    }
                }
                Some(v) => v.clone(),
            };
            let value = count(Some(&raw), !NON_NULLABLE.contains(&field))?;
            selected.insert(field.into(), value);
        }
        let upper = row.get("estimatedCostUpperUsd").filter(|v| !v.is_null()).or_else(|| row.get("estimatedCostUsd")).cloned();
        selected.insert("estimatedCostUpperUsd".into(), count(upper.as_ref(), true)?);
        let bounded = row.get("boundedTokens").filter(|v| !v.is_null()).cloned().unwrap_or(json!(0));
        selected.insert("boundedTokens".into(), count(Some(&bounded), false)?);
        selected.insert("pricingReasons".into(), filtered_map(row.get("pricingReasons"), &REASONS, true));
        selected.insert("unpricedTokens".into(), filtered_map(row.get("unpricedTokens"), &REASONS, true));
        selected.insert("incompleteTokens".into(), filtered_map(row.get("incompleteTokens"), &CAUSES, true));
        let cost_parts = match row.get("costParts").filter(|v| crate::normalize::truthy(v)) {
            Some(parts) => {
                let mut out = Map::new();
                for key in ["inputUncached", "output", "cacheRead", "cacheWrite"] {
                    let raw = parts.get(key).filter(|v| !v.is_null()).cloned().unwrap_or(json!(0));
                    out.insert(key.into(), count(Some(&raw), false)?);
                }
                Value::Object(out)
            }
            None => Value::Null,
        };
        selected.insert("costParts".into(), cost_parts);
        let savings = row.get("cacheSavingsUsd").filter(|v| !v.is_null()).cloned();
        selected.insert("cacheSavingsUsd".into(), count(savings.as_ref(), true)?);
        selected.insert("knownUsage".into(), filtered_map(row.get("knownUsage"), &KNOWN, false));
        selected.insert("knownRecords".into(), filtered_map(row.get("knownRecords"), &KNOWN, false));
        Ok(Value::Object(selected))
    };
    let daily: Vec<Value> = daily.iter().map(|row| select(row, false)).collect::<Result<_, _>>()?;
    let hourly: Vec<Value> = snapshot
        .get("hourly")
        .and_then(|v| v.as_array())
        .map(|rows| rows.iter().map(|row| select(row, true)).collect::<Result<Vec<_>, _>>())
        .transpose()?
        .unwrap_or_default();
    let sources: Vec<Value> = snapshot
        .get("sources")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter(|s| catalog_map.contains_key(s.get("agent").and_then(|v| v.as_str()).unwrap_or("")))
                .map(|s| {
                    let status = s.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    let errors: Vec<Value> = s
                        .get("errors")
                        .and_then(|v| v.as_array())
                        .map(|list| list.iter().filter(|e| e.as_str().map(|t| SOURCE_ERRORS.contains(&t)).unwrap_or(false)).take(12).cloned().collect())
                        .unwrap_or_default();
                    let observed = s.get("observedRecords").and_then(|v| v.as_f64()).filter(|n| n.is_finite()).map(|n| n.max(0.0)).unwrap_or(0.0);
                    let mut quality = Map::new();
                    if let Some(map) = s.get("qualityIssues").and_then(|v| v.as_object()) {
                        for (key, value) in map {
                            if !key.is_empty() && key.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') && safe_positive(value) {
                                quality.insert(key.clone(), value.clone());
                            }
                        }
                    }
                    json!({
                        "agent": s.get("agent"),
                        "status": if ["verified", "partial", "unverified", "not-detected", "error"].contains(&status) { status } else { "unverified" },
                        "realSampleVerified": s.get("realSampleVerified") == Some(&json!(true)),
                        "errors": errors,
                        "lastSuccess": text(s.get("lastSuccess"), None),
                        "observedRecords": observed,
                        "qualityIssues": quality
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let mut coverage: Vec<String> = daily.iter().map(|r| r.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string()).collect();
    coverage.sort();
    let recovered: Vec<Value> = snapshot
        .get("recovered")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter(|entry| entry.get("file").and_then(|v| v.as_str()).map(|f| f.len() <= 80).unwrap_or(false))
                .map(|entry| {
                    json!({
                        "file": entry.get("file"),
                        "quarantined": text(entry.get("quarantined"), None),
                        "code": text(entry.get("code"), Some("INVALID_JSON"))
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let price = snapshot.get("priceCatalog");
    let mut out = Map::new();
    out.insert("schemaVersion".into(), json!("LocalUsagePreviewV1"));
    out.insert("sourceSchemaVersion".into(), json!("UsageSnapshotV1"));
    out.insert("sourceCatalog".into(), Value::Object(source_catalog.clone()));
    out.insert("catalogRevision".into(), json!(revision(&Value::Object(source_catalog))));
    out.insert("sequence".into(), count(snapshot.get("sequence"), false)?);
    out.insert("collectedAt".into(), text(snapshot.get("collectedAt"), None));
    out.insert("timezone".into(), text(snapshot.get("timezone"), Some("Asia/Shanghai")));
    out.insert("today".into(), if date_shape(snapshot.get("today")) { snapshot.get("today").cloned().unwrap() } else { Value::Null });
    out.insert("coverageStart".into(), json!(coverage.first().cloned()));
    out.insert("daily".into(), json!(daily));
    out.insert("hourly".into(), json!(hourly));
    out.insert("sources".into(), json!(sources));
    out.insert("recovered".into(), json!(recovered));
    out.insert(
        "priceCatalog".into(),
        json!({
            "version": text(price.and_then(|p| p.get("version")), Some("unknown")),
            "obtainedAt": text(price.and_then(|p| p.get("obtainedAt")), None),
            "sha256": text(price.and_then(|p| p.get("sha256")), None),
            "overrideSha256": text(price.and_then(|p| p.get("overrideSha256")), None),
            "billingSha256": text(price.and_then(|p| p.get("billingSha256")), None),
            "source": text(price.and_then(|p| p.get("source")), None),
            "basis": text(price.and_then(|p| p.get("basis")), None),
            "currency": "USD",
            "kind": "API-equivalent-estimate"
        }),
    );
    Ok(Value::Object(out))
}
/// Reapply the export whitelist in the ledger owner and use JavaScript's
/// original number format, key order and indentation.
pub fn serialize_statistics(snapshot: &Value, catalog: &Value) -> Result<(String, usize), String> {
    let selected = select_snapshot(snapshot, Some(catalog))?;
    let rows = selected["daily"].as_array().map_or(0, Vec::len);
    Ok((crate::js_json::pretty_width(&selected, 2), rows))
}
