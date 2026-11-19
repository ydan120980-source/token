pub use crate::cost_table::PARTS;
use crate::{
    cost_table::{
        counts_add_range, descending, known, number, ranked, ratio, spread_reasons, text, CostSum,
    },
    pricing_labels,
    store::Store,
};
use chrono::{Datelike, Days, NaiveDate};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostTotal {
    pub lower: Option<f64>,
    pub upper: Option<f64>,
    pub tokens: f64,
    pub priced_tokens: f64,
    pub coverage: Option<f64>,
    pub usage_days: usize,
}

/// Estimate bounds and usage coverage; missing prices do not contribute zero estimates.
pub fn total<'a>(rows: impl IntoIterator<Item = &'a Value>) -> CostTotal {
    let mut sum = CostSum::default();
    let mut dates = HashSet::new();
    for row in rows {
        sum.add(row);
        if number(&row["totalTokens"]) > 0.0 {
            dates.insert(text(&row["date"]));
        }
    }
    CostTotal {
        lower: sum.lower,
        upper: sum.upper,
        tokens: sum.tokens,
        priced_tokens: sum.priced_tokens,
        coverage: sum.coverage(),
        usage_days: dates.len(),
    }
}

pub(crate) fn date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

/// Shift a calendar date by UTC days; invalid or out-of-range dates return `None`.
pub fn shift(value: &str, days: i64) -> Option<String> {
    let value = date(value)?;
    let days_abs = Days::new(days.unsigned_abs());
    let shifted = if days < 0 {
        value.checked_sub_days(days_abs)
    } else {
        value.checked_add_days(days_abs)
    }?;
    Some(shifted.format("%Y-%m-%d").to_string())
}

fn end_of_month(value: NaiveDate) -> Option<NaiveDate> {
    value
        .with_day(1)?
        .checked_add_months(chrono::Months::new(1))?
        .pred_opt()
}

/// Return the final UTC calendar day of the given date's month.
pub fn month_end(value: &str) -> Option<String> {
    Some(end_of_month(date(value)?)?.format("%Y-%m-%d").to_string())
}

fn within<'a>(
    rows: impl IntoIterator<Item = &'a Value>,
    from: &'a str,
    to: &'a str,
) -> impl Iterator<Item = &'a Value> {
    rows.into_iter().filter(move |row| {
        let date = text(&row["date"]);
        date >= from && date <= to
    })
}

/// Monthly estimates newest first, with like-for-like comparisons only when the prior span is covered.
pub fn months(
    rows: &[Value],
    today: &str,
    coverage_start: Option<&str>,
    minimum_days: i64,
) -> Vec<Value> {
    let Some(today_date) = date(today) else {
        return Vec::new();
    };
    let first = coverage_start
        .filter(|start| !start.is_empty())
        .or_else(|| rows.iter().map(|row| text(&row["date"])).min())
        .unwrap_or(today);
    let Some(first_date) = date(first) else {
        return Vec::new();
    };
    let mut by_month = BTreeMap::<&str, Vec<&Value>>::new();
    for row in rows {
        if let Some(month) = text(&row["date"]).get(..7) {
            by_month.entry(month).or_default().push(row);
        }
    }
    let for_month = |month: &str, from: &str, to: &str| {
        total(within(
            by_month.get(month).into_iter().flatten().copied(),
            from,
            to,
        ))
    };
    let mut output = Vec::new();
    let Some(first_month) = first_date.with_day(1) else {
        return output;
    };
    let Some(mut start) = today_date.with_day(1) else {
        return output;
    };
    while start >= first_month {
        let Some(end) = end_of_month(start) else {
            break;
        };
        let from = start.max(first_date);
        let to = end.min(today_date);
        let current = end >= today_date;
        let started = from == start;
        let month = start.format("%Y-%m").to_string();
        let from_label = from.format("%Y-%m-%d").to_string();
        let to_label = to.format("%Y-%m-%d").to_string();
        let sum = for_month(&month, &from_label, &to_label);
        let before = start.checked_sub_months(chrono::Months::new(1));
        let delta = before
            .filter(|&before| started && before >= first_date)
            .and_then(|before| {
                let lower = sum.lower?;
                let before_end = end_of_month(before)?;
                let before_to = if current {
                    before
                        .checked_add_days(Days::new((today_date - start).num_days() as u64))?
                        .min(before_end)
                } else {
                    before_end
                };
                let previous = for_month(
                    &before.format("%Y-%m").to_string(),
                    &before.format("%Y-%m-%d").to_string(),
                    &before_to.format("%Y-%m-%d").to_string(),
                );
                let previous = previous.lower?;
                ratio(lower - previous, previous)
            });
        let elapsed = (to - from).num_days() + 1;
        let remaining = (end - today_date).num_days().max(0);
        let projection = sum.lower.zip(sum.upper).filter(|_| current && remaining > 0 && elapsed >= minimum_days && sum.usage_days > 0)
            .map(|(lower, upper)| {
                let used = sum.usage_days as f64;
                let expected = remaining as f64 * used / elapsed as f64;
                json!({"lower": lower + lower / used * expected, "upper": upper + upper / used * expected, "elapsed": elapsed, "remaining": remaining, "usageDays": sum.usage_days})
            });
        output.push(json!({"month": month, "from": from_label, "to": to_label, "current": current, "started": started,
            "lower": sum.lower, "upper": sum.upper, "tokens": sum.tokens, "pricedTokens": sum.priced_tokens,
            "coverage": sum.coverage, "usageDays": sum.usage_days, "delta": delta,
            "deltaKind": delta.map(|_| if current { "same-days" } else { "month" }), "projection": projection}));
        let Some(before) = before else {
            break;
        };
        start = before;
    }
    output
}

