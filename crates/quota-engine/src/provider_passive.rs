use crate::{
    account_cache::{read_bounded, valid_id, AccountCache},
    antigravity_resources,
    provider_adapters::AdapterError,
    resource_contract::{instant, project_resources},
};
use serde_json::{json, Value};
use std::{
    io::{self, Read},
    path::{Path, PathBuf},
};
use usage_engine::time::{iso_from_ms, now_ms};
use zeroize::Zeroizing;

const LIMIT: usize = 512 * 1024;

fn project_claude(raw: &Value, at: &Value) -> Result<Value, AdapterError> {
    if !raw.is_object() || instant(at).is_none() {
        return Err(AdapterError::InvalidResponse);
    }
    let mut windows = Vec::new();
    for (id, minutes, label) in [
        ("five_hour", Some(300), "5 小时订阅约束"),
        ("seven_day", Some(10_080), "7 天订阅约束"),
        ("spend_limit", None, "网关消费约束"),
    ] {
        let window = &raw["rate_limits"][id];
        if window.is_null() {
            continue;
        }
        let used = window["used_percentage"]
            .as_f64()
            .filter(|value| (0. ..=100.).contains(value))
            .ok_or(AdapterError::InvalidResponse)?;
        let reset = window["resets_at"]
            .as_f64()
            .filter(|seconds| (0. ..=8_640_000_000_000.).contains(seconds) && seconds.fract() == 0.)
            .map(|seconds| iso_from_ms(seconds as i64 * 1000));
        windows.push(
            json!({"id":id,"label":label,"unit":"percent","durationMins":minutes,
            "usedPercent":used,"resetsAt":reset}),
        );
    }
    let pools = if windows.is_empty() {
        vec![]
    } else {
        vec![
            json!({"id":"statusline","label":"官方状态栏观测 · 非后台查询",
            "scope":"unknown","windows":windows,"balances":[]}),
        ]
    };
    project_resources(&json!({"schemaVersion":"AccountQuotaV2","provider":"claude",
        "fetchedAt":at,"incomplete":true,"provenance":{"kind":"passive","version":raw["version"].as_str()},
        "entitlement":{},"pools":pools})).ok_or(AdapterError::InvalidResponse)
}

fn project(adapter: &str, raw: &Value, at: &Value) -> Result<Value, AdapterError> {
    match adapter {
        "claude-statusline" => project_claude(raw, at),
        "antigravity-statusline" => antigravity_resources::from_statusline(raw, at),
        _ => Err(AdapterError::InvalidResponse),
    }
}

fn inbox(root: &Path, id: &str) -> io::Result<PathBuf> {
    if !valid_id(id) {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    Ok(root.join("statusline").join(format!("{id}.json")))
}

pub fn observation(root: &Path, id: &str, provider: &str) -> io::Result<Option<Value>> {
    let file = inbox(root, id)?;
    let Some(bytes) = read_bounded(&file, LIMIT)? else {
        return Ok(None);
    };
    let parsed = serde_json::from_slice::<Value>(&bytes).map_err(io::Error::other)?;
    project_resources(&parsed)
        .filter(|quota| quota["provider"] == provider && quota["provenance"]["kind"] == "passive")
        .map(Some)
        .ok_or_else(|| io::ErrorKind::InvalidData.into())
}

/// Read explicit statusline stdin and save only the projected observation.
/// The caller supplies the fixed Tauri profile, never an input-provided path.
pub fn receive(root: &Path, id: &str, input: impl Read) -> io::Result<()> {
    let file = inbox(root, id)?;
    let adapter = AccountCache::passive_adapter(root, id)?;
    let provider = match adapter.as_str() {
        "claude-statusline" => "claude",
        "antigravity-statusline" => "antigravity",
        _ => return Err(io::ErrorKind::InvalidInput.into()),
    };
    let mut bytes = Zeroizing::new(Vec::new());
    input.take(LIMIT as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > LIMIT {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let bytes = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(&bytes);
    let previous = observation(root, id, provider)?;
    let mut raw = serde_json::from_slice::<Value>(bytes).map_err(io::Error::other)?;
    let result = (|| {
        if let Some(old) = previous {
            if project(&adapter, &raw, &old["fetchedAt"]).map_err(io::Error::other)? == old {
                return Ok(());
            }
        }
        let quota =
            project(&adapter, &raw, &json!(iso_from_ms(now_ms()))).map_err(io::Error::other)?;
        usage_engine::store_io::atomic(&file, &quota, false)
    })();
    crate::provider_vault::wipe(&mut raw);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account_service::{AccountService, ManualConnect};

    #[test]
    fn passive_report_is_whitelisted_and_identical_reports_keep_original_time(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let accounts = AccountService::open(root.path())?;
        accounts.add_passive(&serde_json::from_value::<ManualConnect>(json!({
            "adapter":"claude-statusline","alias":"Fixture","credential":null
        }))?)?;
        let state = accounts.provider_state(now_ms())?;
        let id = state["accounts"][0]["id"]
            .as_str()
            .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidData))?;
        let payload = br#"{"rate_limits":{"five_hour":{"used_percentage":15}},"private":"SYNTHETIC_PRIVATE"}"#;
        receive(root.path(), id, &payload[..])?;
        let quota = observation(root.path(), id, "claude")?
            .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidData))?;
        assert_eq!(quota["pools"][0]["windows"][0]["usedPercent"], 15.0);
        assert!(!quota.to_string().contains("SYNTHETIC_PRIVATE"));
        receive(root.path(), id, &payload[..])?;
        assert_eq!(observation(root.path(), id, "claude")?, Some(quota));
        assert!(receive(
            root.path(),
            "00000000-0000-4000-8000-000000000000",
            &payload[..]
        )
        .is_err());
        assert!(accounts.refresh_passive(root.path(), id)?);
        assert_eq!(
            accounts.provider_state(now_ms())?["accounts"][0]["status"],
            "ready"
        );
        Ok(())
    }
}
