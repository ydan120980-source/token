use crate::{
    provider_adapters::AdapterError,
    resource_contract::{identifier, instant, project_resources, text},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fmt};
use usage_engine::js_json::stringify;

const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const COUNTERS: [&str; 5] = [
    "input_tokens",
    "output_tokens",
    "thinking_tokens",
    "cache_read_tokens",
    "total_tokens",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CliError {
    VersionUnsupported,
    ProtocolInvalid,
    OutputLimit,
    ModelTurnDetected,
    NoTurnUnverified,
    RequestFailed,
}

impl fmt::Display for CliError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::VersionUnsupported => "AGY_VERSION_UNSUPPORTED",
            Self::ProtocolInvalid => "AGY_PROTOCOL_INVALID",
            Self::OutputLimit => "AGY_OUTPUT_LIMIT",
            Self::ModelTurnDetected => "AGY_MODEL_TURN_DETECTED",
            Self::NoTurnUnverified => "AGY_NO_TURN_UNVERIFIED",
            Self::RequestFailed => "AGY_REQUEST_FAILED",
        })
    }
}

impl std::error::Error for CliError {}

fn version(value: &str) -> Option<(&str, [u16; 3])> {
    if value.encode_utf16().count() > 120 {
        return None;
    }
    let value = value.trim();
    let next = |input: &str| input.find(char::is_whitespace);
    let value = match next(value) {
        Some(index) if value[..index].eq_ignore_ascii_case("antigravity") => {
            let rest = value[index..].trim_start();
            match next(rest) {
                Some(index) if rest[..index].eq_ignore_ascii_case("cli") => {
                    rest[index..].trim_start()
                }
                _ => rest,
            }
        }
        Some(index) if value[..index].eq_ignore_ascii_case("agy") => value[index..].trim_start(),
        _ => value,
    };
    let value = match next(value) {
        Some(index) if value[..index].eq_ignore_ascii_case("version") => {
            value[index..].trim_start()
        }
        _ => value.strip_prefix(['v', 'V']).unwrap_or(value),
    };
    let mut fields = value.split('.');
    let mut result = [0; 3];
    for part in &mut result {
        let field = fields.next()?;
        if !(1..=4).contains(&field.len())
            || (field.len() > 1 && field.starts_with('0'))
            || !field.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        *part = field.parse().ok()?;
    }
    fields.next().is_none().then_some((value, result))
}

fn envelopes(stdout: &str) -> Result<Vec<Value>, CliError> {
    if stdout.len() > MAX_OUTPUT_BYTES {
        return Err(CliError::OutputLimit);
    }
    let trimmed = stdout.trim();
    if let Ok(value) = serde_json::from_str(trimmed) {
        return Ok(vec![value]);
    }
    let records = trimmed
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with(['{', '[']))
        .map(serde_json::from_str)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| CliError::ProtocolInvalid)?;
    if records.is_empty() {
        Err(CliError::ProtocolInvalid)
    } else {
        Ok(records)
    }
}

fn positive(value: &Value) -> bool {
    value.as_f64().is_some_and(|value| value > 0.0)
}
fn zero(value: &Value) -> bool {
    value.as_f64() == Some(0.0)
}
fn model_turn(value: &Value) -> bool {
    positive(&value["num_turns"])
        || value["conversation_id"]
            .as_str()
            .is_some_and(|id| !id.is_empty())
        || value["usage"]
            .as_object()
            .is_some_and(|usage| usage.values().any(positive))
}

fn meter(id: &str, label: Option<&str>, duration: Option<u64>, value: &Value) -> Value {
    let fraction = &value["remaining_fraction"];
    let valid = fraction
        .as_f64()
        .filter(|value| (0.0..=1.0).contains(value));
    let issues: &[&str] = if !fraction.is_null() && valid.is_none() {
        &["INVALID_PERCENT"]
    } else {
        &[]
    };
    json!({"id":id, "label":label, "unit":"percent", "role":"other", "cadence":"unknown",
        "durationMins":duration, "usedPercent":valid.map(|value| (1.0 - value) * 100.0),
        "resetsAt":value["reset_time"], "availability":if value["disabled"] == true { "disabled" } else { "unknown" },
        "requiresEntitlement":true, "issues":issues})
}

fn reviewed(value: &str) -> Option<&str> {
    version(value)
        .filter(|(_, fields)| ([1, 1, 11]..=[1, 4, 2]).contains(fields))
        .map(|(version, _)| version)
}

pub(crate) fn is_reviewed_version(value: &str) -> bool {
    reviewed(value).is_some()
}

