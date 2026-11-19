use crate::{collate, js_json, pricing_labels};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::cmp::Ordering;

pub const FIELDS: [&str; 5] = [
    "inputUncached",
    "output",
    "cacheRead",
    "cacheWrite",
    "reasoning",
];
pub const PARTS: [&str; 4] = ["inputUncached", "output", "cacheRead", "cacheWrite"];
pub const RANGED: [&str; 4] = [
    "cache-write-unreported",
    "context-unreported",
    "reasoning-unreported",
    "time-tariff-unreported",
];
pub const HEADER: [&str; 14] = [
    "范围",
    "分组",
    "名称",
    "服务商",
    "使用方",
    "Token",
    "占比",
    "估算下限 (USD)",
    "估算上限 (USD)",
    "已计入 Token",
    "计价覆盖",
    "每百万 Token (USD)",
    "较前期",
    "未计入原因",
];

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GroupBy {
    #[default]
    Model,
    Agent,
}

#[derive(Default)]
pub(crate) struct CostSum {
    pub tokens: f64,
    pub priced_tokens: f64,
    pub lower: Option<f64>,
    pub upper: Option<f64>,
}

impl CostSum {
    pub fn add(&mut self, row: &Value) {
        self.tokens += number(&row["totalTokens"]);
        self.priced_tokens += number(&row["pricedTokens"]);
        if let Some(lower) = known(&row["estimatedCostUsd"]) {
            *self.lower.get_or_insert(0.0) += lower;
            *self.upper.get_or_insert(0.0) += known(&row["estimatedCostUpperUsd"]).unwrap_or(lower);
        }
    }

    pub fn coverage(&self) -> Option<f64> {
        ratio(self.priced_tokens, self.tokens)
    }
}

pub(crate) fn known(value: &Value) -> Option<f64> {
    value.as_f64().filter(|value| value.is_finite())
}

pub(crate) fn number(value: &Value) -> f64 {
    known(value).unwrap_or_default()
}

pub(crate) fn text(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

pub(crate) fn ratio(numerator: f64, denominator: f64) -> Option<f64> {
    (denominator != 0.0).then(|| numerator / denominator)
}

pub(crate) fn descending(left: f64, right: f64) -> Ordering {
    right.partial_cmp(&left).unwrap_or(Ordering::Equal)
}

pub(crate) fn counts_add_range(counts: &mut IndexMap<&str, f64>, row: &Value) {
    if matches!((known(&row["estimatedCostUsd"]), known(&row["estimatedCostUpperUsd"])), (Some(lower), Some(upper)) if upper > lower)
    {
        for code in RANGED {
            let records = number(&row["pricingReasons"][code]);
            if records > 0.0 {
                *counts.entry(code).or_default() += records;
            }
        }
    }
}

pub(crate) fn spread_reasons(counts: IndexMap<&str, f64>, labels: &Value) -> Vec<Value> {
    let mut counts: Vec<_> = counts.into_iter().collect();
    counts.sort_by(|left, right| {
        descending(left.1, right.1).then_with(|| collate::compare(left.0, right.0))
    });
    counts.into_iter().map(|(code, records)| json!({"code": code, "records": records, "text": labels[code].as_str().unwrap_or(code)})).collect()
}

#[derive(Default)]
struct Field {
    sum: f64,
    known: bool,
    unknown: bool,
}

#[derive(Default)]
struct Group<'a> {
    totals: CostSum,
    records: f64,
    bounded_tokens: f64,
    savings: Option<f64>,
    fields: [Field; FIELDS.len()],
    parts: [f64; PARTS.len()],
    unpriced: IndexMap<&'a str, f64>,
    incomplete: IndexMap<&'a str, f64>,
    ranged: IndexMap<&'a str, f64>,
    users: IndexMap<String, (&'a Value, CostSum)>,
    days: IndexMap<&'a str, CostSum>,
}

fn provider(row: &Value) -> &str {
    row["provider"]
        .as_str()
        .filter(|provider| !provider.is_empty())
        .unwrap_or("unknown")
}

fn key_of(row: &Value, by: GroupBy) -> String {
    match by {
        GroupBy::Agent => text(&row["agent"]).to_owned(),
        GroupBy::Model => format!(
            "{}/{}",
            provider(row),
            row["model"]
                .as_str()
                .unwrap_or(if row.get("model").is_some() {
                    "null"
                } else {
                    "undefined"
                })
        ),
    }
}

fn add_counts<'a>(counts: &mut IndexMap<&'a str, f64>, value: &'a Value) {
    if let Some(entries) = value.as_object() {
        for (code, count) in entries {
            *counts.entry(code).or_default() += number(count);
        }
    }
}

