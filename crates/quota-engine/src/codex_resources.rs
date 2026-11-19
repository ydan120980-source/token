use crate::{
    resource_contract::{identifier, instant, javascript_iso, project_resources, valid_identifier},
    resource_state::date_millis,
};
use serde_json::{json, Map, Value};
use std::fmt;
use usage_engine::{js_json::ordered_keys, normalize::truthy};

const ROLES: [&str; 2] = ["primary", "secondary"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexProtocolError {
    Invalid,
    Limit,
}

impl fmt::Display for CodexProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Invalid => "CODEX_PROTOCOL_INVALID",
            Self::Limit => "CODEX_PROTOCOL_LIMIT",
        })
    }
}

impl std::error::Error for CodexProtocolError {}

fn label(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|label| label.encode_utf16().count() <= 160)
}

fn nonnegative(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .filter(|value| value.is_finite() && *value >= 0.0)
}

fn reset_time(value: &Value) -> Option<String> {
    iso_from_seconds(nonnegative(value)?)
}

fn iso_from_seconds(seconds: f64) -> Option<String> {
    let milliseconds = seconds * 1000.0;
    (0.0..=8_640_000_000_000_000.0)
        .contains(&milliseconds)
        .then(|| javascript_iso(milliseconds as i64))
}

fn reset_credits(value: &Value) -> Option<f64> {
    nonnegative(value).filter(|value| value.fract() == 0.0 && *value <= 9_007_199_254_740_991.0)
}

fn buckets(response: &Value) -> Vec<(&str, &Value)> {
    match response["rateLimitsByLimitId"].as_object() {
        Some(entries) if !entries.is_empty() => ordered_keys(entries)
            .into_iter()
            .map(|key| (key.as_str(), &entries[key]))
            .collect(),
        _ => vec![("codex", &response["rateLimits"])],
    }
}

/// Project the closed V1 cache and IPC contract from a Codex read response.
pub fn project_quota(response: &Value, fetched_at: &Value) -> Value {
    let windows: Vec<_> = buckets(response).into_iter().flat_map(|(id, bucket)| {
        ROLES.into_iter().filter_map(move |role| {
            let meter = &bucket[role];
            if !truthy(meter) {
                return None;
            }
            let used = nonnegative(&meter["usedPercent"]);
            let id_label = (id.encode_utf16().count() <= 160).then_some(id);
            Some(json!({"bucket":id_label.unwrap_or("codex"), "name":label(&bucket["limitName"]).or(id_label).unwrap_or("Codex"), "kind":role,
                "usedPercent":used, "remainingPercent":used.map(|used| (100.0 - used).max(0.0)),
                "durationMins":nonnegative(&meter["windowDurationMins"]), "resetsAt":reset_time(&meter["resetsAt"])}))
        })
    }).collect();
    json!({"schemaVersion":"AccountQuotaV1", "fetchedAt":fetched_at, "windows":windows,
        "resetCredits":reset_credits(&response["rateLimitResetCredits"]["availableCount"])})
}

pub fn project_cached_quota(quota: &Value) -> Option<Value> {
    if quota["schemaVersion"] != "AccountQuotaV1" {
        return None;
    }
    let windows = quota["windows"]
        .as_array()
        .filter(|windows| windows.len() <= 200)?;
    if windows.iter().any(Value::is_null) {
        return None;
    }
    let windows: Vec<_> = windows
        .iter()
        .map(|window| {
            let used = nonnegative(&window["usedPercent"]);
            let kind = if window["kind"] == "secondary" {
                "secondary"
            } else {
                "primary"
            };
            let resets_at = date_millis(&window["resetsAt"])
                .and_then(|time| iso_from_seconds(time as f64 / 1000.0));
            json!({"bucket":label(&window["bucket"]).unwrap_or("codex"),
            "name":label(&window["name"]).unwrap_or("codex"), "kind":kind, "usedPercent":used,
            "remainingPercent":used.map(|used| (100.0 - used).max(0.0)),
            "durationMins":nonnegative(&window["durationMins"]), "resetsAt":resets_at})
        })
        .collect();
    Some(
        json!({"schemaVersion":"AccountQuotaV1", "fetchedAt":label(&quota["fetchedAt"]),
        "windows":windows, "resetCredits":reset_credits(&quota["resetCredits"])}),
    )
}

fn resource_pool(id: &str, label: &Value) -> Value {
    json!({"id":id, "label":label, "scope":"unknown", "windows":[], "balances":[]})
}

fn create_pools(windows: &Value) -> Option<Map<String, Value>> {
    let mut pools = Map::new();
    for window in windows.as_array()? {
        let id = identifier(&window["bucket"])?;
        let pool = pools
            .entry(id)
            .or_insert_with(|| resource_pool(id, &window["name"]));
        pool["windows"].as_array_mut()?.push(json!({
            "id":window["kind"], "role":window["kind"], "unit":"percent",
            "usedPercent":window["usedPercent"], "durationMins":window["durationMins"],
            "resetsAt":window["resetsAt"], "requiresEntitlement":true,
        }));
    }
    Some(pools)
}

