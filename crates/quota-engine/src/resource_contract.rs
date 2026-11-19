use serde_json::{json, Value};
use std::collections::BTreeSet;
use usage_engine::{
    agent_catalog::is_builtin,
    amount::{amount_number, amount_str, subtract},
    time::{civil_from_days, iso_from_ms, parse_iso},
};

const UNITS: &[&str] = &[
    "percent", "credits", "currency", "tokens", "requests", "unknown",
];
const AVAILABILITY: &[&str] = &[
    "unknown",
    "available",
    "unavailable",
    "disabled",
    "unlimited",
];
const ISSUES: &[&str] = &[
    "UNKNOWN_UNIT",
    "MISSING_CURRENCY",
    "INVALID_AMOUNT",
    "INVALID_PERCENT",
    "INVALID_TIME",
    "INVALID_DURATION",
    "AMOUNT_CONFLICT",
    "INVALID_INTERVAL",
];

pub(crate) fn amount(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        amount_str(text)
    } else {
        value.as_f64().and_then(amount_number)
    }
}

fn choose<'a>(value: &'a Value, allowed: &[&str], default: &'a str) -> &'a str {
    value
        .as_str()
        .filter(|choice| allowed.contains(choice))
        .unwrap_or(default)
}

pub(crate) fn text(value: &Value) -> Option<&str> {
    value.as_str().filter(|val| {
        !val.is_empty() && val.encode_utf16().count() <= 160 && !val.bytes().any(|byte| byte < 0x20)
    })
}

pub(crate) fn identifier(value: &Value) -> Option<&str> {
    value.as_str().filter(|id| valid_identifier(id))
}

pub(crate) fn valid_identifier(id: &str) -> bool {
    (1..=100).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.:-".contains(&byte))
}

