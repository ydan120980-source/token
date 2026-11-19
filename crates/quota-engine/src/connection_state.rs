use serde::Serialize;
use serde_json::{json, Value};
use usage_engine::{
    normalize::truthy,
    time::{iso_from_ms, parse_iso},
};

pub const FRESH_MS: i64 = 10 * 60_000;
const CLOCK_SKEW_MS: i64 = 60_000;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaFreshness {
    pub state: &'static str,
    pub reason: Option<&'static str>,
    pub fetched_at: Option<String>,
}

fn array(value: &Value) -> &[Value] {
    value.as_array().map_or(&[], Vec::as_slice)
}

fn time(value: &Value, now: i64) -> Option<i64> {
    parse_iso(value.as_str()?).filter(|time| *time <= now.saturating_add(CLOCK_SKEW_MS))
}

pub fn quota_freshness(account: &Value, now: i64) -> QuotaFreshness {
    let quota = &account["quota"];
    let Some(at) = time(&quota["fetchedAt"], now) else {
        return QuotaFreshness {
            state: "missing",
            reason: Some(if truthy(quota) {
                "invalid-time"
            } else {
                "not-fetched"
            }),
            fetched_at: None,
        };
    };
    let pools = quota["pools"].as_array();
    let windows: Vec<&Value> = match pools {
        Some(pools) => pools
            .iter()
            .flat_map(|pool| array(&pool["windows"]))
            .collect(),
        None => array(&quota["windows"]).iter().collect(),
    };
    let has_balances =
        pools.is_some_and(|list| list.iter().any(|pool| !array(&pool["balances"]).is_empty()));
    let (state, reason) = if windows.is_empty() && !has_balances {
        ("missing", Some("no-windows"))
    } else if windows.iter().any(|window| {
        window["resetsAt"]
            .as_str()
            .and_then(parse_iso)
            .is_some_and(|reset| reset <= now)
    }) {
        ("stale", Some("reset-passed"))
    } else if truthy(&quota["coverage"]["stale"]) {
        ("stale", Some("resource-stale"))
    } else if now.saturating_sub(at) > FRESH_MS {
        ("stale", Some("age"))
    } else if account["status"] != "ready"
        || truthy(&account["errorCode"])
        || truthy(&account["busy"])
    {
        ("cached", Some("verification-required"))
    } else {
        ("fresh", None)
    };
    QuotaFreshness {
        state,
        reason,
        fetched_at: Some(iso_from_ms(at)),
    }
}

pub fn quota_label(health: &QuotaFreshness) -> &'static str {
    match health.state {
        "fresh" => "已更新",
        "stale" => "缓存已过期 · 请刷新",
        "cached" => "缓存 · 待验证",
        _ if health.reason == Some("invalid-time") => "更新时间异常 · 请刷新",
        _ => "额度未知",
    }
}

fn quota_summary(agent: &str, meta: &Value, quota: &Value, now: i64) -> Value {
    let supported = agent == "codex"
        || array(&quota["providerCapabilities"])
            .iter()
            .any(|value| value["provider"] == agent && !array(&value["adapters"]).is_empty());
    let capability = if supported {
        "supported"
    } else if truthy(&meta["custom"]) {
        "usage-only"
    } else {
        "not-integrated"
    };
    let mut summary = json!({"capability":capability,
        "connectionState":if supported {"unknown"} else {"not-applicable"},
        "connections":null,"loginRequired":null,"failed":null,"refreshing":null,"duplicates":null,
        "freshness":null,"latestSuccess":null,"oldestSuccess":null,"latestAttempt":null,
        "cliAvailable":null,"cacheRecovered":null});
    if !supported || !quota["accounts"].is_array() {
        return summary;
    }
    let source = if agent != "codex" && truthy(&quota["providerAccounts"]) {
        &quota["providerAccounts"]
    } else {
        &quota["accounts"]
    };
    let accounts: Vec<_> = array(source)
        .iter()
        .filter(|account| account["provider"] == agent)
        .take(20)
        .collect();
    let mut freshness = [0; 4];
    let mut times = Vec::new();
    let mut attempts = Vec::new();
    for account in &accounts {
        let health = quota_freshness(account, now);
        freshness[match health.state {
            "fresh" => 0,
            "stale" => 1,
            "cached" => 2,
            _ => 3,
        }] += 1;
        times.extend(health.fetched_at);
        attempts.extend(time(&account["lastAttempt"], now).map(iso_from_ms));
    }
    times.sort_unstable();
    attempts.sort_unstable();
    let login_required = accounts
        .iter()
        .filter(|account| {
            matches!(
                account["status"].as_str(),
                Some("login-required" | "login-failed")
            ) || account["errorCode"] == "LOGIN_REQUIRED"
                || account["credentialReady"] == false
        })
        .count();
    let failed = accounts
        .iter()
        .filter(|account| {
            (account["status"] == "error" || truthy(&account["errorCode"]))
                && !matches!(
                    account["errorCode"].as_str(),
                    Some("LOGIN_REQUIRED" | "PROVIDER_AUTH_REQUIRED" | "PROVIDER_PASSIVE_PENDING")
                )
        })
        .count();
    let connection_state = if login_required > 0 || failed > 0 {
        "attention"
    } else if accounts
        .iter()
        .any(|account| account["status"] == "connecting")
    {
        "connecting"
    } else if accounts.is_empty() {
        "not-connected"
    } else {
        "connected"
    };
    summary["connectionState"] = json!(connection_state);
    summary["connections"] = json!(accounts.len());
    summary["loginRequired"] = json!(login_required);
    summary["failed"] = json!(failed);
    summary["refreshing"] = json!(accounts
        .iter()
        .filter(|account| account["status"] == "refreshing")
        .count());
    summary["duplicates"] = json!(accounts
        .iter()
        .filter(|account| truthy(&account["duplicateKnown"]))
        .count());
    summary["freshness"] = json!({"fresh":freshness[0],"stale":freshness[1],"cached":freshness[2],"missing":freshness[3]});
    summary["latestSuccess"] = json!(times.last());
    summary["oldestSuccess"] = json!(times.first());
    summary["latestAttempt"] = json!(attempts.last());
    if agent == "codex" {
        summary["cliAvailable"] = json!(quota["executableAvailable"].as_bool());
    }
    summary["cacheRecovered"] = json!(agent == "codex" && truthy(&quota["recovered"]));
    summary
}