fn project_codex(
    pools: Map<String, Value>,
    fetched_at: &Value,
    plan: &Value,
    provenance: &str,
    credits: &Value,
) -> Option<Value> {
    project_resources(
        &json!({"schemaVersion":"AccountQuotaV2", "provider":"codex",
        "fetchedAt":fetched_at, "provenance":{"kind":provenance},
        "entitlement":{"plan":plan, "state":"unknown", "observedAt":fetched_at},
        "pools":pools.into_iter().map(|(_,value)| value).collect::<Vec<_>>(),
        "resetCredits":credits}),
    )
}

pub fn from_codex(
    response: &Value,
    fetched_at: &Value,
    plan: &Value,
) -> Result<Value, CodexProtocolError> {
    use CodexProtocolError::{Invalid, Limit};
    let limit_fields = ["rateLimits", "rateLimitsByLimitId"];
    if limit_fields.iter().all(|key| response.get(*key).is_none())
        || limit_fields
            .iter()
            .any(|key| !response[*key].is_null() && !response[*key].is_object())
    {
        return Err(Invalid);
    }
    let entries: Vec<_> = buckets(response)
        .into_iter()
        .filter(|(_, bucket)| !bucket.is_null())
        .collect();
    if entries.len() > 100
        || response["rateLimitsByLimitId"]
            .as_object()
            .is_some_and(|entries| entries.len() > 100)
    {
        return Err(Limit);
    }
    if response["rateLimitsByLimitId"]
        .as_object()
        .is_some_and(|buckets| buckets.values().any(Value::is_null))
        || entries.iter().any(|(id, bucket)| {
            !valid_identifier(id)
                || !bucket.is_object()
                || ["primary", "secondary", "credits"]
                    .iter()
                    .any(|role| !bucket[*role].is_null() && !bucket[*role].is_object())
        })
    {
        return Err(Invalid);
    }
    let legacy = project_quota(response, fetched_at);
    let mut pools = create_pools(&legacy["windows"]).ok_or(Invalid)?;
    for (id, source) in entries {
        let pool = pools.entry(id).or_insert_with(|| {
            let id_value = json!(id);
            let name = if truthy(&source["limitName"]) {
                &source["limitName"]
            } else {
                &id_value
            };
            resource_pool(id, name)
        });
        for window in pool["windows"].as_array_mut().ok_or(Invalid)? {
            let meter = &source[window["role"].as_str().ok_or(Invalid)?];
            window["usedPercent"] = meter["usedPercent"].clone();
            window["durationMins"] = meter["windowDurationMins"].clone();
            if !meter["resetsAt"].is_null() && window["resetsAt"].is_null() {
                window["issues"] = json!(["INVALID_TIME"]);
            }
        }
        let credits = &source["credits"];
        if credits.is_object() {
            let availability = if credits["unlimited"] == true {
                "unlimited"
            } else if credits["hasCredits"] == false {
                "unavailable"
            } else if credits["hasCredits"] == true {
                "available"
            } else {
                "unknown"
            };
            pool["balances"].as_array_mut().ok_or(Invalid)?.push(json!({
                "id":"purchased-credits", "kind":"purchased", "unit":"credits",
                "remaining":credits["balance"], "availability":availability,
            }));
        }
    }
    instant(fetched_at).ok_or(Invalid)?;
    project_codex(
        pools,
        fetched_at,
        plan,
        "official-cli",
        &legacy["resetCredits"],
    )
    .ok_or(Invalid)
}

pub fn to_legacy(resources: &Value) -> Option<Value> {
    let pools = resources["pools"].as_array()?;
    let windows: Vec<_> = pools.iter().flat_map(|pool| {
        pool["windows"].as_array().into_iter().flatten().filter_map(move |window| {
            let role = window["role"].as_str()?;
            (window["unit"] == "percent" && ROLES.contains(&role)).then(|| {
                json!({"bucket":pool["id"], "name":pool["label"], "kind":role,
                    "usedPercent":window["usedPercent"], "remainingPercent":window["remainingPercent"],
                    "durationMins":window["durationMins"], "resetsAt":window["resetsAt"]})
            })
        })
    }).collect();
    Some(
        json!({"schemaVersion":"AccountQuotaV1", "fetchedAt":resources["fetchedAt"],
        "windows":windows, "resetCredits":resources["resetCredits"]}),
    )
}

pub fn restore_quota(raw: &Value, plan: &Value) -> Option<Value> {
    let resources = if raw["schemaVersion"] == "AccountQuotaV1" {
        let saved = project_cached_quota(raw)?;
        project_codex(
            create_pools(&saved["windows"])?,
            &saved["fetchedAt"],
            plan,
            "legacy-cache",
            &saved["resetCredits"],
        )?
    } else {
        project_resources(raw)?
    };
    (resources["provider"] == "codex").then_some(resources)
}