pub fn instant(value: &Value) -> Option<String> {
    let value = value.as_str()?;
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes.get(10) != Some(&b'T') {
        return None;
    }
    let mut at = 19;
    if bytes.get(at) == Some(&b'.') {
        at += 1;
        let start = at;
        while bytes.get(at).is_some_and(u8::is_ascii_digit) {
            at += 1;
        }
        if !(1..=3).contains(&(at - start)) {
            return None;
        }
    }
    match bytes.get(at..)? {
        b"Z" => {}
        [b'+' | b'-', h1, h2, b':', m1, m2]
            if [h1, h2, m1, m2].into_iter().all(u8::is_ascii_digit) => {}
        _ => return None,
    }
    let ms = parse_iso(value)?;
    let year: u16 = value.get(..4)?.parse().ok()?;
    let utc_validation_year = if year < 100 { year + 1900 } else { year };
    let month: u8 = value.get(5..7)?.parse().ok()?;
    let day: u8 = value.get(8..10)?.parse().ok()?;
    let max_day = match month {
        2 if utc_validation_year % 4 == 0
            && (utc_validation_year % 100 != 0 || utc_validation_year % 400 == 0) =>
        {
            29
        }
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (day <= max_day).then(|| javascript_iso(ms))
}

pub(crate) fn javascript_iso(ms: i64) -> String {
    let date = iso_from_ms(ms);
    let (year, _, _) = civil_from_days(ms.div_euclid(86_400_000));
    if !(0..=9999).contains(&year) {
        if let Some((_, suffix)) = date.trim_start_matches('-').split_once('-') {
            return format!("{year:+07}-{suffix}");
        }
    }
    date
}

fn nonnegative(raw: &Value) -> Option<f64> {
    raw.as_f64()
        .filter(|number| number.is_finite() && *number >= 0.0)
}

fn time_issues(fields: &[&str], raw: &Value, issues: &mut BTreeSet<&'static str>) {
    if fields
        .iter()
        .any(|field| !raw[*field].is_null() && instant(&raw[*field]).is_none())
    {
        issues.insert("INVALID_TIME");
    }
}

fn item(raw: &Value, fetched_at: Option<&str>, window: bool) -> Value {
    let mut issues: BTreeSet<&'static str> = raw["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|issue| {
            let issue = issue.as_str()?;
            ISSUES.iter().copied().find(|known| *known == issue)
        })
        .collect();
    let unit = choose(&raw["unit"], UNITS, "unknown");
    if unit == "unknown" {
        issues.insert("UNKNOWN_UNIT");
    }
    let currency = raw["currency"]
        .as_str()
        .filter(|currency| currency.len() == 3 && currency.bytes().all(|c| c.is_ascii_uppercase()));
    if unit == "currency" && currency.is_none() {
        issues.insert("MISSING_CURRENCY");
    }
    let [total, used, mut remaining, reserved] =
        ["total", "used", "remaining", "reserved"].map(|key| {
            let quantity = amount(&raw[key]);
            if !raw[key].is_null() && quantity.is_none() {
                issues.insert("INVALID_AMOUNT");
            }
            quantity
        });
    let mode = choose(
        &raw["remainingMode"],
        &[
            "reported-only",
            "total-minus-used",
            "total-minus-used-minus-reserved",
        ],
        "reported-only",
    );
    let mut source = remaining.as_ref().map(|_| {
        choose(
            &raw["remainingSource"],
            &[
                "reported",
                "total-minus-used",
                "total-minus-used-minus-reserved",
            ],
            "reported",
        )
    });
    // Only an absent value permits a declared derivation. An explicit null is
    // a provider observation whose unavailability must survive projection.
    if raw.get("remaining").is_none()
        && mode != "reported-only"
        && unit != "unknown"
        && (unit != "currency" || currency.is_some())
    {
        if let (Some(total), Some(used)) = (total.as_deref(), used.as_deref()) {
            let parts = [used, reserved.as_deref().unwrap_or_default()];
            if mode == "total-minus-used" || reserved.is_some() {
                remaining = subtract(
                    total,
                    &parts[..if mode == "total-minus-used" { 1 } else { 2 }],
                );
                if remaining.is_some() {
                    source = Some(mode);
                } else {
                    issues.insert("AMOUNT_CONFLICT");
                }
            }
        }
    }
    let used_percent = nonnegative(&raw["usedPercent"]);
    if !raw["usedPercent"].is_null() && used_percent.is_none() {
        issues.insert("INVALID_PERCENT");
    }
    let observed_at = if let Some(value) = raw.get("observedAt") {
        instant(value)
    } else {
        fetched_at.map(str::to_owned)
    };
    let duration = nonnegative(&raw["durationMins"]).filter(|value| *value > 0.0);
    let valid_from = instant(&raw["validFrom"]);
    let expires_at = instant(&raw["expiresAt"]);
    if window {
        time_issues(&["observedAt", "resetsAt"], raw, &mut issues);
        if !raw["durationMins"].is_null() && duration.is_none() {
            issues.insert("INVALID_DURATION");
        }
    } else {
        time_issues(&["observedAt", "validFrom", "expiresAt"], raw, &mut issues);
        if valid_from
            .as_ref()
            .zip(expires_at.as_ref())
            .is_some_and(|(from, expiry)| expiry <= from)
        {
            issues.insert("INVALID_INTERVAL");
        }
    }
    let mut out = json!({
        "id":raw["id"], "label":text(&raw["label"]), "unit":unit,
        "currency":if unit == "currency" {currency} else {None},
        "total":total, "used":used, "remaining":remaining, "reserved":reserved,
        "remainingMode":mode, "remainingSource":source, "usedPercent":used_percent,
        "remainingPercent":used_percent.map(|value| (100.0 - value).max(0.0)),
        "availability":choose(&raw["availability"], AVAILABILITY, "unknown"),
        "requiresEntitlement":raw["requiresEntitlement"] == true, "observedAt":observed_at, "issues":issues
    });
    if window {
        out["role"] = json!(choose(
            &raw["role"],
            &["primary", "secondary", "other"],
            "other"
        ));
        out["cadence"] = json!(choose(
            &raw["cadence"],
            &["rolling", "fixed", "calendar", "unknown"],
            "unknown"
        ));
        out["durationMins"] = json!(duration);
        out["resetsAt"] = json!(instant(&raw["resetsAt"]));
    } else {
        out["kind"] = json!(choose(
            &raw["kind"],
            &["subscription", "purchased", "promotional", "unknown"],
            "unknown"
        ));
        out["validFrom"] = json!(valid_from);
        out["expiresAt"] = json!(expires_at);
    }
    out
}

