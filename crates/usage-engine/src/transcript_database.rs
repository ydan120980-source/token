use crate::transcript_sources::placed_directory;
use crate::{
    policy::Audit,
    sqlite_memory,
    transcript::{ReaderError, TranscriptControl},
    transcript_events::string,
    transcript_lines::{self, JsonlReader, SourceEpoch},
    transcript_sources::{
        list, path_name, placed_subagents, stamp_of, Decode, Format, Source, Sources, MAX_FILE,
    },
};
use rusqlite::{Connection, Row};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
};

const MAX_DATABASE: u64 = 1024 * 1024 * 1024;
const MAX_CHILDREN: usize = 256;

struct Conversation {
    side: Option<String>,
    rows: Vec<Value>,
}

fn sqlite_error(_: rusqlite::Error) -> String {
    "TRANSCRIPT_UNREADABLE".to_owned()
}

fn query<RowValue>(
    database: &Connection,
    sql: &str,
    key: &str,
    control: &TranscriptControl<'_>,
    mut visit: impl FnMut(&Row<'_>) -> Result<Option<RowValue>, rusqlite::Error>,
) -> Result<Vec<RowValue>, String> {
    let mut statement = database.prepare(sql).map_err(sqlite_error)?;
    let mut rows = statement.query([key]).map_err(sqlite_error)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(sqlite_error)? {
        control.check().map_err(|error| error.to_string())?;
        result.extend(visit(row).map_err(sqlite_error)?);
    }
    Ok(result)
}

fn columns(database: &Connection, table: &str) -> Result<HashSet<String>, String> {
    let mut statement = database
        .prepare("SELECT name FROM pragma_table_info(?1)")
        .map_err(sqlite_error)?;
    let names = statement
        .query_map([table], |row| row.get::<_, String>(0))
        .map_err(sqlite_error)?;
    names.collect::<Result<_, _>>().map_err(sqlite_error)
}

fn time(row: &Row<'_>, index: usize) -> Result<Value, rusqlite::Error> {
    use rusqlite::types::ValueRef;
    Ok(match row.get_ref(index)? {
        ValueRef::Integer(value) => json!(value),
        ValueRef::Real(value) => json!(value),
        ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
        _ => Value::Null,
    })
}

fn data(row: &Row<'_>, index: usize) -> Result<Value, rusqlite::Error> {
    use rusqlite::types::ValueRef;
    Ok(match row.get_ref(index)? {
        ValueRef::Text(value) => serde_json::from_slice(value).unwrap_or(Value::Null),
        _ => Value::Null,
    })
}

fn record(role: &str, at: Value, parts: Vec<Value>, mut data: Value) -> Value {
    let mut row = json!({
        "role": if role.is_empty() { "unknown" } else { role },
        "time": at, "parts": null, "tokens": data.get_mut("tokens").map(Value::take), "error": data.get_mut("error").map(Value::take),
    });
    row["parts"] = Value::Array(parts);
    row
}

fn text_part(value: &Value) -> Option<Vec<Value>> {
    value
        .as_str()
        .map(|text| vec![json!({"type": "text", "text": text})])
}

fn messages(
    database: &Connection,
    id: &str,
    control: &TranscriptControl<'_>,
) -> Result<Vec<Value>, String> {
    let session = columns(database, "session_message")?;
    if !session.is_empty() {
        let order = if session.contains("seq") {
            "seq, rowid"
        } else {
            "rowid"
        };
        let at = if session.contains("time_created") {
            "time_created"
        } else {
            "NULL"
        };
        let sql = format!(
            "SELECT type, {at}, data FROM session_message WHERE session_id = ?1 ORDER BY {order}"
        );
        let selected = query(database, &sql, id, control, |row| {
            let role: Option<String> = row.get(0)?;
            let role = role.as_deref().unwrap_or_default();
            let mut payload = data(row, 2)?;
            if !matches!(role, "user" | "assistant" | "system")
                || (!payload.is_object() && !payload.is_array())
            {
                return Ok(None);
            }
            let parts = matches!(role, "user" | "system")
                .then(|| text_part(&payload["text"]))
                .flatten()
                .unwrap_or_else(|| {
                    let part = payload
                        .get_mut("content")
                        .map(Value::take)
                        .unwrap_or_default();
                    if let Value::Array(parts) = part {
                        parts
                    } else {
                        text_part(&part)
                            .or_else(|| text_part(&payload["text"]))
                            .unwrap_or_default()
                    }
                });
            Ok(Some(record(role, time(row, 1)?, parts, payload)))
        })?;
        if !selected.is_empty() {
            return Ok(selected);
        }
    }
    let fields = columns(database, "message")?;
    if fields.is_empty() {
        return Ok(Vec::new());
    }
    let (at, order) = if fields.contains("time_created") {
        ("time_created", "time_created, id")
    } else {
        ("NULL", "rowid")
    };
    let sql = format!("SELECT id, {at}, data FROM message WHERE session_id = ?1 ORDER BY {order}");
    let rows = query(database, &sql, id, control, |row| {
        Ok(Some((
            row.get::<_, String>(0)?,
            time(row, 1)?,
            data(row, 2)?,
        )))
    })?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let part_fields = columns(database, "part")?;
    let mut mapped = HashMap::<String, Vec<Value>>::new();
    if !part_fields.is_empty() {
        let order = if part_fields.contains("time_created") {
            "time_created, id"
        } else {
            "rowid"
        };
        let sql =
            format!("SELECT message_id, data FROM part WHERE session_id = ?1 ORDER BY {order}");
        query::<()>(database, &sql, id, control, |row| {
            let payload = data(row, 1)?;
            if crate::normalize::truthy(&payload) {
                mapped
                    .entry(row.get::<_, String>(0)?)
                    .or_default()
                    .push(payload);
            }
            Ok(None)
        })?;
    }
    Ok(rows
        .into_iter()
        .map(|(id, at, payload)| {
            let at = if at.is_null() {
                payload["time"]["created"].to_owned()
            } else {
                at
            };
            let role = string(&payload["role"]).to_owned();
            record(&role, at, mapped.remove(&id).unwrap_or_default(), payload)
        })
        .collect())
}

fn conversation(
    database: &Connection,
    id: &str,
    control: &TranscriptControl<'_>,
) -> Result<Vec<Conversation>, String> {
    let main = messages(database, id, control)?;
    if main.is_empty() {
        return Ok(Vec::new());
    }
    let mut found = vec![Conversation {
        side: None,
        rows: main,
    }];
    if !columns(database, "session")?.contains("parent_id") {
        return Ok(found);
    }
    let mut seen = HashSet::from([id.to_owned()]);
    let mut queue = VecDeque::from([id.to_owned()]);
    while let Some(parent) = queue.pop_front() {
        if found.len() > MAX_CHILDREN {
            break;
        }
        let children = query(
            database,
            "SELECT id FROM session WHERE parent_id = ?1",
            &parent,
            control,
            |row| row.get::<_, Option<String>>(0),
        )?;
        for child in children {
            if seen.insert(child.to_owned()) {
                let rows = messages(database, &child, control)?;
                queue.push_back(child.to_owned());
                found.push(Conversation {
                    side: Some(child),
                    rows,
                });
            }
        }
    }
    Ok(found)
}

fn databases(
    format: Format,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<Vec<PathBuf>, ReaderError> {
    let extension = if format == Format::ZCode {
        "sqlite"
    } else {
        "db"
    };
    let mut files = Vec::new();
    for root in roots {
        control.check()?;
        files.extend(
            list(format.name(), root)
                .into_iter()
                .filter(|file| file.extension().is_some_and(|suffix| suffix == extension)),
        );
    }
    Ok(files)
}

fn database_deps(file: PathBuf) -> Vec<PathBuf> {
    let mut wal = file.as_os_str().to_owned();
    wal.push("-wal");
    vec![file, PathBuf::from(wal)]
}

fn epochs(paths: impl IntoIterator<Item = PathBuf>) -> Vec<(PathBuf, Option<SourceEpoch>)> {
    paths
        .into_iter()
        .map(|file| {
            let epoch = transcript_lines::epoch(&file).ok();
            (file, epoch)
        })
        .collect()
}

fn virtual_sources(
    format: Format,
    rows: Vec<Conversation>,
    dependencies: Vec<(PathBuf, Option<SourceEpoch>)>,
) -> Sources {
    let sources = rows
        .into_iter()
        .map(|Conversation { side, rows }| Source {
            path: PathBuf::new(),
            epoch: None,
            decode: Decode::OpenFamily(format),
            side,
            rows: Some(rows),
            plan: None,
        })
        .collect();
    Sources {
        format,
        sources,
        dependencies,
    }
}

struct Legacy {
    messages: Vec<PathBuf>,
    parts: Vec<PathBuf>,
}

fn legacy_files(
    format: Format,
    id: &str,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<Legacy, ReaderError> {
    let mut legacy = Legacy {
        messages: Vec::new(),
        parts: Vec::new(),
    };
    if !matches!(format, Format::OpenCode | Format::MiMo) {
        return Ok(legacy);
    }
    for root in roots {
        control.check()?;
        let parent = Path::new(root);
        if !parent.is_absolute()
            || parent.is_file()
            || parent
                .symlink_metadata()
                .is_ok_and(|meta| meta.file_type().is_symlink())
        {
            continue;
        }
        let mut places = vec![(vec!["storage"], false)];
        let mut projects: Vec<_> = placed_directory(parent, &["project"])
            .and_then(|directory| directory.read_dir().ok())
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        projects.sort();
        places.extend(projects.iter().map(|project| {
            (
                vec!["project", project.as_str(), "storage", "session"],
                true,
            )
        }));
        for (place, old) in places {
            control.check()?;
            let mut path = place.to_owned();
            path.extend(["message", id]);
            let mut messages = placed_subagents(parent, &path, "transcript:legacy");
            messages.sort();
            for message in &messages {
                let mut parts = place.to_owned();
                parts.push("part");
                if old {
                    parts.push(id);
                }
                parts.push(path_name(message));
                let mut files = placed_subagents(parent, &parts, "transcript:legacy");
                files.sort();
                legacy.parts.extend(files);
            }
            legacy.messages.extend(messages);
        }
    }
    Ok(legacy)
}

fn file_document(file: &Path) -> Option<Value> {
    let mut reader = JsonlReader::open(file, MAX_FILE).ok()?;
    reader.read_document().ok().flatten()
}

fn legacy_rows(
    legacy: &Legacy,
    control: &TranscriptControl<'_>,
) -> Result<Vec<Value>, ReaderError> {
    let mut held = HashMap::<&str, Vec<Value>>::new();
    for file in &legacy.parts {
        control.check()?;
        if let Some((parent, part)) = file
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .zip(file_document(file))
        {
            held.entry(parent).or_default().push(part);
        }
    }
    let mut rows = Vec::new();
    for file in &legacy.messages {
        control.check()?;
        if let Some(message) = file_document(file) {
            let role = string(&message["role"]).to_owned();
            let key = path_name(file);
            let parts = held.remove(key).unwrap_or_default();
            rows.push(record(
                &role,
                message["time"]["created"].to_owned(),
                parts,
                message,
            ));
        }
    }
    Ok(rows)
}

pub fn resolve(
    format: Format,
    id: &str,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<Sources, ReaderError> {
    for file in databases(format, roots, control)? {
        control.check()?;
        let file_name = file.to_str().ok_or(ReaderError::Unreadable)?.to_owned();
        let dependencies = epochs(database_deps(file));
        if dependencies[0]
            .1
            .is_some_and(|epoch| epoch.length > MAX_DATABASE)
        {
            return Err(ReaderError::TooLarge);
        }
        if !admissible(&dependencies) {
            return Err(ReaderError::Unreadable);
        }
        let rows = sqlite_memory::read_database(&file_name, &mut Audit::new(), &mut |database| {
            conversation(database, id, control)
        })
        .map_err(|error| {
            if error == "SOURCE_BUSY" {
                ReaderError::Changed
            } else {
                ReaderError::Unreadable
            }
        })?;
        if !rows.is_empty() {
            let sources = virtual_sources(format, rows, dependencies);
            sources.verify()?;
            return Ok(sources);
        }
    }
    let legacy = legacy_files(format, id, roots, control)?;
    if legacy.messages.is_empty() {
        return Err(ReaderError::NotFound);
    }
    let dependencies = epochs(legacy.messages.iter().chain(&legacy.parts).cloned());
    let rows = legacy_rows(&legacy, control)?;
    let sources = virtual_sources(
        format,
        vec![Conversation { side: None, rows }],
        dependencies,
    );
    sources.verify()?;
    Ok(sources)
}

pub fn stamp_now(
    format: Format,
    id: &str,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<String, ReaderError> {
    let files = databases(format, roots, control)?;
    let files: Vec<_> = if files.is_empty() {
        let legacy = legacy_files(format, id, roots, control)?;
        legacy.messages.into_iter().chain(legacy.parts).collect()
    } else {
        files.into_iter().flat_map(database_deps).collect()
    };
    if files.is_empty() {
        return Ok("-".to_owned());
    }
    Ok(stamp_of(epochs(files).into_iter().map(|(_, epoch)| epoch)))
}

pub fn scan_databases<Output>(
    format: Format,
    roots: &[String],
    selected: &[(usize, &str)],
    control: &TranscriptControl<'_>,
    mut read: impl FnMut(usize, Sources) -> Result<Output, ReaderError>,
) -> Result<HashMap<usize, Output>, ReaderError> {
    let mut found = HashMap::new();
    for file in databases(format, roots, control)? {
        control.check()?;
        if found.len() == selected.len() {
            break;
        }
        let Some(name) = file.to_str().map(str::to_owned) else {
            continue;
        };
        let dependencies = epochs(database_deps(file));
        if !admissible(&dependencies) {
            continue;
        }
        let rows = sqlite_memory::read_database(&name, &mut Audit::new(), &mut |database| {
            let mut results = Vec::new();
            for &(index, id) in selected {
                control.check().map_err(|error| error.to_string())?;
                if found.contains_key(&index) {
                    continue;
                }
                let rows = conversation(database, id, control)?;
                if rows.is_empty() {
                    continue;
                }
                let temporary = virtual_sources(format, rows, dependencies.to_owned());
                match read(index, temporary) {
                    Ok(result) => results.push((index, result)),
                    Err(error) if error == ReaderError::Changed => return Err(error.to_string()),
                    Err(_) => {}
                }
            }
            Ok(results)
        });
        control.check()?;
        if let Ok(rows) = rows {
            if dependencies
                .iter()
                .all(|(path, epoch)| transcript_lines::epoch(path).ok() == *epoch)
            {
                found.extend(rows);
            }
        }
    }
    if matches!(format, Format::OpenCode | Format::MiMo) {
        for &(index, id) in selected {
            control.check()?;
            if found.contains_key(&index) {
                continue;
            }
            let legacy = legacy_files(format, id, roots, control)?;
            if legacy.messages.is_empty() {
                continue;
            }
            let dependencies = epochs(legacy.messages.iter().chain(&legacy.parts).cloned());
            let rows = legacy_rows(&legacy, control)?;
            let sources = virtual_sources(
                format,
                vec![Conversation { side: None, rows }],
                dependencies,
            );
            if let Ok(result) = read(index, sources) {
                found.insert(index, result);
            }
        }
    }
    Ok(found)
}

fn admissible(dependencies: &[(PathBuf, Option<SourceEpoch>)]) -> bool {
    let [(_, Some(epoch)), (wal, wal_epoch)] = dependencies else {
        return false;
    };
    epoch.length <= MAX_DATABASE
        && (wal_epoch.is_some()
            || wal
                .symlink_metadata()
                .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound))
}
