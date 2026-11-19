use super::{
    epoch_date, fraction, is_number, list, percent, pool, string_or, truthy, AdapterError, Draft,
    InvalidResponse, Parsed,
};
use crate::resource_contract::{amount, instant};
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub(super) fn claude(raw: &Value) -> Parsed<'_> {
    let mut pools = Vec::new();
    for (id, label, duration) in [
        ("five_hour", "5 小时订阅窗口", 300),
        ("seven_day", "7 天订阅窗口", 10080),
        ("seven_day_sonnet", "Sonnet 周窗口", 10080),
        ("seven_day_opus", "Opus 周窗口", 10080),
        ("seven_day_routines", "Routines 周窗口", 10080),
    ] {
        let meter = &raw[id];
        if !meter.is_null() {
            let window = json!({"id":"window", "unit":"percent", "durationMins":duration,
                "usedPercent":percent(&meter["utilization"])?, "resetsAt":meter["resets_at"]});
            pools.push(pool(id, label, "account", vec![window], vec![]));
        }
    }
    Ok(Draft::new(pools, true))
}

pub(super) fn deepseek_api(raw: &Value) -> Parsed<'_> {
    let available = raw["is_available"].as_bool().ok_or(InvalidResponse)?;
    let entries = list(&raw["balance_infos"], 10)?;
    if entries.is_empty() {
        return Err(InvalidResponse);
    }
    let availability = if available {
        "available"
    } else {
        "unavailable"
    };
    let mut pools = Vec::new();
    let mut currencies = BTreeSet::new();
    for entry in entries {
        let currency = supported_currency(&entry["currency"])?;
        if !currencies.insert(currency) || amount(&entry["total_balance"]).is_none() {
            return Err(InvalidResponse);
        }
        let mut balances = Vec::new();
        for (id, label, key, kind) in [
            ("total", "总可用余额", "total_balance", "unknown"),
            (
                "granted",
                "未到期赠送余额（总额组成）",
                "granted_balance",
                "promotional",
            ),
            (
                "topup",
                "充值余额（总额组成）",
                "topped_up_balance",
                "purchased",
            ),
        ] {
            if let Some(value) = entry.get(key) {
                amount(value).ok_or(InvalidResponse)?;
                balances.push(
                    json!({"id":id, "label":label, "kind":kind, "unit":"currency",
                    "currency":currency, "remaining":value, "availability":availability}),
                );
            }
        }
        pools.push(pool(
            currency,
            &format!("{currency} · 总额与组成不可相加"),
            "account",
            vec![],
            balances,
        ));
    }
    Ok(Draft::new(pools, false))
}

fn supported_currency(value: &Value) -> Result<&str, AdapterError> {
    value
        .as_str()
        .filter(|currency| matches!(*currency, "CNY" | "USD"))
        .ok_or(InvalidResponse)
}

pub(super) fn deepseek_web(raw: &Value) -> Parsed<'_> {
    let data = &raw["data"];
    if !is_number(&raw["code"], 0.0) || !is_number(&data["biz_code"], 0.0) {
        return Err(InvalidResponse);
    }
    let mut pools = Vec::new();
    for (field, kind, label) in [
        ("normal_wallets", "purchased", "充值钱包"),
        ("bonus_wallets", "promotional", "赠送钱包"),
    ] {
        for (index, wallet) in list(&data["biz_data"][field], 100)?.iter().enumerate() {
            let currency = supported_currency(&wallet["currency"])?;
            amount(&wallet["balance"]).ok_or(InvalidResponse)?;
            let balance = json!({"id":"balance", "kind":kind, "unit":"currency",
                "currency":currency, "remaining":wallet["balance"]});
            pools.push(pool(
                &format!("{field}-{index}"),
                &format!("{label} · {currency}"),
                "account",
                vec![],
                vec![balance],
            ));
        }
    }
    Ok(Draft::new(pools, true))
}