/// Project a captured CLI response after proving that it executed no model turn.
pub fn from_antigravity(
    stdout: &str,
    fetched_at: &Value,
    cli_version: &str,
) -> Result<Value, CliError> {
    use CliError::*;
    let version = reviewed(cli_version).ok_or(VersionUnsupported)?;
    instant(fetched_at).ok_or(ProtocolInvalid)?;
    let records = envelopes(stdout)?;
    if records.iter().any(model_turn) {
        return Err(ModelTurnDetected);
    }
    if records.iter().any(|value| !value.is_object()) {
        return Err(ProtocolInvalid);
    }
    if records.iter().any(|value| {
        value.get("num_turns").is_some_and(|count| !zero(count))
            || value.get("conversation_id").is_some_and(|id| id != "")
    }) {
        return Err(NoTurnUnverified);
    }
    if records.iter().any(|value| {
        value
            .get("status")
            .is_some_and(|status| status != "SUCCESS")
    }) {
        return Err(RequestFailed);
    }
    let mut replies = records
        .iter()
        .filter(|value| value["command"]["name"] == "usage");
    let reply = replies.next().ok_or(ProtocolInvalid)?;
    if replies.next().is_some() {
        return Err(ProtocolInvalid);
    }
    if reply["status"] != "SUCCESS" {
        return Err(RequestFailed);
    }
    let counters = reply["usage"].as_object().ok_or(NoTurnUnverified)?;
    if !zero(&reply["num_turns"])
        || reply["conversation_id"] != ""
        || COUNTERS
            .iter()
            .any(|counter| !zero(&reply["usage"][*counter]))
        || !counters.values().all(zero)
    {
        return Err(NoTurnUnverified);
    }
    let data = &reply["command"]["data"];
    if partial(data) || (!data["next_page_token"].is_null() && data["next_page_token"] != "") {
        return Err(ProtocolInvalid);
    }
    let groups = data["groups"]
        .as_array()
        .filter(|groups| groups.len() <= 100)
        .ok_or(ProtocolInvalid)?;
    let mut ids = HashSet::new();
    let mut pools = Vec::new();
    for group in groups {
        let label = text(&group["name"]).ok_or(ProtocolInvalid)?;
        if partial(group) {
            return Err(ProtocolInvalid);
        }
        let buckets = group["buckets"]
            .as_array()
            .filter(|buckets| !buckets.is_empty() && buckets.len() <= 200 - ids.len())
            .ok_or(ProtocolInvalid)?;
        let mut windows = Vec::new();
        let mut group_ids = Vec::new();
        for bucket in buckets {
            let id = identifier(&bucket["id"]).ok_or(ProtocolInvalid)?;
            if !ids.insert(id)
                || bucket
                    .get("disabled")
                    .is_some_and(|flag| !flag.is_boolean())
            {
                return Err(ProtocolInvalid);
            }
            let duration = match bucket["window"].as_str() {
                Some("weekly") => Some(10080),
                Some("5h") => Some(300),
                _ => None,
            };
            windows.push(meter(
                id,
                text(&bucket["name"]).or_else(|| text(&bucket["window"])),
                duration,
                bucket,
            ));
            group_ids.push(id);
        }
        group_ids.sort_unstable();
        let id = format!("group:{:x}", Sha256::digest(stringify(&json!(group_ids))));
        pools.push(
            json!({"id":id, "label":label, "scope":"unknown", "windows":windows, "balances":[]}),
        );
    }
    project_resources(
        &json!({"schemaVersion":"AccountQuotaV2", "provider":"antigravity",
        "fetchedAt":fetched_at, "provenance":{"kind":"official-cli", "version":version},
        "entitlement":{"state":"unknown", "observedAt":fetched_at}, "pools":pools}),
    )
    .ok_or(ProtocolInvalid)
}

fn partial(value: &Value) -> bool {
    value["partial"] == true || value["has_more"] == true
}

/// Project an explicit passive statusline observation without retaining model IDs.
pub fn from_statusline(raw: &Value, observed_at: &Value) -> Result<Value, AdapterError> {
    use AdapterError::{InvalidResponse, OutputLimit};
    if raw["product"] != "antigravity"
        || instant(observed_at).is_none()
        || (!raw["quota"].is_null() && !raw["quota"].is_object())
    {
        return Err(InvalidResponse);
    }
    let mut entries: Vec<_> = raw["quota"].as_object().into_iter().flatten().collect();
    if entries.len() > 200 {
        return Err(OutputLimit);
    }
    entries.sort_unstable_by(|(left, _), (right, _)| left.encode_utf16().cmp(right.encode_utf16()));
    let windows = entries
        .into_iter()
        .enumerate()
        .map(|(index, (key, value))| {
            if !value.is_object() {
                return Err(InvalidResponse);
            }
            let id = format!("bucket:{:x}", Sha256::digest(key));
            let label = format!("额度约束 {}", index + 1);
            let mut view = meter(&id, Some(&label), None, value);
            view["availability"] = json!("unknown");
            Ok(view)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let pools = if windows.is_empty() {
        vec![]
    } else {
        vec![
            json!({"id":"statusline", "label":"官方状态栏约束集合 · 归属未核验", "scope":"unknown", "windows":windows, "balances":[]}),
        ]
    };
    let version = raw["version"]
        .as_str()
        .and_then(version)
        .map(|(version, _)| version);
    project_resources(&json!({"schemaVersion":"AccountQuotaV2", "provider":"antigravity", "fetchedAt":observed_at,
        "incomplete":true, "provenance":{"kind":"passive", "version":version}, "entitlement":{}, "pools":pools})).ok_or(InvalidResponse)
}
