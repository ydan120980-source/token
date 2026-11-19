use crate::{
    agent_catalog::builtin_agents,
    js_json,
    session_list::{
        self, InvalidSessionList, SessionList, COUNTS, MAX_DAYS, MAX_SESSIONS, NULLABLE,
    },
};
use indexmap::{IndexMap, IndexSet};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::borrow::Borrow;

const FRAME: &str = "SessionListWireV1";
const BYTE_SCHEMA: &str = "SessionListBytesV1";
const DAY_WIDTH: usize = COUNTS.len() + NULLABLE.len() + 2;

/// A binary payload. The host transports the bytes as a buffer, not a JSON array.
#[derive(Debug, PartialEq, Eq)]
pub struct SessionListBytes {
    pub schema_version: &'static str,
    pub session_bytes: Vec<u8>,
}

#[derive(Default)]
struct Dictionaries {
    strings: IndexSet<String>,
    arrays: IndexSet<Vec<i64>>,
    usage: IndexMap<String, Map<String, Value>>,
}

impl Dictionaries {
    fn string(&mut self, value: Option<String>) -> i64 {
        value.map_or(-1, |value| self.strings.insert_full(value).0 as i64)
    }

    fn array(&mut self, values: Vec<String>) -> usize {
        let ids = values
            .into_iter()
            .map(|value| self.string(Some(value)))
            .collect();
        self.arrays.insert_full(ids).0
    }

    fn usage(&mut self, value: Map<String, Value>) -> usize {
        let signature = js_json::stringify(&json!(value));
        match self.usage.get_index_of(&signature) {
            Some(index) => index,
            None => self.usage.insert_full(signature, value).0,
        }
    }
}

/// Pack already-saved facts into the legacy session-list wire frame.
pub fn pack(
    source: &Value,
    catalog: Option<&Value>,
) -> Result<SessionListBytes, InvalidSessionList> {
    let sessions = source["sessions"]
        .as_array()
        .filter(|items| items.len() <= MAX_SESSIONS)
        .ok_or(InvalidSessionList)?;
    pack_iterable(source, sessions, catalog)
}