fn valid_list(value: &Value, max: usize) -> Option<&[Value]> {
    let items = value.as_array()?;
    if items.len() > max {
        return None;
    }
    let mut ids = BTreeSet::new();
    items
        .iter()
        .all(|entry| identifier(&entry["id"]).is_some_and(|id| ids.insert(id)))
        .then_some(items)
}

pub fn project_resources(raw: &Value) -> Option<Value> {
    let provider = raw["provider"].as_str()?;
    if raw["schemaVersion"] != "AccountQuotaV2" || !is_builtin(provider) {
        return None;
    }
    let workbuddy = provider == "workbuddy";
    let fetched_at = instant(&raw["fetchedAt"]);
    let mut projected = Vec::new();
    let mut count = 0;
    for pool in valid_list(&raw["pools"], if workbuddy { 1000 } else { 100 })? {
        let windows = valid_list(&pool["windows"], 200)?;
        let balances = valid_list(&pool["balances"], 200)?;
        count += windows.len() + balances.len();
        if count > if workbuddy { 2000 } else { 200 } {
            return None;
        }
        let models = if let Some(value) = pool.get("modelIds") {
            let array = value.as_array().filter(|array| array.len() <= 100)?;
            array
                .iter()
                .map(identifier)
                .collect::<Option<BTreeSet<_>>>()?
        } else {
            BTreeSet::new()
        };
        let windows: Vec<_> = windows
            .iter()
            .map(|raw| item(raw, fetched_at.as_deref(), true))
            .collect();
        let balances: Vec<_> = balances
            .iter()
            .map(|raw| item(raw, fetched_at.as_deref(), false))
            .collect();
        projected.push(json!({"id":pool["id"], "label":text(&pool["label"]),
            "scope":choose(&pool["scope"], &["account", "workspace", "project", "unknown"], "unknown"),
            "modelIds":models, "windows":windows, "balances":balances}));
    }
    let entitlement = &raw["entitlement"];
    let provenance = &raw["provenance"];
    let mut issues = BTreeSet::new();
    if entitlement["issues"]
        .as_array()
        .is_some_and(|issues| issues.iter().any(|issue| issue == "INVALID_TIME"))
    {
        issues.insert("INVALID_TIME");
    }
    time_issues(
        &["observedAt", "validUntil", "cancelAt"],
        entitlement,
        &mut issues,
    );
    let reset_credits = nonnegative(&raw["resetCredits"])
        .filter(|v| v.fract() == 0.0 && *v <= 9_007_199_254_740_991.0);
    Some(
        json!({"schemaVersion":"AccountQuotaV2", "provider":provider, "fetchedAt":fetched_at,
            "incomplete":raw["incomplete"] == true,
            "provenance":{"kind":choose(&provenance["kind"], &["official-cli","official-api","undocumented-api","passive","legacy-cache","synthetic","unknown"], "unknown"),
                "version":text(&provenance["version"])},
            "entitlement":{"plan":text(&entitlement["plan"]), "state":choose(&entitlement["state"], &["active","trial","grace","expired","unknown"], "unknown"),
                "observedAt":instant(&entitlement["observedAt"]), "validUntil":instant(&entitlement["validUntil"]),
                "cancelAt":instant(&entitlement["cancelAt"]), "issues":issues},
            "pools":projected, "resetCredits":reset_credits
        }),
    )
}
