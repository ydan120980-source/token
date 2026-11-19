use crate::{agent_catalog::builtin_agents, time::parse_iso};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fmt;

pub const MAX_SESSIONS: usize = 50_000;
pub const MAX_DAYS: usize = 4_000;
pub const COUNTS: [&str; 5] = [
    "totalTokens",
    "records",
    "partialRecords",
    "pricedTokens",
    "boundedTokens",
];
pub const NULLABLE: [&str; 7] = [
    "inputUncached",
    "output",
    "cacheRead",
    "cacheWrite",
    "reasoning",
    "estimatedCostUsd",
    "estimatedCostUpperUsd",
];
const ENTRIES: [&str; 6] = ["desktop", "cli", "sdk", "export", "harness", "unknown"];
const KNOWN: [&str; 6] = [
    "inputUncached",
    "output",
    "cacheRead",
    "cacheWrite",
    "reasoning",
    "outputPlain",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidSessionList;

impl fmt::Display for InvalidSessionList {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("INVALID_SESSION_LIST")
    }
}

impl std::error::Error for InvalidSessionList {}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDay {
    pub date: String,
    pub total_tokens: f64,
    pub records: f64,
    pub partial_records: f64,
    pub priced_tokens: f64,
    pub bounded_tokens: f64,
    pub input_uncached: Option<f64>,
    pub output: Option<f64>,
    pub cache_read: Option<f64>,
    pub cache_write: Option<f64>,
    pub reasoning: Option<f64>,
    pub estimated_cost_usd: Option<f64>,
    pub estimated_cost_upper_usd: Option<f64>,
    pub known_usage: Map<String, Value>,
}

impl SessionDay {
    pub(crate) fn counts(&self) -> [f64; 5] {
        [
            self.total_tokens,
            self.records,
            self.partial_records,
            self.priced_tokens,
            self.bounded_tokens,
        ]
    }

    pub(crate) fn nullable(&self) -> [Option<f64>; 7] {
        [
            self.input_uncached,
            self.output,
            self.cache_read,
            self.cache_write,
            self.reasoning,
            self.estimated_cost_usd,
            self.estimated_cost_upper_usd,
        ]
    }
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub key: String,
    pub agent: String,
    pub entries: Vec<String>,
    pub models: Vec<String>,
    pub start: String,
    pub end: String,
    pub id: Option<String>,
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub project: Option<String>,
    pub resumable: bool,
    pub days: Vec<SessionDay>,
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionList {
    pub schema_version: String,
    pub sequence: f64,
    pub timezone: String,
    pub today: Option<String>,
    pub sessions: Vec<SessionRow>,
    pub unattributed: Map<String, Value>,
}

pub fn valid_key(key: &str) -> bool {
    key.len() == 64
        && key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn text(value: &Value, limit: usize) -> Option<&str> {
    let text = value.as_str()?;
    (!text.is_empty()
        && text.encode_utf16().count() <= limit
        && !text.bytes().any(|byte| byte <= 31 || byte == 127))
    .then_some(text)
}

fn date_shape(date: &str) -> bool {
    date.len() == 10
        && date.bytes().enumerate().all(|(index, byte)| match index {
            4 | 7 => byte == b'-',
            _ => byte.is_ascii_digit(),
        })
}

fn date(value: &Value) -> Option<&str> {
    value.as_str().filter(|date| date_shape(date))
}

fn time(value: &Value) -> Option<String> {
    let time = value.as_str().filter(|time| time.len() <= 40)?;
    let parsed = parse_iso(time).or_else(|| {
        let (head, tail) = time.split_at_checked(16)?;
        if !matches!(
            tail.as_bytes().first(),
            None | Some(b'Z' | b'z' | b'+' | b'-')
        ) {
            return None;
        }
        parse_iso(&format!("{head}:00{tail}"))
    });
    parsed.map(|_| time.to_owned())
}

fn count(value: &Value) -> Result<f64, InvalidSessionList> {
    value
        .as_f64()
        .filter(|number| number.is_finite() && *number >= 0.0)
        .ok_or(InvalidSessionList)
}

fn required_count(value: &Value) -> Result<f64, InvalidSessionList> {
    if value.is_null() {
        Ok(0.0)
    } else {
        count(value)
    }
}

fn nullable_count(value: &Value) -> Result<Option<f64>, InvalidSessionList> {
    if value.is_null() {
        Ok(None)
    } else {
        count(value).map(Some)
    }
}

pub(crate) fn known_usage(value: &Value) -> Map<String, Value> {
    value
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(key, amount)| KNOWN.contains(&key.as_str()) && count(amount).is_ok())
        .map(|(key, amount)| (key.to_owned(), amount.to_owned()))
        .collect()
}

pub(crate) fn select_day<'a>(
    date_value: &Value,
    fields: impl Fn(usize, &str) -> &'a Value,
    usage: Map<String, Value>,
) -> Result<SessionDay, InvalidSessionList> {
    let date = date(date_value).ok_or(InvalidSessionList)?.to_owned();
    let mut counts = [0.0; COUNTS.len()];
    let mut nullable = [None; NULLABLE.len()];
    for (index, key) in COUNTS.iter().enumerate() {
        counts[index] = required_count(fields(index, key))?;
    }
    for (index, key) in NULLABLE.iter().enumerate() {
        nullable[index] = nullable_count(fields(COUNTS.len() + index, key))?;
    }
    let [total_tokens, records, partial_records, priced_tokens, bounded_tokens] = counts;
    let [input_uncached, output, cache_read, cache_write, reasoning, estimated_cost_usd, estimated_cost_upper_usd] =
        nullable;
    Ok(SessionDay {
        date,
        total_tokens,
        records,
        partial_records,
        priced_tokens,
        bounded_tokens,
        input_uncached,
        output,
        cache_read,
        cache_write,
        reasoning,
        estimated_cost_usd,
        estimated_cost_upper_usd,
        known_usage: usage,
    })
}