/// Allocate chart cells by largest remainder, breaking ties by input order.
pub fn waffle(fractions: &[Option<f64>], cells: usize) -> Vec<usize> {
    let raw: Vec<_> = fractions
        .iter()
        .map(|fraction| {
            fraction
                .filter(|value| value.is_finite() && *value > 0.0)
                .unwrap_or_default()
                * cells as f64
        })
        .collect();
    let sum = raw.iter().copied().sum::<f64>();
    if sum == 0.0 {
        return vec![0; raw.len()];
    }
    let scaled: Vec<_> = raw
        .into_iter()
        .map(|value| value / sum * cells as f64)
        .collect();
    let mut base: Vec<_> = scaled.iter().map(|value| value.floor() as usize).collect();
    let left = cells.saturating_sub(base.iter().copied().fold(0usize, usize::saturating_add));
    let mut remainders: Vec<_> = scaled
        .into_iter()
        .zip(&base)
        .enumerate()
        .map(|(index, (value, &whole))| (index, value - whole as f64))
        .collect();
    remainders.sort_by(|left, right| descending(left.1, right.1));
    for (index, _) in remainders.into_iter().take(left) {
        base[index] += 1;
    }
    base
}

/// Split cost into parts. Per-part token and rate estimates use fully priced, fully reported rows only.
pub fn composition(rows: &[Value], bucket: &str, from: Option<&str>) -> Value {
    let sum = total(rows);
    let mut cost = [0.0; PARTS.len()];
    let mut full_tokens = [0.0; PARTS.len()];
    let mut full_cost = [0.0; PARTS.len()];
    let mut counts = IndexMap::new();
    let mut buckets = BTreeMap::<_, [f64; PARTS.len()]>::new();
    let origin = from
        .filter(|origin| !origin.is_empty())
        .or_else(|| rows.iter().map(|row| text(&row["date"])).min());
    let origin_date = origin.and_then(date);
    let mut bucket_dates = IndexMap::new();
    for row in rows {
        let Some(parts) = row["costParts"].as_object() else {
            continue;
        };
        let day = text(&row["date"]);
        let key = bucket_dates.entry(day).or_insert_with(|| {
            if bucket != "day" {
                if let (Some(origin), Some(origin_date), Some(day)) =
                    (origin, origin_date, date(day))
                {
                    if let Some(bucket) =
                        shift(origin, (day - origin_date).num_days().div_euclid(7) * 7)
                    {
                        return bucket;
                    }
                }
            }
            day.to_owned()
        });
        let slot = buckets.entry(key.as_str().to_owned()).or_default();
        let covered = known(&row["pricedTokens"]) == known(&row["totalTokens"])
            && PARTS.iter().all(|part| known(&row[*part]).is_some());
        for (index, name) in PARTS.into_iter().enumerate() {
            let amount = parts.get(name).map(number).unwrap_or_default();
            cost[index] += amount;
            slot[index] += amount;
            if covered {
                full_tokens[index] += number(&row[name]);
                full_cost[index] += amount;
            }
        }
        counts_add_range(&mut counts, row);
    }
    let full = full_tokens.iter().sum::<f64>();
    let labels = pricing_labels::reasons();
    let parts: Vec<_> = PARTS.into_iter().enumerate().map(|(index, part)| {
        let series: Vec<_> = buckets.iter().map(|(date, slot)| json!({"date": date, "cost": slot[index]})).collect();
        json!({"key": part, "cost": sum.lower.map(|_| cost[index]), "share": sum.lower.and_then(|lower| ratio(cost[index], lower)),
            "tokens": (full != 0.0).then_some(full_tokens[index]), "tokenShare": ratio(full_tokens[index], full),
            "perMillion": (full_tokens[index] > 0.0).then(|| full_cost[index] / full_tokens[index] * 1e6), "series": series})
    }).collect();
    json!({"lower": sum.lower, "upper": sum.upper, "spread": sum.lower.zip(sum.upper).map(|(lower, upper)| upper - lower),
        "tokens": sum.tokens, "pricedTokens": sum.priced_tokens, "coverage": sum.coverage, "fullTokens": full,
        "reasons": spread_reasons(counts, &labels), "parts": parts, "buckets": buckets.into_keys().collect::<Vec<_>>()})
}

