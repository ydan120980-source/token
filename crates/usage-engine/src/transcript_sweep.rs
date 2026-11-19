use super::{
    units, utf16_slice, Body, IndexedText, Matcher, ReaderError, Replay, Session, TranscriptControl,
};
use crate::{
    js_json,
    sessions::js_trim,
    transcript_sources::{file_index, valid_id, Format, Sources},
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    ops::ControlFlow,
    path::PathBuf,
    time::{Duration, Instant},
};

pub const DEFAULT_BUDGET: Duration = Duration::from_secs(6);
const SNIPPETS: usize = 3;
const BEFORE: usize = 36;
const AFTER: usize = 72;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub key: String,
    pub agent: String,
    pub id: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTarget {
    pub path: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch<ResultRow> {
    pub results: Vec<ResultRow>,
    pub scanned: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub key: String,
    pub hits: usize,
    pub snippets: Vec<Snippet>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub kind: String,
    pub before: String,
    pub r#match: String,
    pub after: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    pub key: String,
    pub exact: bool,
    pub path: String,
    pub added: usize,
    pub removed: usize,
    pub calls: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolHit {
    pub key: String,
    pub mcp: Map<String, Value>,
    pub skill: Map<String, Value>,
}

pub(crate) fn allowed_text(text: &str, max: usize) -> bool {
    !js_trim(text).is_empty()
        && units(text) <= max
        && !text.bytes().any(|byte| byte < 32 || byte == 127)
}

fn forms(needle: &str) -> Vec<String> {
    use std::fmt::Write;
    let quoted = js_json::stringify(&json!(needle));
    let escaped = quoted[1..quoted.len() - 1].to_lowercase();
    let mut ascii = String::new();
    for unit in escaped.encode_utf16() {
        if (0x20..=0x7e).contains(&unit) {
            ascii.push(char::from(unit as u8));
        } else {
            let _ = write!(ascii, "\\u{unit:04x}");
        }
    }
    let mut forms = vec![needle.to_owned()];
    for other in [escaped, ascii] {
        if !forms.contains(&other) {
            forms.push(other);
        }
    }
    forms
}

struct Scan<'a, 'b> {
    roots: &'a Value,
    prefilter: &'a [String],
    codex_event_fallback: bool,
    budget: Duration,
    control: &'a TranscriptControl<'b>,
}

impl Scan<'_, '_> {
    fn run<Row>(
        &self,
        entries: &[Entry],
        mut visit: impl FnMut(&Entry, Session) -> Result<Option<Row>, ReaderError>,
    ) -> Result<Batch<Row>, ReaderError> {
        let started = Instant::now();
        let mut results = Vec::new();
        let mut scanned = 0;
        let mut indexes = HashMap::<Format, HashMap<String, PathBuf>>::new();
        let mut database_batches = HashMap::<Format, HashMap<usize, Option<Row>>>::new();
        for (position, entry) in entries.iter().enumerate() {
            self.control.check()?;
            if scanned > 0 && started.elapsed() >= self.budget {
                break;
            }
            scanned += 1;
            let Ok(format) = Format::parse(&entry.agent) else {
                continue;
            };
            if !valid_id(&entry.id) {
                continue;
            }
            let roots: Vec<_> = self.roots[format.name()]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
            let index = match indexes.entry(format) {
                std::collections::hash_map::Entry::Occupied(index) => index.into_mut(),
                std::collections::hash_map::Entry::Vacant(slot) => {
                    slot.insert(file_index(format, &roots, self.control)?)
                }
            };
            if !index.contains_key(&entry.id) && format.database() {
                let batch = match database_batches.entry(format) {
                    std::collections::hash_map::Entry::Occupied(batch) => batch.into_mut(),
                    std::collections::hash_map::Entry::Vacant(slot) => {
                        let selected: Vec<_> = entries
                            .iter()
                            .enumerate()
                            .skip(position)
                            .filter(|(_, entry)| {
                                entry.agent == format.name()
                                    && valid_id(&entry.id)
                                    && !index.contains_key(&entry.id)
                            })
                            .map(|(position, entry)| (position, entry.id.as_str()))
                            .collect();
                        let found = crate::transcript_database::scan_databases(
                            format,
                            &roots,
                            &selected,
                            self.control,
                            |position, sources| {
                                let session = Session::index(sources, false, None, self.control)?
                                    .ok_or(ReaderError::Unreadable)?;
                                visit(&entries[position], session)
                            },
                        )?;
                        slot.insert(found)
                    }
                };
                if let Some(Some(row)) = batch.remove(&position) {
                    results.push(row);
                }
                continue;
            }
            let Some(file) = index.get(&entry.id) else {
                continue;
            };
            let row = (|| {
                let sources =
                    Sources::from_listed(format, file.to_owned(), &entry.id, false, self.control)?;
                let session = Session::index(
                    sources,
                    self.codex_event_fallback,
                    Some(self.prefilter),
                    self.control,
                )?;
                match session {
                    Some(session) => visit(entry, session),
                    None => Ok(None),
                }
            })();
            self.control.check()?;
            if let Ok(Some(row)) = row {
                results.push(row);
            }
        }
        Ok(Batch { results, scanned })
    }
}

fn first_position(text: &str, needle: &str) -> Option<usize> {
    let lower = text.to_lowercase();
    lower.find(needle).map(|index| units(&lower[..index]))
}

fn position(
    text: &IndexedText,
    replay: &mut Replay<'_, '_>,
    needle: &str,
) -> Result<Option<usize>, ReaderError> {
    let mut matcher = Matcher::new(needle);
    let mut first = None;
    let mut offset = 0;
    let width = units(needle);
    text.visit_until(replay, 0, text.length, |fragment| {
        let lower = fragment.to_lowercase();
        for character in lower.chars() {
            offset += character.len_utf16();
            if character
                .encode_utf8(&mut [0; 4])
                .bytes()
                .any(|byte| matcher.accept(byte))
            {
                first = Some(offset - width);
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    })?;
    Ok(first)
}

fn spaces(text: &str) -> String {
    let mut flat = String::with_capacity(text.len());
    let mut is_space = false;
    for character in text.chars() {
        if character.is_whitespace() || character == '\u{feff}' {
            if !is_space {
                flat.push(' ');
            }
            is_space = true;
        } else {
            flat.push(character);
            is_space = false;
        }
    }
    flat
}

fn snippet(
    kind: &str,
    total: usize,
    at: usize,
    width: usize,
    mut slice: impl FnMut(usize, usize) -> Result<String, ReaderError>,
) -> Result<Snippet, ReaderError> {
    let start = at.saturating_sub(BEFORE);
    let end = total.min(at + width + AFTER);
    let before = spaces(&slice(start, at)?);
    let after = spaces(&slice(at + width, end)?);
    Ok(Snippet {
        kind: kind.to_owned(),
        before: format!(
            "{}{}",
            if start > 0 { "…" } else { "" },
            before.trim_start()
        ),
        r#match: slice(at, at + width)?,
        after: format!("{}{}", after.trim_end(), if end < total { "…" } else { "" }),
    })
}

fn match_text(
    kind: &str,
    text: &IndexedText,
    replay: &mut Replay<'_, '_>,
    needle: &str,
    show_snippet: bool,
) -> Result<(bool, Option<Snippet>), ReaderError> {
    let Some(at) = position(text, replay, needle)? else {
        return Ok((false, None));
    };
    let found = show_snippet
        .then(|| {
            snippet(kind, text.length, at, units(needle), |start, end| {
                text.range(replay, start, end)
            })
        })
        .transpose()?;
    Ok((true, found))
}

fn match_literal(
    kind: &str,
    text: &str,
    needle: &str,
    show_snippet: bool,
) -> Result<(bool, Option<Snippet>), ReaderError> {
    let Some(at) = first_position(text, needle) else {
        return Ok((false, None));
    };
    let found = show_snippet
        .then(|| {
            snippet(kind, units(text), at, units(needle), |start, end| {
                Ok(utf16_slice(text, start, end).to_owned())
            })
        })
        .transpose()?;
    Ok((true, found))
}

fn search_session(
    entry: &Entry,
    session: Session,
    needle: &str,
    control: &TranscriptControl<'_>,
) -> Result<Option<SearchHit>, ReaderError> {
    let mut replay = Replay::new(&session.sources, control);
    let mut hits = 0;
    let mut snippets = Vec::new();
    for item in &session.items {
        control.check()?;
        let show_snippet = snippets.len() < SNIPPETS;
        let (matched, snippet) = match &item.body {
            Body::Text(text) => match_text(item.kind, text, &mut replay, needle, show_snippet)?,
            Body::Tool(tool) => {
                let mut found = match_literal(item.kind, &tool.summary, needle, show_snippet)?;
                if !found.0 {
                    if let Some(output) = &tool.output {
                        found = match_text(item.kind, output, &mut replay, needle, show_snippet)?;
                    }
                }
                if !found.0 {
                    if let Some((pointer, _, _)) = &tool.change {
                        found = match_literal(
                            item.kind,
                            &replay.change(*pointer)?.diff,
                            needle,
                            show_snippet,
                        )?;
                    }
                }
                found
            }
            Body::Image { .. } => (false, None),
        };
        hits += usize::from(matched);
        snippets.extend(snippet);
    }
    replay.finish()?;
    Ok((hits > 0).then(|| SearchHit {
        key: entry.key.to_owned(),
        hits,
        snippets,
    }))
}

/// Search saved entries in the supplied order. At least the first entry is attempted even on an expired sweep budget.
pub fn search(
    entries: &[Entry],
    roots: &Value,
    query: &str,
    budget: Duration,
    control: &TranscriptControl<'_>,
) -> Result<Batch<SearchHit>, ReaderError> {
    let query = js_trim(query);
    if !allowed_text(query, 120) {
        return Err(ReaderError::InvalidSearch);
    }
    let needle = query.to_lowercase();
    Scan {
        roots,
        prefilter: &forms(&needle),
        codex_event_fallback: true,
        budget,
        control,
    }
    .run(entries, |entry, session| {
        search_session(entry, session, &needle, control)
    })
}

fn slashes(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut slash = false;
    for character in value.chars() {
        if matches!(character, '\\' | '/') {
            if !slash {
                text.push('/');
            }
            slash = true;
        } else {
            text.push(character);
            slash = false;
        }
    }
    text.strip_prefix("./").unwrap_or(&text).to_lowercase()
}

struct Placed {
    absolute: Option<String>,
    relative: Option<String>,
}

fn placed(file: &str, cwd: Option<&str>) -> Placed {
    let name = slashes(file);
    let root = cwd.filter(|cwd| !cwd.is_empty()).map(slashes);
    let base = root
        .as_deref()
        .map(|root| root.strip_suffix('/').unwrap_or(root));
    let rooted = name.starts_with('/')
        || matches!(name.as_bytes(), [drive, b':', b'/', ..] if drive.is_ascii_lowercase());
    if rooted {
        let relative = base
            .and_then(|base| name.strip_prefix(base)?.strip_prefix('/'))
            .map(str::to_owned);
        Placed {
            absolute: Some(name),
            relative,
        }
    } else {
        Placed {
            absolute: base.map(|base| format!("{base}/{name}")),
            relative: Some(name),
        }
    }
}

fn history_session(entry: &Entry, session: Session, target: &Placed) -> Option<FileHit> {
    let mut result: Option<FileHit> = None;
    for item in session.items {
        let Body::Tool(tool) = item.body else {
            continue;
        };
        if tool.failed {
            continue;
        }
        let Some((_, changes, _)) = tool.change else {
            continue;
        };
        for changed in changes {
            let actual = placed(&changed.path, entry.cwd.as_deref());
            let exact = target.absolute.as_ref().is_some_and(|target| {
                !target.is_empty() && actual.absolute.as_ref() == Some(target)
            });
            let relative = target.relative.as_ref().is_some_and(|target| {
                target.contains('/') && actual.relative.as_ref() == Some(target)
            });
            if exact || relative {
                let hit = result.get_or_insert_with(|| FileHit {
                    key: entry.key.to_owned(),
                    exact: false,
                    path: changed.path,
                    added: 0,
                    removed: 0,
                    calls: 0,
                });
                hit.exact |= exact;
                hit.added += changed.added;
                hit.removed += changed.removed;
                hit.calls += 1;
            }
        }
    }
    result
}

/// Compare edit paths as recorded; never resolve or open a path supplied by a transcript tool.
pub fn file_history(
    entries: &[Entry],
    roots: &Value,
    target: &FileTarget,
    budget: Duration,
    control: &TranscriptControl<'_>,
) -> Result<Batch<FileHit>, ReaderError> {
    if !allowed_text(&target.path, 1000) {
        return Err(ReaderError::InvalidSearch);
    }
    let wanted = placed(&target.path, target.cwd.as_deref());
    let slash = slashes(&target.path);
    let base = slash.rsplit('/').next().unwrap_or_default();
    Scan {
        roots,
        prefilter: &forms(base),
        codex_event_fallback: false,
        budget,
        control,
    }
    .run(entries, |entry, session| {
        Ok(history_session(entry, session, &wanted))
    })
}

pub fn tool_use(
    entries: &[Entry],
    roots: &Value,
    budget: Duration,
    control: &TranscriptControl<'_>,
) -> Result<Batch<ToolHit>, ReaderError> {
    use std::sync::LazyLock;
    static SKILL: LazyLock<Option<regex::Regex>> =
        LazyLock::new(|| regex::Regex::new(r#""skill"\s*:\s*"([^"]{1,120})""#).ok());
    Scan {
        roots,
        prefilter: &["mcp__".to_owned(), "\"skill\"".to_owned()],
        codex_event_fallback: false,
        budget,
        control,
    }
    .run(entries, |entry, session| {
        let mut mcp = IndexMap::<String, usize>::new();
        let mut skill = IndexMap::<String, usize>::new();
        for item in session.items {
            control.check()?;
            let Body::Tool(tool) = item.body else {
                continue;
            };
            if let Some((server, _)) = tool
                .name
                .strip_prefix("mcp__")
                .and_then(|name| name.split_once("__"))
                .filter(|(name, _)| !name.is_empty())
            {
                *mcp.entry(server.to_owned()).or_default() += 1;
            }
            if tool.name == "Skill" {
                if let Some(used) = SKILL
                    .as_ref()
                    .and_then(|pattern| pattern.captures(&tool.summary))
                    .and_then(|capture| capture.get(1))
                {
                    if units(used.as_str()) <= 120 {
                        *skill.entry(used.as_str().to_owned()).or_default() += 1;
                    }
                }
            }
        }
        let encode = |counts: IndexMap<String, usize>| {
            counts
                .into_iter()
                .map(|(name, count)| (name, json!(count)))
                .collect()
        };
        Ok((!mcp.is_empty() || !skill.is_empty()).then(|| ToolHit {
            key: entry.key.to_owned(),
            mcp: encode(mcp),
            skill: encode(skill),
        }))
    })
}
