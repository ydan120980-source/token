use crate::connection_state::FRESH_MS;
use serde::Serialize;
use serde_json::{json, Value};
use usage_engine::{amount::compare, normalize::truthy, time::parse_iso};

const CLOCK_SKEW_MS: i64 = 60_000;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum State {
    Fresh,
    Stale,
    Cached,
    Missing,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Freshness {
    state: State,
    reason: Option<&'static str>,
}

impl Freshness {
    fn set(&mut self, state: State, reason: &'static str) {
        if self.state != State::Missing {
            *self = Self {
                state,
                reason: Some(reason),
            };
        }
    }
}

pub(crate) fn date_millis(value: &Value) -> Option<i64> {
    let date = value.as_str()?;
    if matches!(date.as_bytes().first(), Some(b'+' | b'-')) {
        let year: i64 = date.get(..7)?.parse().ok()?;
        // The normalized wire format uses a signed six-digit year outside
        // 0000..9999. Gregorian leap dates repeat every 400 years.
        let representative = 2000 + year.rem_euclid(400);
        let base = parse_iso(&format!("{representative}{}", date.get(7..)?))?;
        return Some(base + (year - representative) / 400 * 146_097 * 86_400_000);
    }
    parse_iso(date)
}

fn observation(observed_at: &Value, account: &Value, now: i64) -> Freshness {
    let observed =
        date_millis(observed_at).filter(|time| *time <= now.saturating_add(CLOCK_SKEW_MS));
    let (state, reason) = match observed {
        None => (State::Missing, Some("invalid-time")),
        Some(time) if now.saturating_sub(time) > FRESH_MS => (State::Stale, Some("age")),
        Some(_)
            if account["status"] != "ready"
                || truthy(&account["errorCode"])
                || truthy(&account["busy"]) =>
        {
            (State::Cached, Some("verification-required"))
        }
        Some(_) => (State::Fresh, None),
    };
    Freshness { state, reason }
}

fn has_issues(value: &Value) -> bool {
    value["issues"]
        .as_array()
        .is_some_and(|issues| !issues.is_empty())
}

fn interval_known(item: &Value) -> bool {
    !item["issues"]
        .as_array()
        .is_some_and(|issues| issues.iter().any(|issue| issue == "INVALID_INTERVAL"))
}

fn meter_state(item: &Value) -> &'static str {
    match item["availability"].as_str() {
        Some("disabled") => return "disabled",
        Some("unlimited") => return "unlimited",
        Some("unavailable") => return "unavailable",
        _ => {}
    }
    if !interval_known(item)
        || item["unit"] == "unknown"
        || (item["unit"] == "currency" && item["currency"].is_null())
    {
        return "unknown";
    }
    if let Some(remaining) = item["remaining"].as_str() {
        if compare(remaining, "0") == Some(0) {
            return "exhausted";
        }
    } else if item["unit"] == "percent" {
        if let Some(used) = item["usedPercent"].as_f64() {
            return if used >= 100.0 {
                "exhausted"
            } else {
                "available"
            };
        }
    }
    if item["availability"] == "available" {
        "available"
    } else {
        "unknown"
    }
}

fn classify(
    item: &mut Value,
    window: bool,
    account: &Value,
    entitlement: &Value,
    now: i64,
) -> State {
    let mut state = meter_state(item);
    let mut freshness = observation(&item["observedAt"], account, now);
    let interval_known = !window && interval_known(item);
    let expired = interval_known && date_millis(&item["expiresAt"]).is_some_and(|time| time <= now);
    let not_yet_valid =
        interval_known && date_millis(&item["validFrom"]).is_some_and(|time| time > now);
    let requires_entitlement = item["requiresEntitlement"] == true;
    if expired {
        state = "expired";
    } else if not_yet_valid {
        state = "not-yet-valid";
    } else if requires_entitlement && entitlement["state"] == "expired" {
        state = "unavailable";
    }
    if window && date_millis(&item["resetsAt"]).is_some_and(|time| time <= now) {
        freshness.set(State::Stale, "reset-passed");
    }
    if requires_entitlement && entitlement["verificationRequired"] == true {
        freshness.set(State::Stale, "entitlement-ended");
    }
    if requires_entitlement && has_issues(entitlement) {
        freshness.set(State::Cached, "entitlement-invalid");
    }
    let fresh = freshness.state == State::Fresh;
    let usable = match state {
        "available" | "unlimited" if fresh && !has_issues(item) => Some(true),
        "expired" | "not-yet-valid" | "disabled" | "unavailable" | "exhausted"
            if fresh || expired || not_yet_valid =>
        {
            Some(false)
        }
        _ => None,
    };
    let freshness_state = freshness.state;
    item["state"] = json!(state);
    item["freshness"] = json!(freshness);
    item["currentlyUsable"] = json!(usable);
    freshness_state
}

/// Annotate a resource observation from `project_resources` with its current view.
/// The caller retains the underlying observation for cache writes and rechecks.
pub fn resource_view(mut resources: Value, account: &Value, now: i64) -> Value {
    let Some(resources) = resources.as_object_mut() else {
        return Value::Null;
    };
    let Some(entitlement) = resources
        .get_mut("entitlement")
        .filter(|value| value.is_object())
    else {
        return Value::Null;
    };
    let mut entitlement = std::mem::take(entitlement);
    let verification_required = entitlement["state"] != "expired"
        && date_millis(&entitlement["validUntil"]).is_some_and(|time| time <= now);
    let mut freshness = observation(&entitlement["observedAt"], account, now);
    if verification_required {
        freshness.set(State::Stale, "entitlement-ended");
    }
    entitlement["verificationRequired"] = json!(verification_required);
    entitlement["freshness"] = json!(freshness);
    let entitlements_have_issues = has_issues(&entitlement);
    let mut totals = [0; 4];
    let mut measurements = false;
    let mut partial =
        resources.get("incomplete") == Some(&Value::Bool(true)) || entitlements_have_issues;
    if let Some(pools) = resources.get_mut("pools").and_then(Value::as_array_mut) {
        for pool in pools {
            for key in ["windows", "balances"] {
                for item in pool
                    .get_mut(key)
                    .and_then(Value::as_array_mut)
                    .into_iter()
                    .flatten()
                {
                    if !item.is_object() {
                        return Value::Null;
                    }
                    let state = classify(item, key == "windows", account, &entitlement, now);
                    totals[match state {
                        State::Fresh => 0,
                        State::Stale => 1,
                        State::Cached => 2,
                        State::Missing => 3,
                    }] += 1;
                    partial |= has_issues(item) || item["state"] == "unknown";
                    measurements |= ["usedPercent", "remaining", "total", "used"]
                        .iter()
                        .any(|key| !item[*key].is_null())
                        || item["availability"] != "unknown";
                }
            }
        }
    }
    resources.insert("entitlement".to_owned(), entitlement);
    resources.insert(
        "coverage".to_owned(),
        json!({
            "fresh":totals[0], "stale":totals[1], "cached":totals[2], "missing":totals[3],
        }),
    );
    resources.insert("partial".to_owned(), json!(partial || totals == [0; 4]));
    resources.insert("hasMeasurements".to_owned(), json!(measurements));
    Value::Object(std::mem::take(resources))
}