/// Compare the app's local estimates with fees entered by the user, never with provider billing.
pub fn subscriptions(
    rows: &[Value],
    from: Option<&str>,
    to: Option<&str>,
    fees: &Value,
    agents: &[&str],
) -> Vec<Value> {
    let window = from
        .zip(to)
        .filter(|(from, to)| !from.is_empty() && !to.is_empty());
    let mut by_agent: IndexMap<&str, Vec<&Value>> =
        agents.iter().map(|&agent| (agent, Vec::new())).collect();
    for row in rows {
        let day = text(&row["date"]);
        if window.is_none_or(|(from, to)| from <= day && day <= to) {
            by_agent.entry(text(&row["agent"])).or_default().push(row);
        }
    }
    by_agent.into_iter().filter_map(|(agent, rows)| {
        let sum = total(rows);
        let fee = known(&fees[agent]).filter(|fee| *fee > 0.0);
        (sum.tokens > 0.0 || fee.is_some()).then(|| json!({"agent": agent, "lower": sum.lower, "upper": sum.upper,
            "tokens": sum.tokens, "pricedTokens": sum.priced_tokens, "coverage": sum.coverage, "usageDays": sum.usage_days,
            "fee": fee, "ratioLower": fee.zip(sum.lower).map(|(fee, lower)| lower / fee), "ratioUpper": fee.zip(sum.upper).map(|(fee, upper)| upper / fee)}))
    }).collect()
}

#[derive(Default)]
struct CoverageGroup<'a> {
    tokens: f64,
    fixable: bool,
    models: IndexMap<&'a str, f64>,
}

