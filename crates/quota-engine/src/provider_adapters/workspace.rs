use super::{
    fraction, percent, pool, scaled, scaled_amount, truthy, Draft, InvalidResponse, Parsed,
};
use crate::resource_contract::{amount, identifier};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(super) fn opencode_zen(raw: &Value) -> Parsed<'_> {
    let value = &raw["balanceMicroCents"];
    let negative = value.as_str().and_then(|text| text.strip_prefix('-'));
    let dollars = match negative {
        Some(unsigned) => usage_engine::amount::amount_str(unsigned)
            .and_then(|value| scaled_amount(&value, 8))
            .ok_or(InvalidResponse)?,
        None => scaled(value, 8)?,
    };
    let owed = negative.is_some() && dollars != "0";
    let mut balance =
        json!({"id":"balance", "kind":"purchased", "unit":"currency", "currency":"USD"});
    if owed {
        balance["label"] = json!("待结清金额（不是可用余额）");
        balance["used"] = json!(dollars);
        balance["availability"] = json!("unavailable");
    } else {
        balance["label"] = json!("预付按量余额");
        balance["remaining"] = json!(dollars);
    }
    Ok(Draft::new(
        vec![pool(
            "zen-payg",
            "Zen 按量余额 · 不含 Go 订阅或月预算",
            "workspace",
            vec![],
            vec![balance],
        )],
        true,
    ))
}

pub(super) fn opencode_go(raw: &Value) -> Parsed<'_> {
    let usage = &raw["usage"];
    if !usage.is_object() {
        return Err(InvalidResponse);
    }
    let mut windows = Vec::new();
    for (id, label, duration, cadence) in [
        ("rolling", "滚动窗口", Some(300), "rolling"),
        ("weekly", "每周窗口", Some(10080), "calendar"),
        ("monthly", "每月窗口", None, "calendar"),
    ] {
        let meter = &usage[id];
        if meter.is_null() {
            continue;
        }
        let used_percent = percent(&meter["percent"])?;
        let availability = match meter["status"].as_str() {
            Some("ok") => "unknown",
            Some("rate-limited") => "unavailable",
            _ => return Err(InvalidResponse),
        };
        windows.push(
            json!({"id":id, "label":label, "durationMins":duration, "cadence":cadence,
            "unit":"percent", "usedPercent":used_percent, "availability":availability,
            "resetsAt":meter["resetsAt"]}),
        );
    }
    Ok(Draft::new(
        vec![pool(
            "go",
            "Go 订阅窗口 · 不含按量余额",
            "unknown",
            windows,
            vec![],
        )],
        false,
    ))
}

pub(super) fn opencode_web(raw: &Value) -> Parsed<'_> {
    let access = &raw["access"];
    let meters = &access["meters"];
    if !meters.is_object() {
        return Err(InvalidResponse);
    }
    let mut windows = Vec::new();
    for (id, duration) in [
        ("fiveHour", Some(300)),
        ("week", Some(10080)),
        ("month", None),
    ] {
        let meter = &meters[id];
        if meter.is_null() {
            continue;
        }
        let resets_at = if truthy(&meter["resetsAt"]) {
            &meter["resetsAt"]
        } else if id == "month" {
            &access["endsAt"]
        } else {
            &Value::Null
        };
        let used = amount(&meter["usedMicroCents"]).ok_or(InvalidResponse)?;
        let total = amount(&meter["limitMicroCents"]).ok_or(InvalidResponse)?;
        windows.push(json!({"id":id, "unit":"currency", "currency":"USD",
            "total":scaled_amount(&total, 8),
            "used":scaled_amount(&used, 8), "remainingMode":"total-minus-used",
            "durationMins":duration, "resetsAt":resets_at}));
    }
    Ok(Draft::new(
        vec![pool(
            "console-go",
            "所选工作区 Go 订阅约束",
            "workspace",
            windows,
            vec![],
        )],
        true,
    ))
}

