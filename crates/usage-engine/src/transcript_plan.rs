use crate::{
    normalize::truthy,
    transcript::{ReaderError, TranscriptControl},
    transcript_changes::antigravity_created_path,
    transcript_events::{array, string, RowEvents},
    transcript_lines::{JsonlReader, LineSpan},
    transcript_more,
    transcript_sources::{Format, Source},
};
use indexmap::IndexMap;
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    ops::ControlFlow,
};

#[derive(Clone, Copy)]
pub enum Pick {
    Whole,
    Set(usize),
    Header(usize),
    Call(usize),
}

#[derive(Clone, Copy)]
pub struct RowRef {
    pub span: LineSpan,
    pick: Pick,
}

impl RowRef {
    pub fn select(self, raw: &Value) -> &Value {
        match self.pick {
            Pick::Whole => raw,
            Pick::Set(index) => &raw["$set"]["messages"][index],
            Pick::Header(index) => &raw["messages"][index],
            Pick::Call(index) => &raw["tool_calls"][index],
        }
    }
}

#[derive(Default)]
struct Links {
    call: Option<RowRef>,
    written: Option<RowRef>,
    fragments: Vec<LineSpan>,
}

pub struct Plan {
    pub rows: Vec<RowRef>,
    links: HashMap<usize, Links>,
    pub matched: bool,
}

impl Plan {
    pub fn read(
        &self,
        index: usize,
        source: &Source,
        reader: &mut JsonlReader,
        cache: &mut Option<(LineSpan, Value)>,
        control: &TranscriptControl<'_>,
    ) -> Result<RowEvents, ReaderError> {
        control.check()?;
        let chosen = self.rows.get(index).copied().ok_or(ReaderError::Changed)?;
        if cache.as_ref().is_none_or(|(span, _)| *span != chosen.span) {
            *cache = Some((
                chosen.span,
                reader
                    .read_indexed(chosen.span)?
                    .ok_or(ReaderError::Changed)?,
            ));
        }
        let (_, raw) = cache.as_ref().ok_or(ReaderError::Changed)?;
        let row = chosen.select(raw);
        if matches!(chosen.pick, Pick::Call(_)) {
            return Ok(transcript_more::antigravity_pending(row));
        }
        let Some(links) = self.links.get(&index) else {
            return Ok(source.row(row));
        };
        let read = |reader: &mut JsonlReader, reference: Option<RowRef>| {
            reference
                .map(|reference| -> Result<Value, ReaderError> {
                    if reference.span == chosen.span {
                        Ok(reference.select(raw).to_owned())
                    } else {
                        Ok(reader
                            .read_indexed(reference.span)?
                            .map(|row| reference.select(&row).to_owned())
                            .ok_or(ReaderError::Changed)?)
                    }
                })
                .transpose()
        };
        if !links.fragments.is_empty() {
            let args = &row["message"]["payload"]["function"]["arguments"];
            let mut args = if args.is_null() {
                String::new()
            } else if let Some(text) = args.as_str() {
                text.to_owned()
            } else {
                crate::js_json::stringify(args)
            };
            for span in &links.fragments {
                control.check()?;
                let part = reader.read_indexed(*span)?.ok_or(ReaderError::Changed)?;
                args.push_str(string(&part["message"]["payload"]["arguments_part"]));
            }
            return Ok(transcript_more::kimi(row, Some(&args)));
        }
        let call = read(reader, links.call)?;
        let written = match (links.written, links.call) {
            (Some(written), Some(call_ref))
                if written.span == call_ref.span
                    && matches!((written.pick, call_ref.pick), (Pick::Call(left), Pick::Call(right)) if left == right) =>
            {
                return Ok(transcript_more::antigravity(
                    row,
                    call.as_ref(),
                    call.as_ref(),
                ));
            }
            _ => read(reader, links.written)?,
        };
        Ok(transcript_more::antigravity(
            row,
            call.as_ref(),
            written.as_ref(),
        ))
    }
}

struct Record {
    row: RowRef,
    id: Option<String>,
    parent: Option<String>,
    side: bool,
}

fn branch(records: &[Record]) -> Option<Vec<usize>> {
    let mut keyed = HashMap::new();
    let mut last = None;
    for (index, record) in records.iter().enumerate() {
        if !record.side {
            if let Some(id) = record.id.as_deref() {
                keyed.insert(id, index);
                last = Some(index);
            }
        }
    }
    let mut chain = Vec::new();
    let mut visited = HashSet::new();
    let mut current = last?;
    loop {
        if !visited.insert(current) {
            break;
        }
        chain.push(current);
        let Some(next) = records[current]
            .parent
            .as_deref()
            .and_then(|key| keyed.get(key))
        else {
            break;
        };
        current = *next;
    }
    chain.reverse();
    Some(chain)
}

