use crate::{
    cost_insights::date,
    cost_table::{known, number, ranked, ratio, text, FIELDS, PARTS},
};
use chrono::Datelike;
use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Determine which fields each Agent has ever recorded in the supplied snapshot.
pub fn recorded_fields(rows: &[Value]) -> impl Fn(&str, &str) -> bool + '_ {
    let mut seen = HashMap::<&str, u8>::new();
    for row in rows {
        let flags = seen.entry(text(&row["agent"])).or_default();
        for (index, field) in FIELDS.into_iter().enumerate() {
            let reported = if row["knownRecords"].is_object() {
                number(&row["knownRecords"][field]) > 0.0
            } else {
                known(&row[field]).is_some()
            };
            if reported {
                *flags |= 1 << index;
            }
        }
    }
    move |agent, field| {
        FIELDS
            .iter()
            .position(|&name| name == field)
            .is_some_and(|index| {
                seen.get(agent)
                    .is_some_and(|flags| flags & (1 << index) != 0)
            })
    }
}

#[derive(Default)]
struct Measurement {
    rows: usize,
    missing: bool,
    total: f64,
    reported: Option<f64>,
}

impl Measurement {
    fn add(&mut self, row: &Value, field: &str, amount: Option<f64>) {
        self.rows += 1;
        if let Some(amount) = amount {
            self.total += amount;
        } else {
            self.missing = true;
        }
        if number(&row["knownRecords"][field]) > 0.0 {
            *self.reported.get_or_insert(0.0) += number(&row["knownUsage"][field]);
        }
    }

    fn resolve(&self, no_rows_state: &'static str) -> (Option<f64>, &'static str) {
        if self.rows == 0 {
            (None, no_rows_state)
        } else if !self.missing {
            (Some(self.total), "value")
        } else if self.reported.is_some() {
            (self.reported, "partial")
        } else {
            (None, "unknown")
        }
    }
}

fn tile(key: &str, label: &str, (value, state): (Option<f64>, &str)) -> Value {
    json!({"key": key, "label": label, "value": value, "state": state})
}

/// Build disjoint category tiles, retaining the distinction between partial and not recorded.
pub fn category_view(rows: &[Value], recorded: &impl Fn(&str, &str) -> bool) -> Vec<Value> {
    let mut fields: [Measurement; FIELDS.len()] = std::array::from_fn(|_| Measurement::default());
    let mut output = Measurement::default();
    let mut plain = Measurement::default();
    for row in rows {
        let agent = text(&row["agent"]);
        let whole = known(&row["output"]);
        output.add(row, "output", whole);
        for (field, slot) in FIELDS.into_iter().zip(&mut fields) {
            if recorded(agent, field) {
                slot.add(row, field, known(&row[field]));
            }
        }
        if recorded(agent, "reasoning") {
            let part = known(&row["reasoning"]);
            plain.add(
                row,
                "outputPlain",
                whole
                    .zip(part)
                    .filter(|(whole, part)| part <= whole)
                    .map(|(whole, part)| whole - part),
            );
        }
    }
    let no_rows_state = if rows.is_empty() {
        "unknown"
    } else {
        "not-recorded"
    };
    let (output, reasoning) = if plain.rows == rows.len() {
        let plain_value = if rows.is_empty() {
            (Some(0.0), "unknown")
        } else {
            plain.resolve(no_rows_state)
        };
        (
            tile("outputPlain", "输出（不含推理）", plain_value),
            tile("reasoning", "推理", fields[4].resolve(no_rows_state)),
        )
    } else {
        let mut reasoning = if plain.rows > 0 {
            tile(
                "reasoning",
                "推理",
                (fields[4].resolve(no_rows_state).0, "partial"),
            )
        } else {
            tile("reasoning", "推理", (None, "combined"))
        };
        reasoning["note"] = json!(if plain.rows > 0 {
            "部分来源未单独记录推理"
        } else {
            "已含在输出中，来源未拆分"
        });
        (
            tile("output", "输出（含推理）", output.resolve(no_rows_state)),
            reasoning,
        )
    };
    vec![
        tile(
            "inputUncached",
            "输入（不含缓存）",
            fields[0].resolve(no_rows_state),
        ),
        output,
        tile("cacheRead", "缓存读取", fields[2].resolve(no_rows_state)),
        tile("cacheWrite", "缓存写入", fields[3].resolve(no_rows_state)),
        reasoning,
    ]
}