pub(super) fn gemini(raw: &Value) -> Parsed<'_> {
    let viewer = list(raw, 100)?
        .iter()
        .find_map(|item| item["data"].get("viewer"))
        .ok_or(InvalidResponse)?;
    if viewer.is_null() {
        return Err(AdapterError::AuthRequired);
    }
    let meters = list(&viewer["rpcs"]["getUsageInfo"]["pools"], 100)?;
    let mut pools = Vec::new();
    for (id, duration, label) in [
        ("GXU_FIVE_HOURLY", 300, "Gemini app · 5 小时"),
        ("GXU_WEEKLY", 10080, "Gemini app · 每周"),
    ] {
        if let Some(meter) = meters.iter().find(|item| item["poolType"] == id) {
            let window = json!({"id":"window", "unit":"percent", "durationMins":duration,
                "usedPercent":fraction(&meter["percentageUsed"])? * 100.0,
                "resetsAt":meter["gxu"]["windowRefreshesAt"]});
            pools.push(pool(id, label, "account", vec![window], vec![]));
        }
    }
    Ok(Draft::new(pools, true))
}

pub(super) fn zai(raw: &Value) -> Parsed<'_> {
    let code = &raw["code"];
    if raw["success"] == false
        || (raw.get("code").is_some() && !(is_number(code, 200.0) || is_number(code, 0.0)))
    {
        return Err(InvalidResponse);
    }
    let mut pools = Vec::new();
    let mut incomplete = false;
    for (index, meter) in list(&raw["data"]["limits"], 100)?.iter().enumerate() {
        if !meter.is_object() {
            return Err(InvalidResponse);
        }
        let Some(kind @ ("TOKENS_LIMIT" | "CREDIT_LIMIT" | "TIME_LIMIT")) = meter["type"].as_str()
        else {
            incomplete = true;
            continue;
        };
        let window = json!({"id":"window", "label":kind, "unit":"percent",
            "usedPercent":percent(&meter["percentage"])?,
            "resetsAt":meter["nextResetTime"].as_f64().and_then(epoch_date)});
        pools.push(pool(
            &format!("limit-{index}"),
            kind,
            "account",
            vec![window],
            vec![],
        ));
    }
    Ok(Draft {
        plan: raw["data"].get("planName"),
        ..Draft::new(pools, incomplete)
    })
}

pub(super) fn zcode(raw: &Value) -> Parsed<'_> {
    check_auth_code(&raw["code"])?;
    let mut pools = Vec::new();
    for (index, bucket) in list(&raw["data"]["balances"], 100)?.iter().enumerate() {
        if !bucket.is_object() {
            return Err(InvalidResponse);
        }
        optional_amounts(
            bucket,
            &[
                "total_units",
                "used_units",
                "remaining_units",
                "available_units",
            ],
        )?;
        let unit = if bucket["unit_type"] == "token" {
            "tokens"
        } else {
            "unknown"
        };
        let expires_at = bucket["expires_at"]
            .as_f64()
            .and_then(|wire| epoch_date(if wire > 1e12 { wire } else { wire * 1000.0 }));
        let mut balances = vec![json!({"id":"book", "label":"账面额度（与可用额度不相加）",
            "unit":unit, "total":bucket["total_units"], "used":bucket["used_units"],
            "remaining":bucket["remaining_units"], "expiresAt":expires_at})];
        if !bucket["available_units"].is_null() {
            balances.push(
                json!({"id":"available", "label":"可用额度（同一资源包）", "unit":unit,
                "remaining":bucket["available_units"], "expiresAt":expires_at}),
            );
        }
        let label = format!("ZCode 额度桶 {}", index + 1);
        pools.push(pool(
            &format!("bucket-{index}"),
            string_or(&bucket["show_name"], &label),
            "account",
            vec![],
            balances,
        ));
    }
    Ok(Draft::new(pools, true))
}

