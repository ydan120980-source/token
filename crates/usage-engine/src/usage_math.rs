use crate::time::{iso_from_ms, parse_iso};
use chrono::TimeZone;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const AVERAGE_MIN: usize = 7;

fn tz(timezone: &str) -> chrono_tz::Tz {
    timezone.parse().unwrap_or(chrono_tz::UTC)
}

pub fn local_day(timezone: &str, time_ms: i64) -> String {
    let dt = chrono::DateTime::from_timestamp_millis(time_ms).unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
    tz(timezone).from_utc_datetime(&dt.naive_utc()).format("%Y-%m-%d").to_string()
}

pub fn hour_of(timezone: &str, time_ms: i64) -> u32 {
    let dt = chrono::DateTime::from_timestamp_millis(time_ms).unwrap_or_else(|| chrono::DateTime::from_timestamp(0, 0).unwrap());
    tz(timezone).from_utc_datetime(&dt.naive_utc()).format("%H").to_string().parse().unwrap_or(0)
}

pub fn shift(date: &str, days: i64) -> String {
    let ms = parse_iso(&format!("{date}T12:00:00Z")).unwrap_or(0);
    iso_from_ms(ms + days * 86_400_000)[..10].to_string()
}

pub fn start_for(today: &str, period: &str, coverage_start: Option<&str>) -> String {
    if period == "all" {
        return coverage_start.filter(|s| !s.is_empty()).unwrap_or(today).to_string();
    }
    if period == "today" {
        return today.to_string();
    }
    let n: i64 = period.parse().unwrap_or(0);
    shift(today, 1 - n)
}

pub struct SeriesOptions<'a> {
    pub rows: &'a [Value],
    pub models: &'a [String],
    pub days: &'a [String],
    pub display: &'a str,
    pub metric: &'a str,
    pub coverage_start: &'a str,
    pub observed_dates: Option<&'a HashSet<String>>,
}

pub fn series_by_model(options: &SeriesOptions) -> HashMap<String, Vec<Option<f64>>> {
    let mut grouped: HashMap<String, (HashMap<String, f64>, HashSet<String>)> =
        options.models.iter().map(|m| (m.clone(), (HashMap::new(), HashSet::new()))).collect();
    for row in options.rows {
        let model = row.get("model").and_then(|v| v.as_str()).unwrap_or("");
        let Some(group) = grouped.get_mut(model) else { continue };
        let date = row.get("date").and_then(|v| v.as_str()).unwrap_or("").to_string();
        group.1.insert(date.clone());
        let value = if options.metric == "cost" {
            row.get("estimatedCostUsd").and_then(|v| v.as_f64())
        } else {
            row.get("totalTokens").and_then(|v| v.as_f64())
        };
        if let Some(value) = value {
            *group.0.entry(date).or_insert(0.0) += value;
        }
    }
    let mut sorted_days = options.days.to_vec();
    sorted_days.sort();
    struct Plan {
        day: String,
        window: Vec<String>,
        covered: bool,
    }
    let plan: Vec<Plan> = sorted_days
        .iter()
        .map(|day| {
            if options.display == "average" {
                let mut window = Vec::new();
                let mut date = shift(day, -29);
                while date <= *day {
                    if date.as_str() >= options.coverage_start
                        && options.observed_dates.map(|o| o.contains(&date)).unwrap_or(true)
                    {
                        window.push(date.clone());
                    }
                    date = shift(&date, 1);
                }
                let covered = day.as_str() >= options.coverage_start && window.len() >= AVERAGE_MIN;
                Plan { day: day.clone(), window, covered }
            } else {
                let covered = day.as_str() >= options.coverage_start
                    && (options.display == "total" || options.observed_dates.map(|o| o.contains(day)).unwrap_or(true));
                Plan { day: day.clone(), window: vec![day.clone()], covered }
            }
        })
        .collect();
    let mut out = HashMap::new();
    for (model, (daily, observed)) in &grouped {
        let mut running = 0.0;
        let mut known = false;
        let mut values: HashMap<String, Option<f64>> = HashMap::new();
        for item in &plan {
            if !item.covered {
                values.insert(item.day.clone(), None);
                continue;
            }
            if options.display == "total" {
                if let Some(value) = daily.get(&item.day) {
                    running += value;
                    known = true;
                }
                values.insert(item.day.clone(), if options.metric == "cost" && !known { None } else { Some(running) });
                continue;
            }
            let mut sum = 0.0;
            let mut priced = false;
            let mut has_rows = false;
            let mut known_days = 0usize;
            for date in &item.window {
                sum += daily.get(date).copied().unwrap_or(0.0);
                priced |= daily.contains_key(date);
                has_rows |= observed.contains(date);
                if daily.contains_key(date) || !observed.contains(date) {
                    known_days += 1;
                }
            }
            if options.metric == "cost" && has_rows && !priced {
                values.insert(item.day.clone(), None);
                continue;
            }
            if options.display != "average" {
                values.insert(item.day.clone(), Some(sum));
                continue;
            }
            values.insert(item.day.clone(), if known_days >= AVERAGE_MIN { Some(sum / known_days as f64) } else { None });
        }
        out.insert(model.clone(), options.days.iter().map(|day| values.get(day).copied().flatten()).collect());
    }
    out
}

