use crate::resource_state::date_millis;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use usage_engine::{agent_catalog::builtin_agents, collate, normalize::truthy, store_io::atomic};

const MINUTE_MS: i64 = 60_000;
const SOON_MS: i64 = 10 * MINUTE_MS;
const SAME_RESET_MS: u64 = 30 * MINUTE_MS as u64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub low: u8,
    pub reset: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            low: 20,
            reset: true,
        }
    }
}

impl Settings {
    fn apply(&mut self, patch: &Value) {
        if let Some(enabled) = patch["enabled"].as_bool() {
            self.enabled = enabled;
        }
        if let Some(reset) = patch["reset"].as_bool() {
            self.reset = reset;
        }
        if let Some(low @ (10.0 | 20.0 | 30.0)) = patch["low"].as_f64() {
            self.low = low as u8;
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRow<'a> {
    pub key: String,
    pub account: &'a str,
    pub agent: &'a str,
    pub agent_name: String,
    pub alias: Option<&'a str>,
    pub window: &'a str,
    pub remaining: f64,
    pub resets_at: Option<&'a str>,
    pub fresh: bool,
    pub fetched_at: Option<&'a str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Notice {
    pub kind: &'static str,
    pub title: String,
    pub body: String,
    pub agent: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub notices: Vec<Notice>,
    pub marks: Map<String, Value>,
}

fn duration(value: &Value) -> Option<&'static str> {
    let minutes = value
        .as_f64()
        .or_else(|| value.as_str()?.parse::<f64>().ok());
    match minutes {
        Some(60.0) => Some("每小时"),
        Some(300.0) => Some("5 小时"),
        Some(1440.0) => Some("每天"),
        Some(10080.0) => Some("每周"),
        Some(43200.0) => Some("每月"),
        _ => None,
    }
}

fn name<'a>(item: &'a Value, pool: &'a Value) -> &'a str {
    let label = item["label"].as_str();
    let cadence = duration(&item["durationMins"]);
    let terse = label.is_none_or(|label| {
        label.is_empty()
            || ["5h", "week", "weekly"]
                .iter()
                .any(|option| label.eq_ignore_ascii_case(option))
    });
    (if terse { cadence } else { label })
        .or(label)
        .or(cadence)
        .or_else(|| pool["label"].as_str())
        .unwrap_or("额度")
}

fn percent(item: &Value) -> Option<f64> {
    if let Some(remaining) = item["remainingPercent"]
        .as_f64()
        .filter(|percent| percent.is_finite())
    {
        return Some(remaining);
    }
    let numeric = |value: &Value| {
        value
            .as_f64()
            .or_else(|| value.as_str()?.parse::<f64>().ok())
            .filter(|value| value.is_finite())
    };
    let left = numeric(&item["remaining"])?;
    let total = numeric(&item["total"]).filter(|total| *total > 0.0)?;
    Some((left / total * 100.0).clamp(0.0, 100.0))
}

/// Read only known windows from already projected account observations.
pub fn window_rows(accounts: &[Value]) -> Vec<WindowRow<'_>> {
    let catalog = builtin_agents();
    let mut rows = Vec::new();
    for account in accounts {
        let quota = &account["quota"];
        let Some(id) = account["id"].as_str() else {
            continue;
        };
        let Some(agent) = account["provider"]
            .as_str()
            .or_else(|| quota["provider"].as_str())
        else {
            continue;
        };
        for pool in quota["pools"].as_array().into_iter().flatten() {
            for item in pool["windows"].as_array().into_iter().flatten() {
                let Some(remaining) = percent(item) else {
                    continue;
                };
                if matches!(
                    item["state"].as_str(),
                    Some("disabled" | "unlimited" | "unavailable")
                ) {
                    continue;
                }
                let (Some(pool_id), Some(item_id)) = (pool["id"].as_str(), item["id"].as_str())
                else {
                    continue;
                };
                rows.push(WindowRow {
                    key: format!("{id}/{pool_id}/{item_id}"),
                    account: id,
                    agent,
                    agent_name: catalog[agent]["name"].as_str().unwrap_or(agent).to_owned(),
                    alias: account["alias"].as_str(),
                    window: name(item, pool),
                    remaining: (remaining + 0.5).floor(),
                    resets_at: item["resetsAt"].as_str(),
                    fresh: matches!(
                        item["freshness"]["state"].as_str(),
                        Some("fresh" | "cached")
                    ),
                    fetched_at: item["observedAt"]
                        .as_str()
                        .or_else(|| quota["fetchedAt"].as_str()),
                });
            }
        }
    }
    rows.sort_by(|left, right| {
        left.remaining.total_cmp(&right.remaining).then_with(|| {
            collate::compare(
                left.resets_at.unwrap_or("null"),
                right.resets_at.unwrap_or("null"),
            )
        })
    });
    rows
}