pub(super) fn workbuddy_credit(raw: &Value) -> Parsed<'_> {
    amount(&raw["total_capacity_size"]).ok_or(InvalidResponse)?;
    amount(&raw["total_capacity_used"]).ok_or(InvalidResponse)?;
    let balance = json!({"id":"credits", "label":"当前周期积分", "unit":"credits",
        "total":raw["total_capacity_size"], "used":raw["total_capacity_used"],
        "remainingMode":"total-minus-used"});
    Ok(Draft::new(
        vec![pool(
            "personal-aggregate",
            "有效与用尽资源包聚合 · 不含逐包有效期",
            "account",
            vec![],
            vec![balance],
        )],
        false,
    ))
}

pub(super) fn workbuddy_desktop(raw: &Value, complete: bool) -> Parsed<'_> {
    check_auth_code(&raw["code"])?;
    let response = &raw["data"]["Response"];
    if truthy(&response["Error"]) {
        return Err(InvalidResponse);
    }
    let mut pools = Vec::new();
    for (index, item) in list(&response["Data"]["Accounts"], 1000)?
        .iter()
        .enumerate()
    {
        let capacity_type = item["CapacityType"]
            .as_f64()
            .filter(|num| *num >= 0.0 && num.fract() == 0.0)
            .ok_or(InvalidResponse)?;
        let monthly = capacity_type == 4.0;
        let (total, remaining, label) = if monthly {
            ("CycleCapacitySize", "CycleCapacityRemain", "周期积分")
        } else {
            ("CapacitySize", "CapacityRemain", "积分包")
        };
        optional_amounts(item, &[total, remaining])?;
        let ends = if !monthly && truthy(&item["ExpiredTime"]) {
            &item["ExpiredTime"]
        } else {
            &item["CycleEndTime"]
        };
        let mut credits = json!({"id":"credits", "label":label, "unit":"credits",
            "total":item[total], "remaining":item[remaining]});
        credits[if monthly { "resetsAt" } else { "expiresAt" }] = json!(package_time(ends));
        let (windows, balances) = if monthly {
            (vec![credits], vec![])
        } else {
            (vec![], vec![credits])
        };
        let label = format!("客户端资源包 {}", index + 1);
        pools.push(pool(
            &format!("package-{index}"),
            string_or(&item["PackageName"], &label),
            "account",
            windows,
            balances,
        ));
    }
    Ok(Draft::new(pools, !complete))
}

fn package_time(value: &Value) -> Option<String> {
    let time = value.as_str()?;
    let separators = [(4, b'-'), (7, b'-'), (10, b' '), (13, b':'), (16, b':')];
    if time.len() == 19
        && time.bytes().enumerate().all(|(index, byte)| {
            separators
                .iter()
                .find(|(i, _)| *i == index)
                .map_or_else(|| byte.is_ascii_digit(), |(_, mark)| byte == *mark)
        })
    {
        return Some(format!("{}T{}+08:00", &time[..10], &time[11..]));
    }
    instant(value).map(|_| time.to_owned())
}

pub(super) fn workbuddy_web(raw: &Value) -> Parsed<'_> {
    if !is_number(&raw["code"], 0.0) {
        return Err(InvalidResponse);
    }
    let mut pools = Vec::new();
    for (index, item) in list(&raw["data"]["Packages"], 100)?.iter().enumerate() {
        if item["CapacityUnit"] != "credits" {
            return Err(InvalidResponse);
        }
        amount(&item["CycleTotalCapacity"]).ok_or(InvalidResponse)?;
        amount(&item["CycleRemainCapacity"]).ok_or(InvalidResponse)?;
        optional_amounts(item, &["CycleFrozenCapacity"])?;
        let mut balances = vec![json!({"id":"credits", "label":"周期积分 · 冻结部分单列",
            "unit":"credits", "total":item["CycleTotalCapacity"], "remaining":item["CycleRemainCapacity"]})];
        if !item["CycleFrozenCapacity"].is_null() {
            balances.push(
                json!({"id":"frozen", "label":"冻结积分（与余量不可相加）", "unit":"credits",
                "remaining":item["CycleFrozenCapacity"], "availability":"unavailable"}),
            );
        }
        let label = format!("资源包 {}", index + 1);
        pools.push(pool(
            &format!("package-{index}"),
            string_or(&item["SubscriptionPackageName"], &label),
            "account",
            vec![],
            balances,
        ));
    }
    Ok(Draft::new(pools, true))
}