/// Compute cache reads as a share of reported input-side tokens.
pub fn cache_hit_rate(rows: &[Value], recorded: &impl Fn(&str, &str) -> bool) -> Option<f64> {
    let (mut cached, mut input) = (0.0, 0.0);
    for row in rows {
        let write = if recorded(text(&row["agent"]), "cacheWrite") {
            known(&row["cacheWrite"])
        } else {
            Some(0.0)
        };
        if let (Some(uncached), Some(read), Some(write)) = (
            known(&row["inputUncached"]),
            known(&row["cacheRead"]),
            write,
        ) {
            cached += read;
            input += uncached + read + write;
        }
    }
    ratio(cached, input)
}

/// Summarize where priced usage went without treating unpriced rows as measured zero.
pub fn cost_destination(rows: &[Value], recorded: &impl Fn(&str, &str) -> bool) -> Value {
    let (mut tokens, mut priced_tokens) = (0.0, 0.0);
    let mut cost = [0.0; PARTS.len()];
    let mut savings = None;
    for row in rows {
        tokens += number(&row["totalTokens"]);
        priced_tokens += number(&row["pricedTokens"]);
        if let Some(parts) = row["costParts"].as_object() {
            for (field, total) in PARTS.into_iter().zip(&mut cost) {
                *total += parts.get(field).map(number).unwrap_or_default();
            }
            *savings.get_or_insert(0.0) += number(&row["cacheSavingsUsd"]);
        }
    }
    let total = savings.map(|_| cost.into_iter().sum::<f64>());
    let parts: Vec<_> = PARTS.into_iter().zip(cost).map(|(part, cost)| {
        json!({"key": part, "value": total.map(|_| cost), "share": total.filter(|total| *total > 0.0).map(|total| cost / total)})
    }).collect();
    json!({"total": total, "parts": parts, "savings": savings, "hitRate": cache_hit_rate(rows, recorded), "pricedShare": ratio(priced_tokens, tokens)})
}

/// Rank shares by the selected snapshot field and optionally combine the tail.
pub fn shares(rows: &[Value], by: &str, limit: usize) -> Vec<Value> {
    #[derive(Default)]
    struct Bucket {
        tokens: f64,
        cost: Option<f64>,
    }
    let mut groups = IndexMap::<&str, Bucket>::new();
    for row in rows {
        let group = groups
            .entry(row[by].as_str().unwrap_or("unknown"))
            .or_default();
        group.tokens += number(&row["totalTokens"]);
        if let Some(cost) = known(&row["estimatedCostUsd"]) {
            *group.cost.get_or_insert(0.0) += cost;
        }
    }
    let mut items: Vec<_> = groups.into_iter().map(|(key, group)| json!({"key": key, "tokens": group.tokens, "cost": group.cost, "priced": group.cost.is_some()})).collect();
    items.sort_by(|left, right| ranked(left, right, "tokens", "key"));
    let (mut tokens, mut cost) = (0.0, 0.0);
    for item in &items {
        tokens += number(&item["tokens"]);
        cost += number(&item["cost"]);
    }
    if items.len() > limit.saturating_add(1) {
        let tail = items.split_off(limit);
        let mut other = Bucket::default();
        for item in &tail {
            other.tokens += number(&item["tokens"]);
            if let Some(cost) = known(&item["cost"]) {
                *other.cost.get_or_insert(0.0) += cost;
            }
        }
        items.push(json!({"key": null, "count": tail.len(), "tokens": other.tokens, "cost": other.cost, "priced": other.cost.is_some()}));
    }
    for item in &mut items {
        item["tokenShare"] = json!(ratio(number(&item["tokens"]), tokens).unwrap_or_default());
        item["costShare"] = json!(known(&item["cost"])
            .filter(|_| cost > 0.0)
            .map(|value| value / cost));
    }
    items
}

#[derive(Default)]
struct HourCell<'a> {
    tokens: f64,
    records: f64,
    dates: HashSet<&'a str>,
}

fn best_slot(totals: &[f64]) -> Option<usize> {
    totals
        .iter()
        .enumerate()
        .fold(None, |best, (index, &value)| {
            if value > 0.0 && best.is_none_or(|previous| value > totals[previous]) {
                Some(index)
            } else {
                best
            }
        })
}