fn gaps(group: &Group<'_>, reasons: &Value, causes: &Value) -> Vec<Value> {
    let default_cause = reasons["usage-incomplete"]
        .as_str()
        .unwrap_or("usage-incomplete");
    let mut list: Vec<_> = group
        .incomplete
        .iter()
        .map(|(&code, &tokens)| {
            json!({
                "code": code, "kind": "cause", "tokens": tokens, "fixable": false,
                "text": causes[code].as_str().unwrap_or(default_cause)
            })
        })
        .collect();
    let cause_tokens = group.incomplete.values().copied().sum::<f64>();
    for (&code, &tokens) in &group.unpriced {
        let rest = if code == "usage-incomplete" {
            tokens - cause_tokens
        } else {
            tokens
        };
        if rest > 0.0 {
            list.push(json!({"code": code, "kind": "reason", "tokens": rest,
                "fixable": pricing_labels::FIXABLE.contains(&code), "text": reasons[code].as_str().unwrap_or(code)}));
        }
    }
    list.sort_by(|left, right| ranked(left, right, "tokens", "code"));
    list
}

pub(crate) fn ranked(left: &Value, right: &Value, metric: &str, key: &str) -> Ordering {
    descending(number(&left[metric]), number(&right[metric]))
        .then_with(|| collate::compare(text(&left[key]), text(&right[key])))
}

fn user(key: &str, row: &Value, sum: CostSum, by: GroupBy, group_tokens: f64) -> Value {
    let mut user = json!({"key": key, "tokens": sum.tokens, "lower": sum.lower, "upper": sum.upper,
        "priced": sum.lower.is_some(), "pricedTokens": sum.priced_tokens});
    match by {
        GroupBy::Agent => {
            if let Some(agent) = row.get("agent") {
                user["agent"] = agent.clone();
            }
        }
        GroupBy::Model => {
            user["provider"] = json!(provider(row));
            if let Some(model) = row.get("model") {
                user["model"] = model.clone();
            }
        }
    }
    user["share"] = json!(ratio(sum.tokens, group_tokens).unwrap_or_default());
    user["coverage"] = json!(sum.coverage());
    user
}

/// Build a ranked cost table from daily snapshot rows; `None` means no comparison.
pub fn table(rows: &[Value], by: GroupBy, previous: Option<&[Value]>) -> Vec<Value> {
    table_from_rows(rows, by, previous.map(|rows| rows.iter()))
}

