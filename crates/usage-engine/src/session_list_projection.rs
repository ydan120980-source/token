use crate::{
    session_aggregate::add_session,
    session_list::{self, SessionList, MAX_SESSIONS},
    session_list_codec::{self, SessionListBytes},
    sessions::{project_name, resume_command},
    store::Store,
    time::now_ms,
    usage_math::{local_day, start_for},
    usage_projection::Calendar,
    valuation::Pricing,
};
use indexmap::{IndexMap, IndexSet};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const INVALID_SELECTION: &str = "SESSION_SELECTION_INVALID";
const RECENT_PER_AGENT: usize = 5;

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub count: usize,
    pub agents: IndexMap<String, usize>,
    pub date: String,
    pub model: String,
}

fn day_shape(day: &str) -> bool {
    day.len() == 10
        && day.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 4 | 7) {
                byte == b'-'
            } else {
                byte.is_ascii_digit()
            }
        })
}

fn session_key(record: &Value) -> Option<&str> {
    record["sessionKey"].as_str().filter(|key| !key.is_empty())
}

struct Selection<'a> {
    range: &'a str,
    recent: bool,
}

impl<'a> TryFrom<&'a Value> for Selection<'a> {
    type Error = String;

    fn try_from(raw: &'a Value) -> Result<Self, Self::Error> {
        let rejected = || INVALID_SELECTION.to_owned();
        let fields = raw.as_object().ok_or_else(rejected)?;
        if fields
            .keys()
            .any(|key| !matches!(key.as_str(), "range" | "recent"))
        {
            return Err(rejected());
        }
        let range = match fields.get("range") {
            None => "all",
            Some(value) => value
                .as_str()
                .filter(|range| matches!(*range, "today" | "7" | "30" | "all"))
                .ok_or_else(rejected)?,
        };
        let recent = match fields.get("recent") {
            None => false,
            Some(value) => value.as_bool().ok_or_else(rejected)?,
        };
        Ok(Self { range, recent })
    }
}

struct Group<'a> {
    agent: &'a str,
    start: &'a str,
    end: &'a str,
    records: Vec<&'a Value>,
    meta_only: bool,
}

fn timestamp(record: &Value) -> &str {
    record["timestamp"].as_str().unwrap_or_default()
}

fn agent(record: &Value) -> &str {
    record["agent"].as_str().unwrap_or_default()
}

fn window(from: &str, to: &str, all: bool, day: &str) -> bool {
    all || (from <= day && day <= to)
}

fn lexical(left: &&str, right: &&str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn project<'a>(
    store: &'a Store,
    mut pricing: Pricing,
    selection: Selection<'_>,
) -> (Value, impl Iterator<Item = Value> + 'a) {
    let timezone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_owned());
    let today = local_day(&timezone, now_ms());
    let from = start_for(&today, selection.range, None);
    let all = selection.range == "all";
    let mut calendar = Calendar::new(&timezone);
    let mut groups = IndexMap::<&str, Group<'_>>::new();
    let mut unattributed = IndexMap::<&str, IndexMap<String, u64>>::new();
    for record in store.record_refs() {
        let agent = agent(record);
        let stamp = timestamp(record);
        if let Some(key) = record["sessionKey"].as_str().filter(|key| !key.is_empty()) {
            let group = groups.entry(key).or_insert_with(|| Group {
                agent,
                start: stamp,
                end: stamp,
                records: Vec::new(),
                meta_only: false,
            });
            group.start = group.start.min(stamp);
            group.end = group.end.max(stamp);
            if !selection.recent {
                group.records.push(record);
            }
        } else {
            let date = calendar.at(stamp).0;
            if window(&from, &today, all, &date) {
                *unattributed
                    .entry(agent)
                    .or_default()
                    .entry(date)
                    .or_default() += 1;
            }
        }
    }
    let saved = &store.state["sessions"];
    if selection.recent {
        let mut ordered: Vec<_> = groups.into_iter().collect();
        ordered.sort_by(|(_, left), (_, right)| right.end.cmp(left.end));
        let mut counts = HashMap::<&str, usize>::new();
        groups = ordered
            .into_iter()
            .filter(|(_, group)| {
                let count = counts.entry(group.agent).or_default();
                *count += 1;
                *count <= RECENT_PER_AGENT
            })
            .collect();
        for record in store.record_refs() {
            if let Some(group) = record["sessionKey"]
                .as_str()
                .and_then(|key| groups.get_mut(key))
            {
                group.records.push(record);
            }
        }
    } else {
        for (key, meta) in saved.as_object().into_iter().flatten() {
            let Some(stamp) = meta["at"].as_str().filter(|stamp| !stamp.is_empty()) else {
                continue;
            };
            groups.entry(key).or_insert_with(|| Group {
                agent: agent(meta),
                start: stamp,
                end: stamp,
                records: Vec::new(),
                meta_only: true,
            });
        }
    }
    let unattributed: Map<_, _> = unattributed
        .into_iter()
        .map(|(agent, days)| {
            (
                agent.to_owned(),
                Value::Object(
                    days.into_iter()
                        .map(|(date, count)| (date, json!(count)))
                        .collect(),
                ),
            )
        })
        .collect();
    let header = json!({
        "schemaVersion": "SessionListV1", "sequence": store.state["sequence"], "timezone": timezone,
        "today": today, "unattributed": unattributed
    });
    let rows = groups.into_iter().map(move |(key, group)| {
        let mut entries = IndexSet::new();
        let mut models = IndexSet::new();
        let mut days = Map::new();
        if group.meta_only {
            let date = calendar.at(group.start).0;
            if window(&from, &today, all, &date) { days.insert(date.to_owned(), json!({"date": date})); }
        }
        for record in group.records {
            entries.extend(record["entry"].as_str());
            models.extend(record["model"].as_str());
            let date = calendar.at(timestamp(record)).0;
            if window(&from, &today, all, &date) {
                add_session(&mut days, &date, record, &pricing.estimate(record));
            }
        }
        let mut entries: Vec<_> = entries.into_iter().collect();
        entries.sort_by(lexical);
        let mut models: Vec<_> = models.into_iter().collect();
        models.sort_by(lexical);
        let mut days: Vec<_> = days.into_iter().collect();
        days.sort_by(|(left, _), (right, _)| left.cmp(right));
        let days: Vec<_> = days.into_iter().map(|(_, day)| day).collect();
        let meta = saved.get(key).filter(|meta| meta["agent"] == group.agent).unwrap_or(&Value::Null);
        json!({
            "key": key, "agent": group.agent, "entries": entries, "models": models, "start": group.start, "end": group.end,
            "id": meta["id"], "cwd": meta["cwd"], "title": meta["title"], "project": project_name(meta["cwd"].as_str()),
            "resumable": resume_command(group.agent, Some(meta)).is_some(), "days": days
        })
    });
    (header, rows)
}