fn until_text(ms: i64) -> String {
    let minutes = ((ms.saturating_add(MINUTE_MS / 2)) / MINUTE_MS).max(1);
    let hours = minutes / 60;
    let rest = minutes % 60;
    match (hours, rest) {
        (0, _) => format!("{minutes} 分钟"),
        (1..=23, 0) => format!("{hours} 小时"),
        (1..=23, _) => format!("{hours} 小时 {rest} 分钟"),
        _ => format!("{} 天", (hours + 12) / 24),
    }
}

pub fn evaluate(
    rows: &[WindowRow<'_>],
    marks: &Map<String, Value>,
    settings: Settings,
    now: i64,
) -> Evaluation {
    let mut notices = Vec::new();
    let mut next = Map::new();
    for row in rows {
        let mut mark = marks
            .get(&row.key)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        if row.fresh {
            let mut notice = |kind, title, body| {
                notices.push(Notice {
                    kind,
                    title,
                    body,
                    agent: Some(row.agent.to_owned()),
                })
            };
            let label = format!("{} {}", row.agent_name, row.window);
            let reset = row
                .resets_at
                .and_then(|wire| date_millis(&json!(wire)))
                .filter(|at| *at > now && *at != 0);
            let remaining = row.remaining;
            let low = |mark: &Map<String, Value>| mark.get("low").is_some_and(truthy);
            let threshold = f64::from(settings.low);
            if low(&mark) && remaining > threshold {
                if settings.reset {
                    notice(
                        "back",
                        format!("{label} 已恢复"),
                        format!("现在剩余 {remaining}%"),
                    );
                }
                mark.shift_remove("low");
                mark.shift_remove("soon");
            } else if !low(&mark) && remaining <= threshold {
                mark.insert("low".to_owned(), json!(true));
                let body = reset.map_or_else(
                    || "重置时间未知".to_owned(),
                    |at| format!("{}后重置", until_text(at.saturating_sub(now))),
                );
                notice("low", format!("{label} 只剩 {remaining}%"), body);
            }
            if let Some(at) = reset.filter(|at| at.saturating_sub(now) <= SOON_MS) {
                let already_notified = mark
                    .get("soon")
                    .and_then(date_millis)
                    .is_some_and(|previous| previous.abs_diff(at) < SAME_RESET_MS);
                if low(&mark) && settings.reset && !already_notified {
                    mark.insert("soon".to_owned(), json!(row.resets_at));
                    notice(
                        "soon",
                        format!("{label} {}后重置", until_text(at.saturating_sub(now))),
                        format!("现在剩余 {remaining}%"),
                    );
                }
            }
        }
        if !mark.is_empty() || !row.fresh {
            next.insert(row.key.clone(), Value::Object(mark));
        }
    }
    Evaluation {
        notices,
        marks: next,
    }
}

pub fn bundled(notices: Vec<Notice>) -> Vec<Notice> {
    if notices.len() <= 2 {
        return notices;
    }
    let count = notices.len();
    let titles: Vec<_> = notices
        .into_iter()
        .take(3)
        .map(|notice| notice.title)
        .collect();
    vec![Notice {
        kind: "many",
        title: format!("{count} 项额度有变化"),
        body: titles.join("\n"),
        agent: None,
    }]
}

pub struct QuotaWatch {
    path: PathBuf,
    settings: Settings,
    marks: Map<String, Value>,
}

impl QuotaWatch {
    /// Opens the app-owned watch preferences. Only this file is read or written.
    pub fn open(root: &Path) -> Self {
        let path = root.join("quota-watch.json");
        let mut saved = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .unwrap_or(Value::Null);
        let mut settings = Settings::default();
        settings.apply(&saved["settings"]);
        let marks = match saved.get_mut("marks").map(Value::take) {
            Some(Value::Object(marks)) => marks,
            _ => Map::new(),
        };
        Self {
            path,
            settings,
            marks,
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings
    }

    fn save(&self) -> std::io::Result<()> {
        atomic(
            &self.path,
            &json!({"settings":self.settings, "marks":self.marks}),
            false,
        )
    }

    pub fn set(&mut self, patch: &Value, rows: &[WindowRow<'_>], now: i64) -> Vec<Notice> {
        self.settings.apply(patch);
        let _ = self.save();
        self.check(rows, now)
    }

    pub fn check(&mut self, rows: &[WindowRow<'_>], now: i64) -> Vec<Notice> {
        let evaluated = evaluate(rows, &self.marks, self.settings, now);
        let moved = !self.marks.iter().eq(evaluated.marks.iter());
        self.marks = evaluated.marks;
        if moved {
            // A failed save may repeat a notice after restart. Keep checking the
            // current observations and avoid re-notifying in this process.
            let _ = self.save();
        }
        if self.settings.enabled {
            bundled(evaluated.notices)
        } else {
            vec![]
        }
    }
}