pub(crate) fn table_from_rows<'a>(
    rows: impl IntoIterator<Item = &'a Value>,
    by: GroupBy,
    previous: Option<impl IntoIterator<Item = &'a Value>>,
) -> Vec<Value> {
    let counterpart = match by {
        GroupBy::Agent => GroupBy::Model,
        GroupBy::Model => GroupBy::Agent,
    };
    let mut groups = IndexMap::<String, (&Value, Group)>::new();
    let mut total = 0.0;
    for row in rows {
        let (_, group) = groups
            .entry(key_of(row, by))
            .or_insert_with(|| (row, Group::default()));
        total += number(&row["totalTokens"]);
        group.totals.add(row);
        group.records += number(&row["records"]);
        group.bounded_tokens += number(&row["boundedTokens"]);
        if let Some(savings) = known(&row["cacheSavingsUsd"]) {
            *group.savings.get_or_insert(0.0) += savings;
        }
        for (field, slot) in FIELDS.into_iter().zip(&mut group.fields) {
            if let Some(value) = known(&row[field]) {
                slot.sum += value;
                slot.known = true;
            } else {
                slot.unknown = true;
            }
        }
        for (part, sum) in PARTS.into_iter().zip(&mut group.parts) {
            *sum += number(&row["costParts"][part]);
        }
        add_counts(&mut group.unpriced, &row["unpricedTokens"]);
        add_counts(&mut group.incomplete, &row["incompleteTokens"]);
        counts_add_range(&mut group.ranged, row);
        group
            .users
            .entry(key_of(row, counterpart))
            .or_insert_with(|| (row, CostSum::default()))
            .1
            .add(row);
        group.days.entry(text(&row["date"])).or_default().add(row);
    }
    let mut before = IndexMap::<String, f64>::new();
    let comparable = previous.is_some();
    if let Some(previous) = previous {
        for row in previous {
            *before.entry(key_of(row, by)).or_default() += number(&row["totalTokens"]);
        }
    }
    let (reasons, causes) = (pricing_labels::reasons(), pricing_labels::causes());
    let mut items = Vec::with_capacity(groups.len());
    for (key, (row, group)) in groups {
        let (agent, provider, model) = match by {
            GroupBy::Agent => (&row["agent"], Value::Null, &Value::Null),
            GroupBy::Model => (&Value::Null, json!(provider(row)), &row["model"]),
        };
        let sum = &group.totals;
        let read = &group.fields[2];
        let input = &group.fields[0];
        let hit_rate = (read.known
            && input.known
            && !read.unknown
            && !input.unknown
            && read.sum + input.sum > 0.0)
            .then(|| read.sum / (read.sum + input.sum));
        let fields: Map<_, _> = FIELDS.into_iter().zip(&group.fields).map(|(field, slot)| (field.to_owned(),
            json!({"value": slot.known.then_some(slot.sum), "partial": slot.known && slot.unknown}))).collect();
        let gaps = gaps(&group, &reasons, &causes);
        let mut users: Vec<_> = group
            .users
            .into_iter()
            .map(|(key, (row, totals))| user(&key, row, totals, counterpart, sum.tokens))
            .collect();
        users.sort_by(|left, right| ranked(left, right, "tokens", "key"));
        let mut days: Vec<_> = group.days.into_iter().collect();
        days.sort_by(|left, right| collate::compare(left.0, right.0));
        let series: Vec<_> = days
            .into_iter()
            .map(|(date, day)| {
                json!({"date": date, "tokens": day.tokens, "cost": day.lower,
            "costUpper": day.upper, "partial": day.priced_tokens < day.tokens})
            })
            .collect();
        let previous = comparable.then(|| before.get(&key).copied().unwrap_or_default());
        let parts = sum.lower.map(|_| {
            PARTS
                .into_iter()
                .zip(group.parts)
                .map(|(name, value)| (name.to_owned(), json!(value)))
                .collect::<Map<_, _>>()
        });
        items.push(json!({"key": key, "agent": agent, "provider": provider, "model": model,
            "tokens": sum.tokens, "records": group.records, "share": ratio(sum.tokens, total).unwrap_or_default(),
            "lower": sum.lower, "upper": sum.upper, "pricedTokens": sum.priced_tokens, "boundedTokens": group.bounded_tokens,
            "coverage": sum.coverage(), "perMillion": sum.lower.filter(|_| sum.priced_tokens > 0.0).map(|lower| lower / sum.priced_tokens * 1e6),
            "fields": fields, "costParts": parts, "spread": sum.lower.zip(sum.upper).map(|(lower, upper)| upper - lower),
            "spreadReasons": spread_reasons(group.ranged, &reasons), "savings": sum.lower.and(group.savings), "hitRate": hit_rate,
            "gaps": gaps, "users": users, "series": series, "previousTokens": previous,
            "delta": previous.and_then(|previous| ratio(sum.tokens - previous, previous)), "isNew": previous == Some(0.0) && sum.tokens > 0.0
        }));
    }
    items.sort_by(|left, right| ranked(left, right, "tokens", "key"));
    items
}

/// Sort borrowed items without copying their daily series or breakdowns.
pub fn sort<'a>(items: &'a [Value], by: &str) -> Vec<&'a Value> {
    let mut sorted: Vec<_> = items.iter().collect();
    sorted.sort_by(|left, right| {
        let cost = if by == "cost" {
            left["lower"]
                .is_null()
                .cmp(&right["lower"].is_null())
                .then_with(|| descending(number(&left["lower"]), number(&right["lower"])))
        } else {
            Ordering::Equal
        };
        cost.then_with(|| ranked(left, right, "tokens", "key"))
    });
    sorted
}