#[derive(Clone, Copy)]
pub struct Inputs<'a> {
    pub catalog: &'a Value,
    pub collection: &'a Value,
    pub statuses: &'a Value,
    pub disabled: &'a Value,
    pub custom: &'a Value,
    pub discovered: &'a Value,
    pub quota: &'a Value,
    pub now: i64,
}

pub fn project_connections(input: Inputs<'_>) -> Value {
    let rows: Vec<_> = input
        .catalog
        .as_object()
        .into_iter()
        .flatten()
        .map(|(agent, meta)| {
            let raw = &input.statuses[agent];
            let installed = array(input.discovered)
                .iter()
                .find(|entry| entry["agent"] == agent.as_str())
                .and_then(|entry| entry["installed"].as_bool());
            let custom = truthy(&meta["custom"]);
            let archived = truthy(&meta["archived"]);
            let stopped = input.collection["enabled"] == false
                || array(input.disabled)
                    .iter()
                    .any(|value| value == agent.as_str())
                || custom && (input.custom[agent]["enabled"] == false || archived);
            let known = !input.collection.is_null()
                || input.statuses.get(agent).is_some()
                || installed.is_some();
            let observed = raw["observedRecords"].as_f64();
            let state = if stopped {
                "paused"
            } else if !known {
                "unknown"
            } else if raw["status"] == "error" {
                "error"
            } else if raw["status"] == "partial" {
                "partial"
            } else if installed == Some(false) && !truthy(&raw["observedRecords"]) {
                "not-detected"
            } else if truthy(&raw["lastSuccess"]) || observed.is_some_and(|count| count > 0.0) {
                "available"
            } else {
                "not-read"
            };
            let last_state = raw["status"].as_str().filter(|state| {
                matches!(
                    *state,
                    "verified" | "unverified" | "partial" | "error" | "not-detected"
                )
            });
            let observed = observed
                .filter(|value| {
                    *value >= 0.0 && *value <= 9_007_199_254_740_991.0 && value.fract() == 0.0
                })
                .map(|value| value as u64);
            let name = meta["name"].as_str().map_or_else(
                || agent.to_owned(),
                |name| String::from_utf16_lossy(&name.encode_utf16().take(80).collect::<Vec<_>>()),
            );
            json!({"agent":agent,"name":name,"custom":custom,"archived":archived,
            "usage":{"state":state,"lastState":last_state,"observedRecords":observed,
            "lastSuccess":time(&raw["lastSuccess"],input.now).map(iso_from_ms),
            "checkedAt":time(&input.collection["checkedAt"],input.now).map(iso_from_ms)},
            "quota":quota_summary(agent,meta,input.quota,input.now)})
        })
        .collect();
    json!({"schemaVersion":"SourceConnectionsV1","observedAt":iso_from_ms(input.now),"rows":rows})
}

pub fn quota_description(quota: &Value) -> String {
    if quota["capability"] == "usage-only" {
        return "个人来源提供用量记录，不接入账号额度。".to_owned();
    }
    if quota["capability"] != "supported" {
        return "当前可统计用量，账号额度尚未接入。".to_owned();
    }
    if quota["connectionState"] == "unknown" {
        return "账号连接状态未检查。".to_owned();
    }
    let connections = quota["connections"].as_u64().unwrap_or(0);
    if connections == 0 {
        return if truthy(&quota["cacheRecovered"]) {
            "连接缓存已重置，请到额度页重新连接。"
        } else if quota["cliAvailable"] == false {
            "未连接账号 · 需先选择官方 Codex CLI。"
        } else {
            "尚未连接账号。"
        }
        .to_owned();
    }
    let mut parts = vec![format!("{connections} 个连接")];
    for (key, label) in [
        ("loginRequired", "需重新登录"),
        ("failed", "读取失败"),
        ("refreshing", "刷新中"),
    ] {
        if let Some(value) = quota[key].as_u64().filter(|value| *value > 0) {
            parts.push(format!("{value} 个{label}"));
        }
    }
    if quota["connectionState"] == "connecting" {
        parts.push("等待官方授权".to_owned());
    }
    for (key, label) in [
        ("fresh", "已更新"),
        ("stale", "缓存已过期"),
        ("cached", "缓存待验证"),
        ("missing", "额度未知"),
    ] {
        if let Some(value) = quota["freshness"][key].as_u64().filter(|value| *value > 0) {
            parts.push(format!("{value} 个{label}"));
        }
    }
    if truthy(&quota["duplicates"]) {
        parts.push("有重复连接，额度不可叠加".to_owned());
    }
    if quota["cliAvailable"] == false {
        parts.push("官方 Codex CLI 未就绪".to_owned());
    }
    parts.join(" · ")
}