pub fn build(
    format: Format,
    reader: &mut JsonlReader,
    prefilter: Option<&[String]>,
    control: &TranscriptControl<'_>,
) -> Result<Plan, ReaderError> {
    let mut gemini = IndexMap::<String, RowRef>::new();
    let mut chain = Vec::<Record>::new();
    let mut steps = BTreeMap::<i64, RowRef>::new();
    let mut rows = Vec::new();
    let mut links = HashMap::<usize, Links>::new();
    let mut pending_kimi = None;
    let mut matched = prefilter.is_none();
    reader.visit(|span, raw, row| {
        if control.check().is_err() {
            return ControlFlow::Break(());
        }
        if !matched {
            if let Some(forms) = prefilter {
                let lower = raw.to_lowercase();
                matched = forms.iter().any(|form| lower.contains(form));
            }
        }
        let Some(row) = row.filter(Value::is_object) else {
            return ControlFlow::Continue(());
        };
        let full = RowRef {
            span,
            pick: Pick::Whole,
        };
        match format {
            Format::Gemini => {
                if let Some(rewind) = row["$rewindTo"].as_str() {
                    gemini.truncate(gemini.get_index_of(rewind).unwrap_or(0));
                } else if let Some(id) = row["id"].as_str() {
                    gemini.insert(id.to_owned(), full);
                } else if truthy(&row["$set"]) {
                    if let Some(messages) = row["$set"]["messages"].as_array() {
                        gemini.clear();
                        for (index, message) in messages.iter().enumerate() {
                            if let Some(id) = message["id"].as_str() {
                                gemini.insert(
                                    id.to_owned(),
                                    RowRef {
                                        span,
                                        pick: Pick::Set(index),
                                    },
                                );
                            }
                        }
                    }
                } else if row["sessionId"].is_string() {
                    for (index, message) in array(&row["messages"]).iter().enumerate() {
                        if let Some(id) = message["id"].as_str() {
                            gemini.insert(
                                id.to_owned(),
                                RowRef {
                                    span,
                                    pick: Pick::Header(index),
                                },
                            );
                        }
                    }
                }
            }
            Format::Pi | Format::Qwen => {
                let kind = string(&row["type"]);
                let (id, parent, side) = if format == Format::Pi {
                    if matches!(kind, "session" | "label") {
                        return ControlFlow::Continue(());
                    }
                    ("id", "parentId", false)
                } else {
                    if !matches!(kind, "user" | "assistant" | "tool_result" | "system") {
                        return ControlFlow::Continue(());
                    }
                    ("uuid", "parentUuid", truthy(&row["isSidechain"]))
                };
                let key = |field| {
                    row[field]
                        .as_str()
                        .filter(|id| !id.is_empty())
                        .map(str::to_owned)
                };
                chain.push(Record {
                    row: full,
                    id: key(id),
                    parent: key(parent),
                    side,
                });
            }
            Format::Antigravity => {
                if let Some(index) = row["step_index"]
                    .as_f64()
                    .filter(|index| index.fract() == 0.0)
                {
                    steps.insert(index as i64, full);
                }
            }
            Format::Kimi => match string(&row["message"]["type"]) {
                "ToolCallPart" => {
                    if let Some(index) = pending_kimi
                        .filter(|_| row["message"]["payload"]["arguments_part"].is_string())
                    {
                        links.entry(index).or_default().fragments.push(span);
                    }
                }
                "" => {}
                kind => {
                    pending_kimi = (kind == "ToolCall").then_some(rows.len());
                    rows.push(full);
                }
            },
            _ => {}
        }
        ControlFlow::Continue(())
    })?;
    control.check()?;
    if !matched {
        return Ok(Plan {
            rows: Vec::new(),
            links: HashMap::new(),
            matched,
        });
    }
    let rows = match format {
        Format::Gemini => gemini.into_values().collect(),
        Format::Kimi => rows,
        Format::Antigravity => {
            let mut steps: Vec<_> = steps.into_values().collect();
            link_antigravity(&mut steps, &mut links, reader, control)?;
            steps
        }
        Format::Pi | Format::Qwen => match branch(&chain) {
            None => chain.into_iter().map(|record| record.row).collect(),
            Some(path) if format == Format::Pi => {
                path.into_iter().map(|index| chain[index].row).collect()
            }
            Some(path) => {
                let selected: HashSet<_> = path.into_iter().collect();
                chain
                    .into_iter()
                    .enumerate()
                    .filter_map(|(index, record)| {
                        (record.side || selected.contains(&index)).then_some(record.row)
                    })
                    .collect()
            }
        },
        _ => Vec::new(),
    };
    Ok(Plan {
        rows,
        links,
        matched,
    })
}

fn link_antigravity(
    steps: &mut Vec<RowRef>,
    links: &mut HashMap<usize, Links>,
    reader: &mut JsonlReader,
    control: &TranscriptControl<'_>,
) -> Result<(), ReaderError> {
    let mut pending = VecDeque::new();
    let mut written = HashMap::<String, RowRef>::new();
    for (index, step) in steps.iter().enumerate() {
        control.check()?;
        let value = reader
            .read_indexed(step.span)?
            .ok_or(ReaderError::Changed)?;
        let kind = string(&value["type"]);
        if kind == "PLANNER_RESPONSE" {
            for (index, call) in array(&value["tool_calls"]).iter().enumerate() {
                let Some(name) = call["name"].as_str() else {
                    continue;
                };
                let reference = RowRef {
                    span: step.span,
                    pick: Pick::Call(index),
                };
                pending.push_back(reference);
                if name == "write_to_file" && call["args"]["CodeContent"].is_string() {
                    if let Some(path) = call["args"]["TargetFile"].as_str() {
                        written.insert(path.replace('\\', "/").to_lowercase(), reference);
                    }
                }
            }
        } else if transcript_more::antigravity_result(kind) {
            let call = pending.pop_front();
            let written = if kind == "CODE_ACTION"
                && !string(&value["content"]).contains("[diff_block_start]")
            {
                antigravity_created_path(string(&value["content"]))
                    .and_then(|path| written.get(&path.to_lowercase()).copied())
            } else {
                None
            };
            if call.is_some() || written.is_some() {
                links.insert(
                    index,
                    Links {
                        call,
                        written,
                        fragments: Vec::new(),
                    },
                );
            }
        }
    }
    steps.extend(pending);
    reader.verify()?;
    Ok(())
}