pub(crate) fn select_row(
    raw: &Value,
    catalog: &Map<String, Value>,
) -> Result<SessionRow, InvalidSessionList> {
    let key = raw["key"]
        .as_str()
        .filter(|key| valid_key(key))
        .ok_or(InvalidSessionList)?;
    let agent = raw["agent"]
        .as_str()
        .filter(|agent| catalog.contains_key(*agent))
        .ok_or(InvalidSessionList)?;
    let days = raw["days"]
        .as_array()
        .filter(|days| days.len() <= MAX_DAYS)
        .ok_or(InvalidSessionList)?;
    let start = time(&raw["start"]).ok_or(InvalidSessionList)?;
    let end = time(&raw["end"]).ok_or(InvalidSessionList)?;
    let mut entries = Vec::<String>::new();
    for entry in raw["entries"].as_array().into_iter().flatten() {
        let entry = entry
            .as_str()
            .filter(|entry| ENTRIES.contains(entry))
            .unwrap_or("unknown");
        if !entries.iter().any(|previous| previous == entry) {
            entries.push(entry.to_owned());
        }
    }
    let models = raw["models"]
        .as_array()
        .into_iter()
        .flatten()
        .take(24)
        .map(|model| text(model, 180).unwrap_or("模型未记录").to_owned())
        .collect();
    let days = days
        .iter()
        .map(|day| {
            select_day(
                &day["date"],
                |_, key| &day[key],
                known_usage(&day["knownUsage"]),
            )
        })
        .collect::<Result<_, _>>()?;
    Ok(SessionRow {
        key: key.to_owned(),
        agent: agent.to_owned(),
        entries,
        models,
        start,
        end,
        id: text(&raw["id"], 200).map(str::to_owned),
        cwd: text(&raw["cwd"], 1024).map(str::to_owned),
        title: text(&raw["title"], 200).map(str::to_owned),
        project: text(&raw["project"], 260).map(str::to_owned),
        resumable: raw["resumable"].as_bool() == Some(true),
        days,
    })
}

pub(crate) fn select_header(
    raw: &Value,
    catalog: &Map<String, Value>,
) -> Result<SessionList, InvalidSessionList> {
    if raw["schemaVersion"] != "SessionListV1" {
        return Err(InvalidSessionList);
    }
    let unattributed = raw["unattributed"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(agent, _)| catalog.contains_key(*agent))
        .filter_map(|(agent, days)| {
            let days = days.as_object()?;
            let selected = days
                .iter()
                .filter(|(key, value)| {
                    date_shape(key)
                        && value.as_f64().is_some_and(|count| {
                            count > 0.0 && count <= 9_007_199_254_740_991.0 && count.fract() == 0.0
                        })
                })
                .map(|(key, count)| (key.to_owned(), count.to_owned()))
                .collect();
            Some((agent.to_owned(), Value::Object(selected)))
        })
        .collect();
    Ok(SessionList {
        schema_version: "SessionListV1".to_owned(),
        sequence: required_count(&raw["sequence"])?,
        timezone: text(&raw["timezone"], 64)
            .unwrap_or("Asia/Shanghai")
            .to_owned(),
        today: date(&raw["today"]).map(str::to_owned),
        sessions: Vec::new(),
        unattributed,
    })
}

/// Select the renderer-facing session facts, dropping all fields outside its whitelist.
pub fn select_sessions(
    raw: &Value,
    catalog: Option<&Value>,
) -> Result<SessionList, InvalidSessionList> {
    let builtin;
    let catalog = match catalog {
        Some(catalog) => catalog,
        None => {
            builtin = builtin_agents();
            &builtin
        }
    }
    .as_object()
    .ok_or(InvalidSessionList)?;
    let sessions = raw["sessions"]
        .as_array()
        .filter(|sessions| sessions.len() <= MAX_SESSIONS)
        .ok_or(InvalidSessionList)?;
    let mut list = select_header(raw, catalog)?;
    list.sessions = sessions
        .iter()
        .map(|row| select_row(row, catalog))
        .collect::<Result<_, _>>()?;
    Ok(list)
}