pub fn series(rows: &[Value], model: &str, days: &[String], display: &str, metric: &str, coverage_start: &str, observed_dates: Option<&HashSet<String>>) -> Vec<Option<f64>> {
    let models = vec![model.to_string()];
    series_by_model(&SeriesOptions { rows, models: &models, days, display, metric, coverage_start, observed_dates })
        .remove(model)
        .unwrap_or_default()
}

fn num(row: &Value, field: &str) -> Option<f64> {
    row.get(field)?.as_f64().filter(|n| n.is_finite())
}

pub fn disjoint_mix(rows: &[Value]) -> Value {
    let mut complete_total = 0.0;
    let mut complete_count = 0usize;
    let mut complete = [0.0f64; 5];
    let mut all_total = 0.0;
    let mut all = [0.0f64; 5];
    let mut has_null = [false; 5];
    let mut invalid_reasoning = false;
    let mut observed = [0.0f64; 5];
    let mut counts = [0usize; 5];
    let mut partial_values = [false; 5];
    const KEYS: [&str; 5] = ["inputUncached", "outputPlain", "cacheRead", "cacheWrite", "reasoning"];
    for row in rows {
        let u = num(row, "inputUncached");
        let o = num(row, "output");
        let cr = num(row, "cacheRead");
        let cw = num(row, "cacheWrite");
        let re = num(row, "reasoning");
        let tt = num(row, "totalTokens").unwrap_or(0.0);
        all_total += tt;
        let is_complete = match (u, o, cr, cw, re) {
            (Some(u), Some(o), Some(cr), Some(cw), Some(re)) => re <= o && u + o + cr + cw == tt,
            _ => false,
        };
        if is_complete {
            complete_count += 1;
            complete_total += tt;
            complete[0] += u.unwrap();
            complete[1] += o.unwrap();
            complete[2] += cr.unwrap();
            complete[3] += cw.unwrap();
            complete[4] += re.unwrap();
        }
        for (i, value) in [u, o, cr, cw, re].iter().enumerate() {
            match value {
                None => has_null[i] = true,
                Some(v) => all[i] += v,
            }
        }
        if let (Some(re), Some(o)) = (re, o) {
            if re > o {
                invalid_reasoning = true;
            }
        }
        let rec = num(row, "records").unwrap_or(0.0);
        if let Some(known_records) = row.get("knownRecords").filter(|v| v.is_object()) {
            for (i, key) in KEYS.iter().enumerate() {
                let known = known_records.get(*key).and_then(|v| v.as_f64());
                if known.unwrap_or(rec) < rec {
                    partial_values[i] = true;
                }
                if known.map(|k| k > 0.0).unwrap_or(false) {
                    counts[i] += 1;
                    let usage_key = if *key == "outputPlain" { "outputPlain" } else { key };
                    observed[i] += row.get("knownUsage").and_then(|v| v.get(usage_key)).and_then(|v| v.as_f64()).unwrap_or(0.0);
                }
            }
        }
    }
    let values = [complete[0], complete[1] - complete[4], complete[2], complete[3], complete[4]];
    let display_values = [
        if has_null[0] { if counts[0] > 0 { Some(observed[0]) } else { None } } else { Some(all[0]) },
        if has_null[1] || has_null[4] || invalid_reasoning { if counts[1] > 0 { Some(observed[1]) } else { None } } else { Some(all[1] - all[4]) },
        if has_null[2] { if counts[2] > 0 { Some(observed[2]) } else { None } } else { Some(all[2]) },
        if has_null[3] { if counts[3] > 0 { Some(observed[3]) } else { None } } else { Some(all[3]) },
        if has_null[4] { if counts[4] > 0 { Some(observed[4]) } else { None } } else { Some(all[4]) },
    ];
    if has_null[0] {
        partial_values[0] = true;
    }
    if has_null[1] || has_null[4] || invalid_reasoning {
        partial_values[1] = true;
    }
    if has_null[2] {
        partial_values[2] = true;
    }
    if has_null[3] {
        partial_values[3] = true;
    }
    if has_null[4] {
        partial_values[4] = true;
    }
    json!({
        "total": complete_total,
        "values": values,
        "displayValues": display_values,
        "partialValues": partial_values,
        "incomplete": complete_count != rows.len(),
        "coverage": if all_total != 0.0 { Some(complete_total / all_total) } else { None }
    })
}