/// Keep the leading entries and combine the tail only if at least two remain.
pub fn fold(mut items: Vec<Value>, top: usize) -> Vec<Value> {
    if items.len() <= top.saturating_add(1) {
        return items;
    }
    let tail = items.split_off(top);
    let sum = |key: &str| tail.iter().map(|item| number(&item[key])).sum::<f64>();
    let priced = tail.iter().any(|item| !item["lower"].is_null());
    let tokens = sum("tokens");
    let priced_tokens = sum("pricedTokens");
    items.push(json!({"key": null, "other": true, "count": tail.len(), "members": tail.iter().map(|item| &item["key"]).collect::<Vec<_>>(),
        "tokens": tokens, "share": sum("share"), "lower": priced.then(|| sum("lower")),
        "upper": priced.then(|| tail.iter().filter(|item| !item["lower"].is_null()).map(|item| number(&item["upper"])).sum::<f64>()),
        "pricedTokens": priced_tokens, "coverage": ratio(priced_tokens, tokens)}));
    items
}

/// Bucket long series, retaining the original entries when no reduction is needed.
pub fn points(series: Vec<Value>, max: usize) -> Vec<Value> {
    if series.len() <= max {
        return series;
    }
    let size = if max == 0 {
        series.len()
    } else {
        series.len().div_ceil(max)
    };
    series
        .chunks(size)
        .map(|chunk| {
            json!({"date": chunk[0]["date"],
        "tokens": chunk.iter().map(|point| number(&point["tokens"])).sum::<f64>()})
        })
        .collect()
}

fn cell(text: &str, untrusted: bool) -> String {
    let escaped;
    let text = if untrusted && text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        escaped = format!("'{text}");
        &escaped
    } else {
        text
    };
    if text.contains(['"', ',', '\r', '\n']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_owned()
    }
}

fn children(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}

fn percent(value: f64) -> String {
    format!("{}%", js_json::to_fixed(value * 100.0, 1))
}

/// Produce the spreadsheet-safe legacy CSV, including its BOM and CRLF endings.
pub fn csv(
    items: &[Value],
    by: GroupBy,
    range: &str,
    agent_name: impl Fn(&str) -> String,
    model_name: impl Fn(&str) -> String,
) -> String {
    let mut output = format!("\u{feff}{}\r\n", HEADER.join(","));
    let usd = |value: &Value| {
        known(value)
            .map(|value| js_json::to_fixed(value, 4))
            .unwrap_or_default()
    };
    for item in items {
        let users = children(&item["users"]);
        let (label, name, provider, users) = match by {
            GroupBy::Agent => (
                "Agent",
                agent_name(text(&item["agent"])),
                "",
                users
                    .map(|user| model_name(text(&user["model"])))
                    .collect::<Vec<_>>()
                    .join(" / "),
            ),
            GroupBy::Model => (
                "模型",
                model_name(text(&item["model"])),
                text(&item["provider"]),
                users
                    .map(|user| agent_name(text(&user["agent"])))
                    .collect::<Vec<_>>()
                    .join(" / "),
            ),
        };
        let delta = if item["isNew"].as_bool() == Some(true) {
            "新增".to_owned()
        } else {
            known(&item["delta"])
                .map(|delta| {
                    format!(
                        "{}{}",
                        if delta >= 0.0 { '+' } else { '-' },
                        percent(delta.abs())
                    )
                })
                .unwrap_or_default()
        };
        let reasons = children(&item["gaps"])
            .map(|gap| {
                format!(
                    "{}（{} Token）",
                    text(&gap["text"]),
                    js_json::stringify(&gap["tokens"])
                )
            })
            .collect::<Vec<_>>()
            .join("；");
        output.push_str(
            &[
                cell(range, false),
                label.to_owned(),
                cell(&name, true),
                cell(provider, true),
                cell(&users, true),
                js_json::stringify(&item["tokens"]),
                known(&item["share"]).map(percent).unwrap_or_default(),
                usd(&item["lower"]),
                usd(&item["upper"]),
                js_json::stringify(&item["pricedTokens"]),
                known(&item["coverage"]).map(percent).unwrap_or_default(),
                usd(&item["perMillion"]),
                delta,
                cell(&reasons, false),
            ]
            .join(","),
        );
        output.push_str("\r\n");
    }
    output
}
