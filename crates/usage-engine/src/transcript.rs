use crate::{
    sessions::js_trim,
    transcript_changes::{ChangedFile, TranscriptChange},
    transcript_continuation,
    transcript_events::{Event, RowEvents, Text},
    transcript_lines::{JsonlReader, LineError, LineSpan},
    transcript_marks::prefix,
    transcript_sources::{self as sources, Format, Sources},
    transcript_tasks::{ReadBudget, TranscriptUnreadable},
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fmt, io,
    ops::ControlFlow,
};

#[path = "transcript_sweep.rs"]
pub mod sweep;

const MAX_ITEMS: usize = transcript_continuation::MAX_ITEMS;
const MAX_ITEM: usize = 64 * 1024 * 1024;
const MAX_PAYLOAD: usize = 24 * 1024 * 1024;
const SPOKEN: usize = 256 * 1024;
const INLINE: usize = 8 * 1024;
const PREVIEW: usize = 1200;
const TIGHT: usize = 160;
const PAGE: usize = 512 * 1024;
const HITS: usize = 5000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReaderError {
    NotFound,
    Unsupported,
    Unreadable,
    Changed,
    TooLarge,
    InvalidPart,
    InvalidSearch,
}

impl fmt::Display for ReaderError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(match self {
            Self::NotFound => "TRANSCRIPT_NOT_FOUND",
            Self::Unsupported => "TRANSCRIPT_UNSUPPORTED",
            Self::Unreadable => "TRANSCRIPT_UNREADABLE",
            Self::Changed => "TRANSCRIPT_CHANGED",
            Self::TooLarge => "TRANSCRIPT_TOO_LARGE",
            Self::InvalidPart => "TRANSCRIPT_PART_INVALID",
            Self::InvalidSearch => "TRANSCRIPT_SEARCH_INVALID",
        })
    }
}

impl std::error::Error for ReaderError {}

impl From<LineError> for ReaderError {
    fn from(error: LineError) -> Self {
        match error {
            LineError::Busy => Self::Changed,
            LineError::Io(error) if error.kind() == io::ErrorKind::NotFound => Self::NotFound,
            _ => Self::Unreadable,
        }
    }
}

impl From<TranscriptUnreadable> for ReaderError {
    fn from(_: TranscriptUnreadable) -> Self {
        Self::Unreadable
    }
}

impl From<transcript_continuation::InvalidTranscriptPart> for ReaderError {
    fn from(_: transcript_continuation::InvalidTranscriptPart) -> Self {
        Self::InvalidPart
    }
}

#[derive(Default)]
pub struct TranscriptControl<'a> {
    budget: Option<&'a ReadBudget>,
}

impl<'a> TranscriptControl<'a> {
    pub fn with_budget(budget: &'a ReadBudget) -> Self {
        Self {
            budget: Some(budget),
        }
    }

    pub(crate) fn check(&self) -> Result<(), ReaderError> {
        if let Some(budget) = self.budget {
            budget.check()?;
        }
        Ok(())
    }
}

fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