pub(super) fn mimo(raw: &Value) -> Parsed<'_> {
    let balance = &raw["balance"];
    let plan = &raw["plan"];
    let usage = &raw["usage"];
    if [balance, plan, usage]
        .iter()
        .any(|part| is_number(&part["code"], 401.0))
    {
        return Err(AdapterError::AuthRequired);
    }
    check_auth_code(&balance["code"])?;
    let money = &balance["data"];
    let currency = money["currency"]
        .as_str()
        .filter(|currency| {
            currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_uppercase())
        })
        .ok_or(InvalidResponse)?;
    amount(&money["balance"]).ok_or(InvalidResponse)?;
    let mut balances = Vec::new();
    for (id, label, key, kind) in [
        ("total", "总余额", "balance", "unknown"),
        (
            "cash",
            "付费组成（包含在总额中）",
            "cashBalance",
            "purchased",
        ),
        (
            "gift",
            "赠送组成（包含在总额中）",
            "giftBalance",
            "promotional",
        ),
    ] {
        let value = &money[key];
        if !value.is_null() {
            amount(value).ok_or(InvalidResponse)?;
            balances.push(
                json!({"id":id, "label":label, "kind":kind, "unit":"currency",
                "currency":currency, "remaining":value}),
            );
        }
    }
    let mut pools = vec![pool(
        "api-money",
        "普通 API 余额 · 总额与组成不相加",
        "account",
        vec![],
        balances,
    )];
    let detail = is_number(&plan["code"], 0.0)
        .then_some(&plan["data"])
        .filter(|data| data.is_object());
    let valid_until = detail.and_then(|data| data.get("currentPeriodEnd"));
    let expire = detail.is_some_and(|data| data["expired"] == true);
    let mut windows = Vec::new();
    if is_number(&usage["code"], 0.0) {
        let items = &usage["data"]["monthUsage"]["items"];
        if items.is_array() {
            for (index, item) in list(items, 100)?.iter().enumerate() {
                amount(&item["limit"]).ok_or(InvalidResponse)?;
                amount(&item["used"]).ok_or(InvalidResponse)?;
                windows.push(json!({"id":format!("credits-{index}"),
                    "label":string_or(&item["name"], "Token Plan Credits"), "unit":"credits",
                    "total":item["limit"], "used":item["used"], "remainingMode":"total-minus-used",
                    "requiresEntitlement":true, "resetsAt":valid_until}));
            }
        }
    }
    let incomplete = detail.is_none() || windows.is_empty();
    if !windows.is_empty() {
        pools.push(pool(
            "token-plan",
            "Token Plan Credits · 与 API 金额独立",
            "account",
            windows,
            vec![],
        ));
    }
    Ok(Draft {
        plan: detail.and_then(|data| data.get("planCode")),
        valid_until,
        entitlement_state: if expire { "expired" } else { "unknown" },
        ..Draft::new(pools, incomplete)
    })
}

fn optional_amounts(raw: &Value, fields: &[&str]) -> Result<(), AdapterError> {
    for field in fields {
        let value = &raw[*field];
        if !value.is_null() {
            amount(value).ok_or(InvalidResponse)?;
        }
    }
    Ok(())
}

fn check_auth_code(value: &Value) -> Result<(), AdapterError> {
    match value.as_f64() {
        Some(0.0) => Ok(()),
        Some(401.0) => Err(AdapterError::AuthRequired),
        Some(403.0) => Err(AdapterError::AccessDenied),
        _ => Err(InvalidResponse),
    }
}