pub(super) fn cursor(raw: &Value) -> Parsed<'_> {
    let individual = &raw["individualUsage"];
    let plan = &individual["plan"];
    let mut pools = Vec::new();
    for (id, field, label) in [
        ("auto", "autoPercentUsed", "Auto / Composer 服务端比例"),
        ("api", "apiPercentUsed", "其他模型服务端比例"),
        (
            "reported-total",
            "totalPercentUsed",
            "服务端总体口径（与分池不可相加）",
        ),
    ] {
        let used = &plan[field];
        if !used.is_null() {
            pools.push(pool(
                id,
                label,
                "account",
                vec![json!({"id":"reported", "unit":"percent",
                "usedPercent":percent(used)?, "resetsAt":raw["billingCycleEnd"]})],
                vec![],
            ));
        }
    }
    for (id, meter, scope, label) in [
        ("plan-budget", plan, "account", "接口金额约束（历史口径）"),
        (
            "personal-cap",
            &individual["overall"],
            "account",
            "个人消费上限约束",
        ),
        (
            "team-pool",
            &raw["teamUsage"]["pooled"],
            "workspace",
            "共享团队约束（不可与个人约束相加）",
        ),
        (
            "on-demand",
            &individual["onDemand"],
            "account",
            "按需消费上限余量 · 非预付余额",
        ),
    ] {
        if meter["used"].is_null() && meter["limit"].is_null() {
            continue;
        }
        let cents = |key| {
            meter
                .get(key)
                .filter(|value| !value.is_null())
                .map(|value| scaled(value, 2))
                .transpose()
        };
        pools.push(pool(
            id,
            label,
            scope,
            vec![json!({"id":"budget", "label":label, "unit":"currency",
            "currency":"USD", "total":cents("limit")?, "used":cents("used")?,
            "remainingMode":"total-minus-used", "resetsAt":raw["billingCycleEnd"]})],
            vec![],
        ));
    }
    Ok(Draft {
        plan: raw.get("membershipType"),
        ..Draft::new(pools, true)
    })
}

pub(super) fn gemini_code_assist(raw: &Value) -> Parsed<'_> {
    let mut pools = Vec::new();
    let mut ids = BTreeSet::new();
    for bucket in super::list(&raw["buckets"], 100)? {
        let model = identifier(&bucket["modelId"]).ok_or(InvalidResponse)?;
        let token_type = bucket["tokenType"]
            .as_str()
            .filter(|value| value.encode_utf16().count() <= 80)
            .ok_or(InvalidResponse)?;
        let mut digest = Sha256::new();
        digest.update(model);
        digest.update([0]);
        digest.update(token_type);
        let hash = format!("{:x}", digest.finalize());
        let id = &hash[..32];
        if !ids.insert(id.to_owned()) {
            return Err(InvalidResponse);
        }
        let mut windows = Vec::new();
        if let Some(remaining) = bucket.get("remainingFraction") {
            windows.push(json!({"id":"fraction", "label":"该模型额度比例", "unit":"percent",
                "usedPercent":(1.0 - fraction(remaining)?) * 100.0, "resetsAt":bucket["resetTime"]}));
        }
        if let Some(remaining) = bucket.get("remainingAmount") {
            amount(remaining).ok_or(InvalidResponse)?;
            let unit = match token_type {
                "REQUESTS" => "requests",
                "TOKENS" => "tokens",
                _ => "unknown",
            };
            windows.push(
                json!({"id":"amount", "label":"同一约束余量 · 不与比例相加", "unit":unit,
                "remaining":remaining, "resetsAt":bucket["resetTime"]}),
            );
        }
        let mut resource = pool(
            id,
            &format!("{model} · {token_type}"),
            "project",
            windows,
            vec![],
        );
        resource["modelIds"] = json!([model]);
        pools.push(resource);
    }
    Ok(Draft::new(pools, false))
}