impl Store {
    pub fn session_summary(&self, selection: &Value) -> Result<SessionSummary, String> {
        let rejected = || INVALID_SELECTION.to_owned();
        let selection = selection.as_object().ok_or_else(rejected)?;
        let option = |key| {
            selection
                .get(key)
                .map(|value| value.as_str().ok_or_else(rejected))
                .transpose()
        };
        let timezone = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".to_owned());
        let today = local_day(&timezone, now_ms());
        let date = option("date")?.unwrap_or(&today);
        let selected_agent = option("agent")?.unwrap_or("all");
        let model = option("model")?.unwrap_or("all");
        if !day_shape(date)
            || model.encode_utf16().count() > 180
            || (selected_agent != "all" && self.catalog().get(selected_agent).is_none())
        {
            return Err(rejected());
        }
        // The model filter applies to the session across its lifetime. The date
        // still needs at least one ledger row for that session, of any model.
        let selected = (model != "all").then(|| {
            self.record_refs()
                .filter(|record| record["model"] == model)
                .filter_map(session_key)
                .collect::<IndexSet<_>>()
        });
        let mut calendar = Calendar::new(&timezone);
        let mut sessions = IndexMap::new();
        for record in self.record_refs() {
            if let Some(key) = session_key(record) {
                if selected.as_ref().is_none_or(|keys| keys.contains(key))
                    && calendar.at(timestamp(record)).0 == date
                {
                    sessions.insert(key, agent(record));
                }
            }
        }
        let mut by_agent = IndexMap::new();
        for agent in sessions
            .into_values()
            .filter(|agent| selected_agent == "all" || *agent == selected_agent)
        {
            *by_agent.entry(agent.to_owned()).or_default() += 1;
        }
        Ok(SessionSummary {
            count: by_agent.values().sum(),
            agents: by_agent,
            date: date.to_owned(),
            model: model.to_owned(),
        })
    }

    /// Project saved session facts only; never open a transcript or export the raw identity.
    pub fn session_list(&mut self, selection: &Value) -> Result<SessionList, String> {
        let selected = Selection::try_from(selection)?;
        let pricing = self.current_pricing();
        let catalog = self.catalog();
        let catalog = catalog
            .as_object()
            .ok_or_else(|| session_list::InvalidSessionList.to_string())?;
        let (header, rows) = project(self, pricing, selected);
        let mut output =
            session_list::select_header(&header, catalog).map_err(|error| error.to_string())?;
        for row in rows {
            if output.sessions.len() >= MAX_SESSIONS {
                return Err(session_list::InvalidSessionList.to_string());
            }
            output
                .sessions
                .push(session_list::select_row(&row, catalog).map_err(|error| error.to_string())?);
        }
        Ok(output)
    }

    /// Encode one projected row at a time without keeping a separate session list or cache.
    pub fn session_list_packed(&mut self, selection: &Value) -> Result<SessionListBytes, String> {
        let selected = Selection::try_from(selection)?;
        let pricing = self.current_pricing();
        let catalog = self.catalog();
        let (header, rows) = project(self, pricing, selected);
        session_list_codec::pack_iterable(&header, rows, Some(&catalog))
            .map_err(|error| error.to_string())
    }
}
