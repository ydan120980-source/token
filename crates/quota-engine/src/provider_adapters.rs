//! Normalize built-in provider responses without accessing authentication, transport or storage.

mod account;
mod workspace;

use crate::{
    provider_catalog::routes,
    resource_contract::{amount, instant, javascript_iso, project_resources},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;
use usage_engine::{amount::amount_str, normalize::truthy};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterError {
    InvalidResponse,
    OutputLimit,
    QuotaUnavailable,
    AuthRequired,
    AccessDenied,
}

impl fmt::Display for AdapterError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::InvalidResponse => "PROVIDER_RESPONSE_INVALID",
            Self::OutputLimit => "PROVIDER_OUTPUT_LIMIT",
            Self::QuotaUnavailable => "PROVIDER_QUOTA_UNAVAILABLE",
            Self::AuthRequired => "PROVIDER_AUTH_REQUIRED",
            Self::AccessDenied => "PROVIDER_ACCESS_DENIED",
        })
    }
}

impl std::error::Error for AdapterError {}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AdapterOptions {
    pub complete_packages: bool,
}

struct Draft<'a> {
    pools: Vec<Value>,
    incomplete: bool,
    plan: Option<&'a Value>,
    entitlement_state: &'static str,
    valid_until: Option<&'a Value>,
}

impl<'a> Draft<'a> {
    fn new(pools: Vec<Value>, incomplete: bool) -> Self {
        Self {
            pools,
            incomplete,
            plan: None,
            entitlement_state: "unknown",
            valid_until: None,
        }
    }
}

type Parsed<'a> = Result<Draft<'a>, AdapterError>;
use AdapterError::InvalidResponse;

pub fn from_provider(
    adapter: &str,
    raw: &Value,
    fetched_at: &Value,
    options: AdapterOptions,
) -> Result<Value, AdapterError> {
    let route = routes()
        .ok()
        .and_then(|routes| routes.get(adapter))
        .ok_or(InvalidResponse)?;
    let valid_raw = if adapter == "gemini-web" {
        raw.is_array()
    } else {
        raw.is_object()
    };
    if !valid_raw || instant(fetched_at).is_none() {
        return Err(InvalidResponse);
    }
    let draft = match adapter {
        "claude-web" | "claude-oauth" => account::claude(raw),
        "cursor-web" => workspace::cursor(raw),
        "deepseek-api" => account::deepseek_api(raw),
        "deepseek-web" => account::deepseek_web(raw),
        "gemini-code-assist" => workspace::gemini_code_assist(raw),
        "gemini-web" => account::gemini(raw),
        "mimo-web" => account::mimo(raw),
        "opencode-go" => workspace::opencode_go(raw),
        "opencode-web" => workspace::opencode_web(raw),
        "opencode-zen" => workspace::opencode_zen(raw),
        "workbuddy-credit" => account::workbuddy_credit(raw),
        "workbuddy-desktop" => account::workbuddy_desktop(raw, options.complete_packages),
        "workbuddy-web" => account::workbuddy_web(raw),
        "zai-cn" | "zai-global" => account::zai(raw),
        "zcode-device" => account::zcode(raw),
        _ => Err(InvalidResponse),
    }?;
    let has_items = draft.pools.iter().any(|pool| {
        [&pool["balances"], &pool["windows"]]
            .iter()
            .any(|items| items.as_array().is_some_and(|items| !items.is_empty()))
    });
    let valid_empty_zcode = adapter == "zcode-device" && draft.pools.is_empty();
    if !has_items && !valid_empty_zcode {
        return Err(AdapterError::QuotaUnavailable);
    }
    project_resources(&json!({
        "schemaVersion":"AccountQuotaV2", "provider":route["provider"],
        "fetchedAt":fetched_at, "incomplete":draft.incomplete,
        "provenance":{"kind":route["provenance"]},
        "entitlement":{"plan":draft.plan, "state":draft.entitlement_state, "validUntil":draft.valid_until},
        "pools":draft.pools,
    })).ok_or(InvalidResponse)
}

fn list(raw: &Value, cap: usize) -> Result<&[Value], AdapterError> {
    raw.as_array()
        .filter(|items| items.len() <= cap)
        .map(Vec::as_slice)
        .ok_or(InvalidResponse)
}

fn pool(id: &str, label: &str, scope: &str, windows: Vec<Value>, balances: Vec<Value>) -> Value {
    json!({"id":id, "label":label, "scope":scope, "windows":windows, "balances":balances})
}

fn percent(value: &Value) -> Result<f64, AdapterError> {
    value
        .as_f64()
        .filter(|number| (0.0..=100.0).contains(number))
        .ok_or(InvalidResponse)
}

fn fraction(value: &Value) -> Result<f64, AdapterError> {
    value
        .as_f64()
        .filter(|number| (0.0..=1.0).contains(number))
        .ok_or(InvalidResponse)
}

fn scaled_amount(normalized: &str, scale: usize) -> Option<String> {
    let (whole, fraction) = normalized.split_once('.').unwrap_or((normalized, ""));
    let padded = format!("{:0>width$}", whole, width = scale + 1);
    let (integer, decimals) = padded.split_at(padded.len() - scale);
    amount_str(&format!("{integer}.{decimals}{fraction}"))
}

fn scaled(raw: &Value, scale: usize) -> Result<String, AdapterError> {
    amount(raw)
        .and_then(|value| scaled_amount(&value, scale))
        .ok_or(InvalidResponse)
}

fn epoch_date(ms: f64) -> Option<String> {
    let limit = 8_640_000_000_000_000.0;
    if ms.fract() != 0.0 || ms <= 0.0 || ms > limit {
        return None;
    }
    Some(javascript_iso(ms as i64))
}

fn string_or<'a>(value: &'a Value, fallback: &'a str) -> &'a str {
    value.as_str().unwrap_or(fallback)
}

fn is_number(value: &Value, number: f64) -> bool {
    value.as_f64() == Some(number)
}