/// Aggregate hourly snapshot rows by weekday (Monday first) and hour; ignore malformed coordinates.
pub fn week_hour(rows: &[Value]) -> Value {
    let mut cells: [[HourCell; 24]; 7] =
        std::array::from_fn(|_| std::array::from_fn(|_| HourCell::default()));
    let mut weekdays = HashMap::new();
    for row in rows {
        let day = text(&row["date"]);
        let Some(weekday) = *weekdays
            .entry(day)
            .or_insert_with(|| date(day).map(|day| day.weekday().num_days_from_monday() as usize))
        else {
            continue;
        };
        let Some(hour) =
            known(&row["hour"]).filter(|hour| (0.0..24.0).contains(hour) && hour.fract() == 0.0)
        else {
            continue;
        };
        let cell = &mut cells[weekday][hour as usize];
        let tokens = number(&row["totalTokens"]);
        cell.tokens += tokens;
        cell.records += number(&row["records"]);
        if tokens > 0.0 {
            cell.dates.insert(day);
        }
    }
    let (mut hours, mut days) = ([0.0; 24], [0.0; 7]);
    let (mut max, mut peak, mut active) = (0.0, None, 0);
    let cells = cells.into_iter().enumerate().map(|(weekday, columns)| {
        columns.into_iter().enumerate().map(|(hour, cell)| {
            hours[hour] += cell.tokens;
            days[weekday] += cell.tokens;
            if cell.tokens > 0.0 { active += 1; }
            if cell.tokens > max { max = cell.tokens; peak = Some(json!({"weekday": weekday, "hour": hour})); }
            json!({"tokens": cell.tokens, "records": cell.records, "days": cell.dates.len()})
        }).collect::<Vec<_>>()
    }).collect::<Vec<_>>();
    json!({"cells": cells, "max": max, "peak": peak, "active": active, "peakHour": best_slot(&hours), "peakWeekday": best_slot(&days), "hours": hours, "days": days})
}

/// Return current and longest usage streaks in the inclusive window.
pub fn streaks(totals: &Value, start: &str, end: &str) -> Value {
    let mut longest = json!({"length": 0, "from": null, "to": null});
    let (Some(start), Some(end)) = (date(start), date(end)) else {
        return json!({"current": 0, "longest": longest});
    };
    let used = |day: chrono::NaiveDate| number(&totals[day.format("%Y-%m-%d").to_string()]) > 0.0;
    let (mut run, mut best_length, mut current) = (0, 0, 0);
    let mut from = start;
    for day in start.iter_days().take_while(|day| *day <= end) {
        if used(day) {
            if run == 0 {
                from = day;
            }
            run += 1;
            if run > best_length {
                best_length = run;
                longest = json!({"length": run, "from": from.format("%Y-%m-%d").to_string(), "to": day.format("%Y-%m-%d").to_string()});
            }
        } else if day != end {
            run = 0;
        }
        if day == end {
            current = run;
        }
    }
    json!({"current": current, "longest": longest})
}

/// Find the highest-token hour window, including windows that cross midnight.
pub fn peak_window(hours: &[f64; 24], width: usize) -> Value {
    let total = hours.iter().copied().sum::<f64>();
    if total == 0.0 {
        return Value::Null;
    }
    let mut best = None;
    for start in 0..hours.len() {
        let tokens = hours
            .iter()
            .cycle()
            .skip(start)
            .take(width)
            .copied()
            .sum::<f64>();
        if best.is_none_or(|(_, maximum)| tokens > maximum) {
            best = Some((start, tokens));
        }
    }
    best.map_or(Value::Null, |(start, tokens)| json!({"start": start, "end": (start + width % 24) % 24, "tokens": tokens, "share": tokens / total}))
}

/// Summarize efficiency and pricing coverage over the supplied snapshot rows.
pub fn efficiency(rows: &[Value], recorded: &impl Fn(&str, &str) -> bool) -> Value {
    let totals = crate::cost_insights::total(rows);
    let records = rows.iter().map(|row| number(&row["records"])).sum::<f64>();
    json!({"activeDays": totals.usage_days, "tokens": totals.tokens, "records": records, "pricedTokens": totals.priced_tokens,
        "costPerDay": totals.lower.and_then(|cost| ratio(cost, totals.usage_days as f64)), "tokensPerRecord": ratio(totals.tokens, records),
        "costPerMillion": totals.lower.and_then(|cost| ratio(cost, totals.priced_tokens)).map(|rate| rate * 1e6),
        "hitRate": cache_hit_rate(rows, recorded), "pricingCoverage": if totals.tokens > 0.0 { totals.coverage } else { None }})
}

/// Relative change against a known, positive comparable baseline.
pub fn change(current: Option<f64>, previous: Option<f64>) -> Option<f64> {
    current
        .filter(|current| current.is_finite())
        .zip(previous.filter(|previous| previous.is_finite() && *previous > 0.0))
        .map(|(current, previous)| (current - previous) / previous)
}