fn utf16_slice(text: &str, start: usize, end: usize) -> &str {
    if start >= end {
        return "";
    }
    if start == 0 {
        return prefix(text, end);
    }
    if text.is_ascii() {
        return &text[start.min(text.len())..end.min(text.len())];
    }
    let mut position = 0;
    let mut begin = None;
    for (offset, character) in text.char_indices() {
        if position >= start && begin.is_none() {
            begin = Some(offset);
        }
        if position + character.len_utf16() > end {
            return &text[begin.unwrap_or(offset)..offset];
        }
        position += character.len_utf16();
    }
    &text[begin.unwrap_or(text.len())..]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Pointer {
    source: usize,
    span: LineSpan,
    event: usize,
}

struct Piece {
    pointer: Pointer,
    length: usize,
}

#[derive(Default)]
struct IndexedText {
    first: Option<Piece>,
    extra: Vec<Piece>,
    length: usize,
    clipped: bool,
}

impl IndexedText {
    fn single(pointer: Pointer, length: usize, clipped: bool) -> Self {
        Self {
            first: Some(Piece { pointer, length }),
            extra: Vec::new(),
            length,
            clipped,
        }
    }

    fn join(&mut self, pointer: Pointer, length: usize) {
        self.extra.push(Piece { pointer, length });
        self.length += 2 + length;
    }

    fn range(
        &self,
        replay: &mut Replay<'_, '_>,
        from: usize,
        to: usize,
    ) -> Result<String, ReaderError> {
        let mut output = String::new();
        self.visit(replay, from, to, |text| output.push_str(text))?;
        Ok(output)
    }

    fn visit(
        &self,
        replay: &mut Replay<'_, '_>,
        from: usize,
        to: usize,
        mut visitor: impl FnMut(&str),
    ) -> Result<(), ReaderError> {
        self.visit_until(replay, from, to, |text| {
            visitor(text);
            ControlFlow::Continue(())
        })
    }

    fn visit_until(
        &self,
        replay: &mut Replay<'_, '_>,
        from: usize,
        to: usize,
        mut visitor: impl FnMut(&str) -> ControlFlow<()>,
    ) -> Result<(), ReaderError> {
        let mut start = 0;
        for (position, piece) in self.first.iter().chain(&self.extra).enumerate() {
            if start >= to {
                break;
            }
            if position > 0 {
                if from < start + 2
                    && visitor(utf16_slice("\n\n", from.saturating_sub(start), to - start))
                        .is_break()
                {
                    break;
                }
                start += 2;
            }
            if start < to
                && from < start + piece.length
                && visitor(utf16_slice(
                    replay.text(piece.pointer)?,
                    from.saturating_sub(start),
                    (to - start).min(piece.length),
                ))
                .is_break()
            {
                break;
            }
            start += piece.length;
        }
        Ok(())
    }
}

struct Tool {
    name: String,
    summary: String,
    output: Option<IndexedText>,
    failed: bool,
    change: Option<(Pointer, Vec<ChangedFile>, usize)>,
    commands: Option<Vec<String>>,
}

enum Body {
    Text(IndexedText),
    Tool(Box<Tool>),
    Image {
        pointer: Pointer,
        from: &'static str,
        mime: String,
        bytes: usize,
    },
}

struct Item {
    kind: &'static str,
    at: Option<String>,
    side: Option<String>,
    usage: Option<f64>,
    marks: Map<String, Value>,
    body: Body,
}

#[derive(Default)]
struct Builder {
    items: Vec<Item>,
    calls: HashMap<String, usize>,
    reported: HashMap<String, (usize, i64)>,
    last_report: Option<String>,
    seen_rows: HashSet<String>,
    side: Option<String>,
    truncated: bool,
}

impl Builder {
    fn full(&self) -> bool {
        self.items.len() >= MAX_ITEMS
    }

    fn push(
        &mut self,
        kind: &'static str,
        row: (&Option<String>, &Option<String>),
        marks: Map<String, Value>,
        body: Body,
    ) -> Option<usize> {
        if self.full() {
            self.truncated = true;
            return None;
        }
        let index = self.items.len();
        self.items.push(Item {
            kind,
            at: row.0.to_owned(),
            side: row.1.to_owned(),
            usage: None,
            marks,
            body,
        });
        Some(index)
    }

    fn text(&mut self, text: Text, pointer: Pointer, row: (&Option<String>, &Option<String>)) {
        let length = units(&text.value);
        let clipped = length > MAX_ITEM;
        let length = length.min(MAX_ITEM);
        if js_trim(if clipped {
            prefix(&text.value, MAX_ITEM)
        } else {
            &text.value
        })
        .is_empty()
        {
            return;
        }
        if let Some(previous) = self.items.last_mut() {
            let label = text.marks.get("label");
            if previous.marks.get("label") == label
                && label.is_some_and(|label| label == "这一轮被中断")
            {
                return;
            }
            let same_fold =
                text.merge && previous.kind == "context" && previous.marks.get("label") == label;
            let same_speaker =
                previous.kind == text.kind && matches!(text.kind, "assistant" | "thinking");
            if let Body::Text(body) = &mut previous.body {
                if &previous.side == row.1
                    && !body.clipped
                    && body.length + length <= MAX_ITEM
                    && (same_fold || same_speaker)
                {
                    body.join(pointer, length);
                    if same_speaker && !same_fold {
                        body.clipped = clipped;
                    }
                    return;
                }
            }
        }
        self.push(
            text.kind,
            row,
            text.marks,
            Body::Text(IndexedText::single(pointer, length, clipped)),
        );
    }

    fn tool(
        &mut self,
        id: Option<String>,
        tool: Tool,
        row: (&Option<String>, &Option<String>),
    ) -> Option<usize> {
        let index = self.push("tool", row, Map::new(), Body::Tool(Box::new(tool)))?;
        if let Some(id) = id.filter(|id| !id.is_empty()) {
            self.calls.insert(id, index);
        }
        Some(index)
    }

    fn row(&mut self, events: RowEvents, source: usize, span: LineSpan) {
        let side = if events.keep_side {
            self.side.to_owned()
        } else {
            events.side
        };
        self.side = side.to_owned();
        let row = (&events.at, &side);
        let mut duplicate = false;
        for (event, value) in events.values.into_iter().enumerate() {
            if duplicate && !matches!(value, Event::Usage { .. }) {
                continue;
            }
            let pointer = Pointer {
                source,
                span,
                event,
            };
            match value {
                Event::Deduplicate(key) => duplicate = !self.seen_rows.insert(key),
                Event::ClearUsage => self.items.iter_mut().for_each(|item| item.usage = None),
                Event::Text(text) => self.text(text, pointer, row),
                Event::Cite(cited) => {
                    if let Some(item) = self
                        .items
                        .iter_mut()
                        .rev()
                        .find(|item| item.kind == "assistant")
                    {
                        let mut previous = item
                            .marks
                            .shift_remove("cited")
                            .and_then(|mut cited| cited.as_array_mut().map(std::mem::take))
                            .unwrap_or_default();
                        previous.extend(
                            cited
                                .into_iter()
                                .take(64usize.saturating_sub(previous.len()))
                                .map(|cite| json!(cite)),
                        );
                        item.marks
                            .insert("cited".to_owned(), Value::Array(previous));
                    }
                }
                Event::Compact { trigger, before } => {
                    if self.items.last().is_none_or(|item| item.kind != "compact") {
                        let marks = Map::from_iter([(
                            "compact".to_owned(),
                            json!({"trigger": trigger, "before": before}),
                        )]);
                        self.push("compact", row, marks, Body::Text(IndexedText::default()));
                    }
                }
                Event::Usage {
                    total,
                    key,
                    signature,
                } => {
                    if let Some(signature) = signature {
                        if self.last_report.as_ref() == Some(&signature) {
                            continue;
                        }
                        self.last_report = Some(signature);
                    }
                    let Some(total) = total else {
                        continue;
                    };
                    let Some(last) = self.items.len().checked_sub(1) else {
                        continue;
                    };
                    let (index, increment) = if let Some(key) = key {
                        let report = self.reported.entry(key).or_insert((last, 0));
                        let increment = total.saturating_sub(report.1).max(0);
                        report.1 = report.1.max(total);
                        (report.0, increment)
                    } else {
                        (last, total)
                    };
                    *self.items[index].usage.get_or_insert(0.0) += increment as f64;
                }
                Event::Image {
                    from, mime, bytes, ..
                } => {
                    self.push(
                        "image",
                        row,
                        Map::new(),
                        Body::Image {
                            pointer,
                            from,
                            mime,
                            bytes,
                        },
                    );
                }
                Event::Call(call) => {
                    if call.once
                        && call
                            .id
                            .as_ref()
                            .is_some_and(|id| self.calls.contains_key(id))
                    {
                        continue;
                    }
                    let change = call
                        .change
                        .map(|change| (pointer, change.files, units(&change.diff)));
                    self.tool(
                        call.id,
                        Tool {
                            name: call.name,
                            summary: call.summary,
                            output: None,
                            failed: false,
                            change,
                            commands: call.commands,
                        },
                        row,
                    );
                }
                Event::Output {
                    id,
                    text,
                    failed,
                    untimed,
                } => {
                    let mut index = id.as_ref().and_then(|id| self.calls.get(id).copied());
                    if index.is_none() && text.as_ref().is_some_and(|text| !text.is_empty()) {
                        index = self.tool(
                            id,
                            Tool {
                                name: "工具结果".to_owned(),
                                summary: "这份记录里没有对应的调用".to_owned(),
                                output: None,
                                failed: false,
                                change: None,
                                commands: None,
                            },
                            if untimed { (&None, row.1) } else { row },
                        );
                    }
                    if let Some(Item {
                        body: Body::Tool(tool),
                        ..
                    }) = index.and_then(|index| self.items.get_mut(index))
                    {
                        let size = text.as_deref().map_or(0, units);
                        let clipped = size > MAX_ITEM
                            || tool.output.as_ref().is_some_and(|output| output.clipped);
                        tool.output =
                            Some(IndexedText::single(pointer, size.min(MAX_ITEM), clipped));
                        tool.failed = failed;
                    }
                }
            }
        }
    }
}

struct Session {
    sources: Sources,
    items: Vec<Item>,
    truncated: bool,
    turns: usize,
}

impl Session {
    fn read(
        agent: &str,
        id: &str,
        roots: &[String],
        expected: Option<&str>,
        control: &TranscriptControl<'_>,
    ) -> Result<Self, ReaderError> {
        if expected.is_some_and(|stamp| units(stamp) > 200) {
            return Err(ReaderError::InvalidPart);
        }
        let sources = Sources::resolve(agent, id, roots, control)?;
        if expected.is_some_and(|stamp| sources.stamp() != stamp) {
            return Err(ReaderError::Changed);
        }
        Self::index(sources, true, None, control)?.ok_or(ReaderError::Unreadable)
    }

    fn index(
        mut sources: Sources,
        codex_event_fallback: bool,
        prefilter: Option<&[String]>,
        control: &TranscriptControl<'_>,
    ) -> Result<Option<Self>, ReaderError> {
        let mut matched = prefilter.is_none();
        let mut items = Vec::new();
        let (mut truncated, mut turns) = (false, 0);
        for (index, source) in sources.sources.iter_mut().enumerate() {
            control.check()?;
            if source
                .epoch
                .as_ref()
                .is_some_and(|epoch| epoch.length > sources::MAX_FILE)
            {
                if index == 0 {
                    return Err(ReaderError::TooLarge);
                }
                continue;
            }
            let result = (|| {
                if source
                    .path
                    .extension()
                    .is_some_and(|extension| extension == "json")
                {
                    if let Some(forms) = prefilter {
                        let mut reader = source.open()?;
                        let contains = reader.contains_folded(forms, || control.check().is_ok())?;
                        control.check()?;
                        if !contains {
                            return Ok(Builder::default());
                        }
                    }
                    let epoch = source.epoch.ok_or(ReaderError::Changed)?;
                    source.rows = Some(crate::transcript_documents::read(
                        &source.path,
                        sources.format,
                        epoch,
                        control,
                    )?);
                }
                if let Some(rows) = &source.rows {
                    let mut builder = Builder::default();
                    for (offset, row) in rows.iter().enumerate() {
                        control.check()?;
                        if builder.full() {
                            builder.truncated = true;
                            break;
                        }
                        builder.row(
                            source.row(row),
                            index,
                            LineSpan {
                                offset: offset as u64,
                                length: 0,
                            },
                        );
                    }
                    matched = true;
                    return Ok(builder);
                }
                let mut reader = source.open()?;
                if matches!(
                    sources.format,
                    Format::Gemini | Format::Pi | Format::Qwen | Format::Kimi | Format::Antigravity
                ) {
                    let plan = crate::transcript_plan::build(
                        sources.format,
                        &mut reader,
                        prefilter,
                        control,
                    )?;
                    let mut builder = Builder::default();
                    let mut cached: Option<(LineSpan, Value)> = None;
                    for offset in 0..plan.rows.len() {
                        control.check()?;
                        if builder.full() {
                            builder.truncated = true;
                            break;
                        }
                        builder.row(
                            plan.read(offset, source, &mut reader, &mut cached, control)?,
                            index,
                            LineSpan {
                                offset: offset as u64,
                                length: 0,
                            },
                        );
                    }
                    reader.verify()?;
                    matched |= plan.matched;
                    source.plan = Some(plan);
                    return Ok(builder);
                }
                if codex_event_fallback && matches!(sources.format, Format::Codex) {
                    sources::prepare_codex(source, &mut reader, control)?;
                }
                let mut builder = Builder::default();
                let mut contains = false;
                reader.visit(|span, raw, value| {
                    if control.check().is_err() {
                        return ControlFlow::Break(());
                    }
                    if !matched && !contains {
                        if let Some(forms) = prefilter {
                            let lower = raw.to_lowercase();
                            contains = forms.iter().any(|form| lower.contains(form));
                        }
                    }
                    if let Some(value) = value {
                        if builder.full() {
                            builder.truncated = true;
                            return if matched || contains {
                                ControlFlow::Break(())
                            } else {
                                ControlFlow::Continue(())
                            };
                        }
                        builder.row(source.row(&value), index, span);
                    }
                    ControlFlow::Continue(())
                })?;
                control.check()?;
                matched |= contains;
                Ok::<_, ReaderError>(builder)
            })();
            let builder = match result {
                Ok(builder) => builder,
                Err(error) if index == 0 => return Err(error),
                Err(_) => {
                    control.check()?;
                    continue;
                }
            };
            if index == 0 {
                turns = builder
                    .items
                    .iter()
                    .filter(|item| item.kind == "user" && item.side.is_none())
                    .count();
                truncated = builder.truncated;
                items = builder.items;
            } else if !builder.items.is_empty() {
                let insert = builder
                    .items
                    .first()
                    .and_then(|first| first.at.as_deref())
                    .and_then(|first| {
                        items
                            .iter()
                            .position(|item| item.at.as_deref().is_some_and(|at| at > first))
                    })
                    .unwrap_or(items.len());
                items.splice(insert..insert, builder.items);
                if items.len() > MAX_ITEMS {
                    items.truncate(MAX_ITEMS);
                    truncated = true;
                }
            }
        }
        sources.verify()?;
        if sources.format == Format::Kimi && items.is_empty() && prefilter.is_none() {
            return Err(ReaderError::Unsupported);
        }
        Ok(matched.then_some(Self {
            sources,
            items,
            turns,
            truncated,
        }))
    }

    fn count_tools(&self) -> (usize, usize) {
        self.items
            .iter()
            .fold((0, 0), |(count, failed), item| match &item.body {
                Body::Tool(tool) => (count + 1, failed + usize::from(tool.failed)),
                _ => (count, failed),
            })
    }
}

struct Replay<'a, 'b> {
    sources: &'a Sources,
    control: &'a TranscriptControl<'b>,
    reader: Option<(usize, JsonlReader)>,
    row: Option<(usize, LineSpan, RowEvents)>,
    raw: Option<(LineSpan, Value)>,
}

impl<'a, 'b> Replay<'a, 'b> {
    fn new(sources: &'a Sources, control: &'a TranscriptControl<'b>) -> Self {
        Self {
            sources,
            control,
            reader: None,
            row: None,
            raw: None,
        }
    }

    fn event(&mut self, pointer: Pointer) -> Result<&Event, ReaderError> {
        self.control.check()?;
        if self
            .row
            .as_ref()
            .is_none_or(|(source, span, _)| *source != pointer.source || *span != pointer.span)
        {
            self.row = None;
            let source = self
                .sources
                .sources
                .get(pointer.source)
                .ok_or(ReaderError::Changed)?;
            if let Some(rows) = &source.rows {
                let row = rows
                    .get(pointer.span.offset as usize)
                    .ok_or(ReaderError::Changed)?;
                self.row = Some((pointer.source, pointer.span, source.row(row)));
            } else {
                if self
                    .reader
                    .as_ref()
                    .is_none_or(|(index, _)| *index != pointer.source)
                {
                    if let Some((_, reader)) = self.reader.take() {
                        reader.verify()?;
                    }
                    self.reader = Some((pointer.source, source.open()?));
                    self.raw = None;
                }
                let (_, reader) = self.reader.as_mut().ok_or(ReaderError::Unreadable)?;
                let row = if let Some(plan) = &source.plan {
                    plan.read(
                        pointer.span.offset as usize,
                        source,
                        reader,
                        &mut self.raw,
                        self.control,
                    )?
                } else {
                    let row = reader
                        .read_indexed(pointer.span)?
                        .ok_or(ReaderError::Changed)?;
                    source.row(&row)
                };
                self.row = Some((pointer.source, pointer.span, row));
            }
        }
        self.row
            .as_ref()
            .and_then(|(_, _, row)| row.values.get(pointer.event))
            .ok_or(ReaderError::Changed)
    }

    fn text(&mut self, pointer: Pointer) -> Result<&str, ReaderError> {
        match self.event(pointer)? {
            Event::Text(text) => Ok(&text.value),
            Event::Output { text, .. } => Ok(text.as_deref().unwrap_or_default()),
            _ => Err(ReaderError::Changed),
        }
    }

    fn change(&mut self, pointer: Pointer) -> Result<&TranscriptChange, ReaderError> {
        match self.event(pointer)? {
            Event::Call(call) => call.change.as_ref().ok_or(ReaderError::Changed),
            _ => Err(ReaderError::Changed),
        }
    }

    fn finish(self) -> Result<(), ReaderError> {
        if let Some((_, reader)) = self.reader {
            reader.verify()?;
        }
        self.control.check()?;
        self.sources.verify()
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PartField {
    Text,
    Output,
    Image,
    Diff,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartRequest {
    pub stamp: String,
    pub index: usize,
    pub field: PartField,
    #[serde(default)]
    pub offset: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FindRequest {
    pub stamp: String,
    pub query: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarkdownRequest {
    pub stamp: String,
    pub from: usize,
    pub to: usize,
    #[serde(default)]
    pub plain: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub index: usize,
    pub count: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FindResult {
    pub hits: Vec<Hit>,
    pub total: usize,
}

fn preview_item(
    item: &Item,
    replay: &mut Replay<'_, '_>,
    tight: bool,
) -> Result<(Value, usize), ReaderError> {
    let mut light = Map::new();
    light.insert("kind".to_owned(), json!(item.kind));
    if let Body::Image { from, .. } = &item.body {
        light.insert("from".to_owned(), json!(from));
    }
    light.insert("time".to_owned(), json!(item.at));
    if let Some(side) = &item.side {
        light.insert("side".to_owned(), json!(side));
    }
    if let Some(usage) = item.usage.filter(|usage| *usage != 0.0) {
        light.insert("usage".to_owned(), json!(usage));
    }
    for key in ["label", "attached", "cited", "answered", "compact"] {
        if let Some(value) = item.marks.get(key) {
            light.insert(key.to_owned(), value.to_owned());
        }
    }
    let keep = if tight { TIGHT } else { PREVIEW };
    let size = match &item.body {
        Body::Text(body) => {
            let inline = if tight {
                TIGHT
            } else if matches!(item.kind, "user" | "assistant") {
                SPOKEN
            } else {
                INLINE
            };
            let text = body.range(
                replay,
                0,
                if body.length <= inline {
                    body.length
                } else {
                    keep
                },
            )?;
            let length = units(&text);
            light.insert("text".to_owned(), Value::String(text));
            if length < body.length {
                light.insert("length".to_owned(), json!(body.length));
            }
            length
        }
        Body::Tool(tool) => {
            let output = tool
                .output
                .as_ref()
                .map(|output| output.range(replay, 0, keep))
                .transpose()?;
            let output =
                output.map(|text| text.split('\n').take(12).collect::<Vec<_>>().join("\n"));
            let output_size = output.as_deref().map_or(0, units);
            let mut value = json!({"name": tool.name, "summary": tool.summary, "output": output, "error": tool.failed});
            if let Some(out) = tool.output.as_ref().filter(|out| out.length > output_size) {
                value["outputLength"] = json!(out.length);
            }
            if let Some(commands) = &tool.commands {
                value["commands"] = json!(commands);
            }
            if let Some((_, files, length)) = &tool.change {
                value["change"] =
                    json!({"files": &files[..files.len().min(200)], "length": length});
            }
            light.insert("tool".to_owned(), value);
            output_size + units(&tool.summary)
        }
        Body::Image { mime, bytes, .. } => {
            light.insert("image".to_owned(), json!({"mime": mime, "bytes": bytes}));
            0
        }
    };
    Ok((Value::Object(light), size + 96))
}

/// Build a bounded preview for a supported record selected from its saved source roots.
pub fn preview(
    agent: &str,
    id: &str,
    roots: &[String],
    proof: Option<&Value>,
    control: &TranscriptControl<'_>,
) -> Result<Value, ReaderError> {
    if let Some(proof) = proof {
        transcript_continuation::validate(proof)?;
    }
    let run = || {
        let session = Session::read(agent, id, roots, None, control)?;
        let mut replay = Replay::new(&session.sources, control);
        let mut items = Vec::with_capacity(session.items.len());
        let mut size = 0;
        for item in &session.items {
            let (shown, increase) = preview_item(item, &mut replay, size > MAX_PAYLOAD)?;
            size += increase;
            items.push(shown);
        }
        replay.finish()?;
        let (tools, failed) = session.count_tools();
        let mut view = json!({
            "schemaVersion": "TranscriptV2", "agent": agent, "stamp": session.sources.stamp(),
            "items": null, "truncated": session.truncated, "turns": session.turns, "tools": tools, "failed": failed
        });
        view["items"] = Value::Array(items);
        if let Some(proof) = proof {
            let delta = transcript_continuation::make(view, id, proof)?;
            serde_json::to_value(delta).map_err(|_| ReaderError::Unreadable)
        } else {
            Ok(view)
        }
    };
    match run() {
        Err(ReaderError::Changed) => {
            control.check()?;
            run()
        }
        result => result,
    }
}

/// Return the record stamp; a fallback name lookup may inspect bounded headers.
pub fn stamp(
    agent: &str,
    id: &str,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<String, ReaderError> {
    sources::stamp_now(agent, id, roots, control)
}

pub fn part(
    agent: &str,
    id: &str,
    roots: &[String],
    request: &PartRequest,
    control: &TranscriptControl<'_>,
) -> Result<Value, ReaderError> {
    let session = Session::read(agent, id, roots, Some(&request.stamp), control)?;
    let item = session
        .items
        .get(request.index)
        .ok_or(ReaderError::InvalidPart)?;
    let mut replay = Replay::new(&session.sources, control);
    let from = request.offset;
    let to = from.saturating_add(PAGE);
    let output = match (&request.field, &item.body) {
        (PartField::Text, Body::Text(text)) => page(
            text.range(&mut replay, from, to)?,
            from,
            to,
            text.length,
            text.clipped,
        ),
        (PartField::Output, Body::Tool(tool)) => {
            let text = tool.output.as_ref().ok_or(ReaderError::InvalidPart)?;
            page(
                text.range(&mut replay, from, to)?,
                from,
                to,
                text.length,
                text.clipped,
            )
        }
        (PartField::Diff, Body::Tool(tool)) => {
            let (pointer, _, length) = tool.change.as_ref().ok_or(ReaderError::InvalidPart)?;
            let diff = &replay.change(*pointer)?.diff;
            page(
                utf16_slice(diff, from, to).to_owned(),
                from,
                to,
                *length,
                false,
            )
        }
        (PartField::Image, Body::Image { pointer, .. }) => match replay.event(*pointer)? {
            Event::Image { mime, data, .. } => {
                json!({"image": format!("data:{mime};base64,{data}")})
            }
            _ => return Err(ReaderError::Changed),
        },
        _ => return Err(ReaderError::InvalidPart),
    };
    replay.finish()?;
    Ok(output)
}

fn page(text: String, from: usize, to: usize, total: usize, clipped: bool) -> Value {
    json!({"text": text, "offset": from, "total": total, "next": (to < total).then_some(to), "clipped": clipped})
}

struct Matcher<'a> {
    needle: &'a [u8],
    prefix: Vec<usize>,
    matched: usize,
    count: usize,
}

impl<'a> Matcher<'a> {
    fn new(needle: &'a str) -> Self {
        let needle = needle.as_bytes();
        let mut prefix = vec![0; needle.len()];
        let mut matched = 0;
        for position in 1..needle.len() {
            while matched > 0 && needle[position] != needle[matched] {
                matched = prefix[matched - 1];
            }
            if needle[position] == needle[matched] {
                matched += 1;
            }
            prefix[position] = matched;
        }
        Self {
            needle,
            prefix,
            matched: 0,
            count: 0,
        }
    }

    fn visit(&mut self, text: &str) {
        let lower = text.to_lowercase();
        for byte in lower.bytes() {
            self.accept(byte);
        }
    }

    fn accept(&mut self, byte: u8) -> bool {
        while self.matched > 0 && byte != self.needle[self.matched] {
            self.matched = self.prefix[self.matched - 1];
        }
        if byte == self.needle[self.matched] {
            self.matched += 1;
        }
        if self.matched != self.needle.len() {
            return false;
        }
        self.count += 1;
        self.matched = 0;
        true
    }

    fn field(&mut self, text: &str) {
        self.matched = 0;
        self.visit(text);
    }
}

/// Count full-text matches, including across fragments joined into one reply.
pub fn find(
    agent: &str,
    id: &str,
    roots: &[String],
    request: &FindRequest,
    control: &TranscriptControl<'_>,
) -> Result<FindResult, ReaderError> {
    let needle = js_trim(&request.query).to_lowercase();
    if needle.is_empty() || units(&needle) > 120 {
        return Err(ReaderError::InvalidPart);
    }
    let session = Session::read(agent, id, roots, Some(&request.stamp), control)?;
    let mut replay = Replay::new(&session.sources, control);
    let mut hits = Vec::new();
    let mut matcher = Matcher::new(&needle);
    for (index, item) in session.items.iter().enumerate() {
        control.check()?;
        let old_count = matcher.count;
        matcher.matched = 0;
        match &item.body {
            Body::Text(text) => text.visit(&mut replay, 0, text.length, |fragment| {
                matcher.visit(fragment)
            })?,
            Body::Tool(tool) => {
                matcher.field(&tool.name);
                matcher.field(&tool.summary);
                if let Some(output) = &tool.output {
                    matcher.matched = 0;
                    output.visit(&mut replay, 0, output.length, |fragment| {
                        matcher.visit(fragment)
                    })?;
                }
                if let Some((pointer, _, _)) = &tool.change {
                    matcher.field(&replay.change(*pointer)?.diff);
                }
            }
            Body::Image { .. } => {}
        }
        let count = matcher.count - old_count;
        if count > 0 && hits.len() < HITS {
            hits.push(Hit { index, count });
        }
    }
    replay.finish()?;
    Ok(FindResult {
        hits,
        total: matcher.count,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileFact<'a> {
    path: &'a str,
    added: usize,
    removed: usize,
    calls: usize,
}

/// Return counts and change paths only. No text is read back through the offset index.
pub fn facts(
    agent: &str,
    id: &str,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<Value, ReaderError> {
    let session = Session::read(agent, id, roots, None, control)?;
    let mut files: IndexMap<&str, FileFact<'_>> = IndexMap::new();
    let mut sides = HashSet::new();
    let (mut turns, mut commands, mut compactions, mut images) = (0, 0, 0, 0);
    let (mut first, mut last, mut reported) = (None, None, None);
    let mut asked = false;
    for item in &session.items {
        control.check()?;
        sides.extend(item.side.as_deref());
        if let Some(at) = item.at.as_deref() {
            first.get_or_insert(at);
            last = Some(at);
        }
        if let Some(usage) = item.usage.filter(|usage| *usage != 0.0) {
            *reported.get_or_insert(0.0) += usage;
        }
        compactions += usize::from(item.kind == "compact");
        images += usize::from(item.kind == "image");
        let opens = item.side.is_none()
            && (item.kind == "user" || matches!(item.body, Body::Image { from: "user", .. }));
        if opens && !asked {
            turns += 1;
        }
        asked = opens;
        if let Body::Tool(tool) = &item.body {
            commands += tool.commands.as_ref().map_or_else(
                || {
                    let name = tool.name.to_ascii_lowercase();
                    usize::from(
                        [
                            "shell",
                            "bash",
                            "exec",
                            "local_shell",
                            "powershell",
                            "run_shell_command",
                            "run_command",
                        ]
                        .iter()
                        .any(|prefix| name.starts_with(prefix)),
                    )
                },
                Vec::len,
            );
            if !tool.failed {
                if let Some((_, changes, _)) = &tool.change {
                    for item in changes {
                        let path = item.path.as_str();
                        let fact = files.entry(path).or_insert(FileFact {
                            path,
                            added: 0,
                            removed: 0,
                            calls: 0,
                        });
                        fact.added += item.added;
                        fact.removed += item.removed;
                        fact.calls += 1;
                    }
                }
            }
        }
    }
    let (tools, failed) = session.count_tools();
    session.sources.verify()?;
    Ok(json!({
        "schemaVersion": "TranscriptFactsV1", "agent": agent, "stamp": session.sources.stamp(), "turns": turns,
        "tools": tools, "failed": failed, "commands": commands, "compactions": compactions, "images": images,
        "subagents": sides.len(), "reported": reported, "first": first, "last": last,
        "files": files.into_values().take(500).collect::<Vec<_>>(), "truncated": session.truncated
    }))
}

fn fenced(text: &str) -> String {
    let (mut longest, mut run) = (2, 0);
    for byte in text.bytes() {
        run = if byte == b'`' { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    let fence = "`".repeat(longest + 1);
    format!("{fence}\n{text}\n{fence}")
}

pub fn markdown(
    agent: &str,
    id: &str,
    roots: &[String],
    request: &MarkdownRequest,
    control: &TranscriptControl<'_>,
) -> Result<String, ReaderError> {
    let session = Session::read(agent, id, roots, Some(&request.stamp), control)?;
    let items = session
        .items
        .get(request.from..=request.to)
        .filter(|items| !items.is_empty())
        .ok_or(ReaderError::InvalidPart)?;
    let mut replay = Replay::new(&session.sources, control);
    if request.plain && items.len() == 1 {
        if let Body::Text(body) = &items[0].body {
            let text = body.range(&mut replay, 0, body.length)?;
            replay.finish()?;
            return Ok(text);
        }
    }
    let (mut result, mut length) = (String::new(), 0);
    for item in items {
        control.check()?;
        let text = match &item.body {
            Body::Text(body) => {
                if item.kind == "context" {
                    continue;
                }
                let text = body.range(&mut replay, 0, body.length)?;
                match item.kind {
                    "user" => format!("### 你\n\n{text}"),
                    "assistant" => format!("### 回复\n\n{text}"),
                    "thinking" => format!(
                        "> **思考**\n>\n{}",
                        text.split('\n')
                            .map(|line| format!("> {line}"))
                            .collect::<Vec<_>>()
                            .join("\n")
                    ),
                    "compact" => "---\n\n上下文在这里压缩了\n\n---".to_owned(),
                    "command" => format!("`{}`", text.replace('`', "'")),
                    _ => continue,
                }
            }
            Body::Image { .. } => "[图片]".to_owned(),
            Body::Tool(tool) => {
                let failed = if tool.failed { "（失败）" } else { "" };
                let mut line = format!(
                    "**{}**{failed}：{}",
                    tool.name,
                    tool.summary.replace('\n', " ")
                );
                if let Some((pointer, _, _)) = &tool.change {
                    line.push_str("\n\n");
                    line.push_str(&fenced(&replay.change(*pointer)?.diff));
                }
                if let Some(output) = tool.output.as_ref().filter(|output| output.length > 0) {
                    line.push_str("\n\n");
                    line.push_str(&fenced(&output.range(&mut replay, 0, output.length)?));
                }
                line
            }
        };
        length += units(&text);
        if length > MAX_ITEM {
            return Err(ReaderError::TooLarge);
        }
        if !result.is_empty() {
            result.push_str("\n\n");
        }
        result.push_str(&text);
    }
    replay.finish()?;
    result.push('\n');
    Ok(result)
}