/// Aggregate unpriced tokens and explain the spread across the table's priced items.
pub fn coverage(items: &[Value]) -> Value {
    let mut groups = IndexMap::<&str, CoverageGroup>::new();
    let (mut tokens, mut priced_tokens, mut spread) = (0.0, 0.0, 0.0);
    let mut counts = IndexMap::new();
    let mut ranged = Vec::new();
    for item in items {
        tokens += number(&item["tokens"]);
        priced_tokens += number(&item["pricedTokens"]);
        for gap in item["gaps"].as_array().into_iter().flatten() {
            let code = match (text(&gap["kind"]), text(&gap["code"])) {
                ("cause", _) | (_, "usage-incomplete") => "incomplete",
                (_, code) => code,
            };
            let group = groups.entry(code).or_insert_with(|| CoverageGroup {
                fixable: gap["fixable"].as_bool().unwrap_or_default(),
                ..CoverageGroup::default()
            });
            let amount = number(&gap["tokens"]);
            group.tokens += amount;
            *group.models.entry(text(&item["key"])).or_default() += amount;
        }
        let amount = number(&item["spread"]);
        if amount > 0.0 {
            spread += amount;
            ranged.push(json!({"key": item["key"], "model": item["model"], "spread": amount}));
            for reason in item["spreadReasons"].as_array().into_iter().flatten() {
                *counts.entry(text(&reason["code"])).or_default() += number(&reason["records"]);
            }
        }
    }
    let labels = pricing_labels::reasons();
    let mut gaps: Vec<_> = groups.into_iter().map(|(code, group)| {
        let title = match code {
            "model-unpriced" => "没有价格", "price-unverified" => "价格待核实", "rate-missing" => "缺少部分费率", "incomplete" => "来源没有报告完整",
            _ => labels[code].as_str().unwrap_or(code),
        };
        let mut models: Vec<_> = group.models.into_iter().map(|(key, tokens)| json!({"key": key, "tokens": tokens})).collect();
        models.sort_by(|left, right| ranked(left, right, "tokens", "key"));
        json!({"code": code, "title": title, "tokens": group.tokens, "fixable": group.fixable, "models": models, "share": ratio(group.tokens, tokens)})
    }).collect();
    gaps.sort_by(|left, right| ranked(left, right, "tokens", "code"));
    let range = (spread > 0.0).then(|| {
        ranged.sort_by(|left, right| descending(number(&left["spread"]), number(&right["spread"])));
        json!({"spread": spread, "models": ranged, "reasons": spread_reasons(counts, &labels)})
    });
    json!({"tokens": tokens, "pricedTokens": priced_tokens, "coverage": ratio(priced_tokens, tokens), "unpricedTokens": tokens - priced_tokens, "gaps": gaps, "range": range})
}

/// Cost and cache insights across the supplied model rows, preserving unreported rates and savings.
pub fn cache(items: &[Value]) -> Value {
    let (mut read, mut input, mut savings) = (0.0, 0.0, None);
    let models: Vec<_> = items.iter().map(|item| {
        let reported = !item["hitRate"].is_null();
        if reported { read += number(&item["fields"]["cacheRead"]["value"]); input += number(&item["fields"]["inputUncached"]["value"]); }
        if let Some(saved) = known(&item["savings"]) { *savings.get_or_insert(0.0) += saved; }
        json!({"key": item["key"], "model": item["model"], "tokens": item["tokens"], "users": item["users"],
            "hitRate": item["hitRate"], "savings": item["savings"], "priced": !item["lower"].is_null(), "reported": reported})
    }).collect();
    json!({"hitRate": (read + input > 0.0).then(|| read / (read + input)), "savings": savings, "models": models})
}

fn fee(value: &Value) -> Option<f64> {
    known(value).filter(|fee| *fee > 0.0 && *fee <= 100_000.0)
}

impl Store {
    /// Read valid locally stored fees for known sources only.
    pub fn subscriptions(&self) -> Map<String, Value> {
        let catalog = self.catalog();
        self.settings["subscriptions"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(agent, value)| catalog.get(agent).is_some() && fee(value).is_some())
            .map(|(agent, value)| (agent.to_owned(), value.clone()))
            .collect()
    }

    /// Save or remove the user's local monthly fee using the existing atomic preferences writer.
    ///
    /// # Errors
    /// Rejects invalid Agent IDs or fees, and returns the storage error if writing fails.
    pub fn set_subscription(&mut self, agent: &str, value: &Value) -> Result<(), String> {
        let amount = fee(value);
        if self.catalog().get(agent).is_none() || (!value.is_null() && amount.is_none()) {
            return Err("SUBSCRIPTION_INVALID".to_owned());
        }
        let mut next = self.settings.clone();
        let mut subscriptions = self.subscriptions();
        if let Some(amount) = amount {
            subscriptions.insert(agent.to_owned(), json!((amount * 100.0).round() / 100.0));
        } else {
            subscriptions.shift_remove(agent);
        }
        next["subscriptions"] = Value::Object(subscriptions);
        self.save_preferences(&next)
    }
}