/// Select and pack one row at a time without materializing a second session list.
pub fn pack_iterable<Row: Borrow<Value>>(
    source: &Value,
    sessions: impl IntoIterator<Item = Row>,
    catalog: Option<&Value>,
) -> Result<SessionListBytes, InvalidSessionList> {
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
    let header = session_list::select_header(source, catalog)?;
    let mut agents: IndexSet<String> = header.unattributed.keys().cloned().collect();
    let mut dictionary = Dictionaries::default();
    let (mut rows, mut days) = (Vec::new(), Vec::new());
    for raw in sessions {
        if rows.len() >= MAX_SESSIONS {
            return Err(InvalidSessionList);
        }
        let row = session_list::select_row(raw.borrow(), catalog)?;
        agents.insert(row.agent.to_owned());
        let begin = days.len();
        for day in row.days {
            let mut cells = Vec::with_capacity(DAY_WIDTH);
            let counts = day.counts();
            let nullable = day.nullable();
            cells.push(json!(dictionary.string(Some(day.date))));
            cells.extend(counts.into_iter().map(|count| json!(count)));
            cells.extend(nullable.into_iter().map(|count| json!(count)));
            cells.push(json!(dictionary.usage(day.known_usage)));
            days.push(Value::Array(cells));
        }
        rows.push(json!([
            dictionary.string(Some(row.key)),
            dictionary.string(Some(row.agent)),
            dictionary.array(row.entries),
            dictionary.array(row.models),
            dictionary.string(Some(row.start)),
            dictionary.string(Some(row.end)),
            dictionary.string(row.id),
            dictionary.string(row.cwd),
            dictionary.string(row.title),
            dictionary.string(row.project),
            row.resumable,
            begin,
            days.len() - begin
        ]));
    }
    let mut header = serde_json::to_value(header).map_err(|_| InvalidSessionList)?;
    header
        .as_object_mut()
        .ok_or(InvalidSessionList)?
        .shift_remove("sessions");
    let frame = Value::Object(Map::from_iter([
        ("schemaVersion".to_owned(), json!(FRAME)),
        ("header".to_owned(), header),
        (
            "agents".to_owned(),
            Value::Array(agents.into_iter().map(Value::String).collect()),
        ),
        (
            "strings".to_owned(),
            Value::Array(dictionary.strings.into_iter().map(Value::String).collect()),
        ),
        (
            "arrays".to_owned(),
            json!(dictionary.arrays.into_iter().collect::<Vec<_>>()),
        ),
        (
            "usage".to_owned(),
            Value::Array(dictionary.usage.into_values().map(Value::Object).collect()),
        ),
        ("rows".to_owned(), Value::Array(rows)),
        ("days".to_owned(), Value::Array(days)),
    ]));
    Ok(SessionListBytes {
        schema_version: BYTE_SCHEMA,
        session_bytes: js_json::stringify(&frame).into_bytes(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    schema_version: String,
    header: Value,
    agents: Vec<Value>,
    strings: Vec<Value>,
    arrays: Vec<Value>,
    usage: Vec<Value>,
    rows: Vec<Vec<Value>>,
    days: Vec<Vec<Value>>,
}

fn index(value: &Value) -> Option<usize> {
    let numeric = value.as_f64()?;
    if numeric < 0.0 || numeric > 9_007_199_254_740_991.0 || numeric.fract() != 0.0 {
        return None;
    }
    let integer = numeric as u64;
    usize::try_from(integer).ok()
}

fn string<'a>(value: &Value, strings: &'a [Value]) -> Result<&'a Value, InvalidSessionList> {
    if value.as_f64() == Some(-1.0) {
        return Ok(&Value::Null);
    }
    let string = index(value)
        .and_then(|index| strings.get(index))
        .filter(|value| value.is_string());
    string.ok_or(InvalidSessionList)
}

fn array(value: &Value, arrays: &[Value], strings: &[Value]) -> Result<Value, InvalidSessionList> {
    let items = index(value)
        .and_then(|index| arrays.get(index))
        .and_then(Value::as_array)
        .ok_or(InvalidSessionList)?;
    items
        .iter()
        .map(|item| string(item, strings).cloned())
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

/// Decode a complete frame, with no partial result after a validation failure.
pub fn unpack(schema_version: &str, bytes: &[u8]) -> Result<SessionList, InvalidSessionList> {
    if schema_version != BYTE_SCHEMA {
        return Err(InvalidSessionList);
    }
    let Frame {
        schema_version,
        header,
        agents,
        strings,
        arrays,
        usage,
        rows,
        days,
    } = serde_json::from_slice(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes))
        .map_err(|_| InvalidSessionList)?;
    if schema_version != FRAME || rows.len() > MAX_SESSIONS {
        return Err(InvalidSessionList);
    }
    let catalog: Map<_, _> = agents
        .iter()
        .map(|agent| {
            session_list::text(agent, 200)
                .map(|agent| (agent.to_owned(), Value::Null))
                .ok_or(InvalidSessionList)
        })
        .collect::<Result<_, _>>()?;
    let mut output = session_list::select_header(&header, &catalog)?;
    output.sessions.reserve(rows.len());
    let mut days = days.into_iter();
    let mut cursor = 0;
    let mut usage_maps = std::collections::HashMap::new();
    for row in rows {
        if row.len() != 13 || index(&row[11]) != Some(cursor) {
            return Err(InvalidSessionList);
        }
        let count = index(&row[12])
            .filter(|count| *count <= MAX_DAYS && *count <= days.len())
            .ok_or(InvalidSessionList)?;
        let header = json!({
            "key": string(&row[0], &strings)?, "agent": string(&row[1], &strings)?,
            "entries": array(&row[2], &arrays, &strings)?, "models": array(&row[3], &arrays, &strings)?,
            "start": string(&row[4], &strings)?, "end": string(&row[5], &strings)?,
            "id": string(&row[6], &strings)?, "cwd": string(&row[7], &strings)?,
            "title": string(&row[8], &strings)?, "project": string(&row[9], &strings)?,
            "resumable": row[10], "days": []
        });
        let mut selected = session_list::select_row(&header, &catalog)?;
        selected.days.reserve(count);
        for day in days.by_ref().take(count) {
            if day.len() != DAY_WIDTH {
                return Err(InvalidSessionList);
            }
            let id = index(&day[DAY_WIDTH - 1])
                .filter(|id| *id < usage.len())
                .ok_or(InvalidSessionList)?;
            let usage = usage_maps
                .entry(id)
                .or_insert_with(|| session_list::known_usage(&usage[id]));
            let date = string(&day[0], &strings)?;
            selected.days.push(session_list::select_day(
                date,
                |position, _| &day[position + 1],
                usage.to_owned(),
            )?);
        }
        cursor += count;
        output.sessions.push(selected);
    }
    if days.next().is_some() {
        return Err(InvalidSessionList);
    }
    Ok(output)
}
