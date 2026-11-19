use crate::{
    policy::{self, Audit},
    transcript::{ReaderError, TranscriptControl},
    transcript_database, transcript_documents,
    transcript_events::{self, RowEvents},
    transcript_lines::{self, JsonlReader, SourceEpoch},
    transcript_marks::prefix,
    transcript_more,
    transcript_plan::Plan,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    ops::ControlFlow,
    path::{Path, PathBuf},
};

pub const MAX_FILE: u64 = 512 * 1024 * 1024;
const MAX_HEADERS: usize = 5000;
const HEAD: usize = 64 * 1024;
const MAX_SUBAGENTS: usize = 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Format {
    Codex,
    Claude,
    Copilot,
    WorkBuddy,
    Cursor,
    OpenCode,
    MiMo,
    ZCode,
    Kilo,
    Cline,
    Continue,
    Gemini,
    Pi,
    Qwen,
    DeepSeek,
    Kimi,
    Antigravity,
}

impl Format {
    pub fn parse(agent: &str) -> Result<Self, ReaderError> {
        match agent {
            "codex" => Ok(Self::Codex),
            "claude" => Ok(Self::Claude),
            "copilot" => Ok(Self::Copilot),
            "workbuddy" => Ok(Self::WorkBuddy),
            "cursor" => Ok(Self::Cursor),
            "opencode" => Ok(Self::OpenCode),
            "mimo" => Ok(Self::MiMo),
            "zcode" => Ok(Self::ZCode),
            "kilo" => Ok(Self::Kilo),
            "cline" => Ok(Self::Cline),
            "continue" => Ok(Self::Continue),
            "gemini" => Ok(Self::Gemini),
            "pi" => Ok(Self::Pi),
            "qwen" => Ok(Self::Qwen),
            "deepseek" => Ok(Self::DeepSeek),
            "kimi" => Ok(Self::Kimi),
            "antigravity" => Ok(Self::Antigravity),
            _ => Err(ReaderError::Unsupported),
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
            Self::Copilot => "copilot",
            Self::WorkBuddy => "workbuddy",
            Self::Cursor => "cursor",
            Self::OpenCode => "opencode",
            Self::MiMo => "mimo",
            Self::ZCode => "zcode",
            Self::Kilo => "kilo",
            Self::Cline => "cline",
            Self::Continue => "continue",
            Self::Gemini => "gemini",
            Self::Pi => "pi",
            Self::Qwen => "qwen",
            Self::DeepSeek => "deepseek",
            Self::Kimi => "kimi",
            Self::Antigravity => "antigravity",
        }
    }

    fn listing_rule(self) -> &'static str {
        match self {
            Self::Cursor => "transcript:cursor",
            Self::Cline => "transcript:cline",
            Self::Kilo => "transcript:kilo",
            Self::Continue => "transcript:continue",
            other => other.name(),
        }
    }

    fn file_id(self, file: &Path) -> Option<&str> {
        let stem = path_name(file);
        match self {
            Self::Codex => uuid_suffix(stem),
            Self::Copilot | Self::Cline | Self::Kilo => file.parent()?.file_name()?.to_str(),
            Self::Claude | Self::Cursor | Self::WorkBuddy | Self::Continue | Self::Qwen => {
                (!stem.is_empty()).then_some(stem)
            }
            Self::Pi => stem.rsplit('_').next().filter(|id| !id.is_empty()),
            Self::DeepSeek => file.parent()?.file_name()?.to_str(),
            Self::Kimi => {
                let parent = file.parent()?;
                if parent.parent()?.file_name()? == "agents" {
                    parent.parent()?.parent()?.file_name()?.to_str()
                } else {
                    parent.file_name()?.to_str()
                }
            }
            Self::Antigravity => file.ancestors().nth(3)?.file_name()?.to_str(),
            Self::Gemini | Self::OpenCode | Self::MiMo | Self::ZCode => None,
        }
    }

    pub fn database(self) -> bool {
        matches!(self, Self::OpenCode | Self::MiMo | Self::ZCode | Self::Kilo)
    }

    fn permitted_file(self, file: &Path) -> bool {
        file.extension().is_some_and(|extension| match self {
            Self::Cline | Self::Kilo | Self::Continue => extension == "json",
            Self::Gemini => extension == "json" || extension == "jsonl",
            Self::DeepSeek => extension == "jsonl" || extension == "zstd",
            Self::OpenCode | Self::MiMo | Self::ZCode => false,
            _ => extension == "jsonl",
        })
    }

    fn list(self, root: &str) -> Vec<PathBuf> {
        if self == Self::Continue {
            let path = Path::new(root);
            let Some(parent) = path.parent().and_then(Path::parent) else {
                return Vec::new();
            };
            return placed_subagents(parent, &["sessions"], self.listing_rule());
        }
        list(self.listing_rule(), root)
            .into_iter()
            .filter(|file| self.permitted_file(file))
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Decode {
    Codex { events: bool },
    Claude { embedded: bool },
    Copilot,
    WorkBuddy,
    Cursor,
    OpenFamily(Format),
    Cline(Format),
    Continue,
    Gemini,
    Pi,
    Qwen,
    DeepSeek,
    Kimi,
    Antigravity,
}

pub struct Source {
    pub path: PathBuf,
    pub epoch: Option<SourceEpoch>,
    pub decode: Decode,
    pub side: Option<String>,
    pub rows: Option<Vec<Value>>,
    pub plan: Option<Plan>,
}

impl Source {
    pub fn row(&self, row: &Value) -> RowEvents {
        match self.decode {
            Decode::Codex { events } => transcript_events::codex(row, events),
            Decode::Claude { embedded } => {
                transcript_events::claude(row, self.side.as_deref(), embedded)
            }
            Decode::Copilot => transcript_more::copilot(row),
            Decode::WorkBuddy => transcript_more::workbuddy(row),
            Decode::Cursor => transcript_more::cursor(row, self.side.as_deref()),
            Decode::OpenFamily(format) => {
                transcript_documents::open_message(row, format.name(), self.side.as_deref())
            }
            Decode::Cline(format) => transcript_documents::cline(row, format.name()),
            Decode::Continue => transcript_documents::continue_message(row),
            Decode::Gemini => transcript_documents::gemini(row),
            Decode::Pi => transcript_documents::pi(row),
            Decode::Qwen => transcript_documents::qwen(row),
            Decode::DeepSeek => transcript_documents::deepseek(row),
            Decode::Kimi => transcript_more::kimi(row, None),
            Decode::Antigravity => transcript_more::antigravity(row, None, None),
        }
    }

    pub fn open(&self) -> Result<JsonlReader, ReaderError> {
        let reader = open_jsonl(&self.path)?;
        if Some(reader.epoch()) != self.epoch {
            return Err(ReaderError::Changed);
        }
        Ok(reader)
    }

    pub fn exists_unchanged(&self) -> bool {
        self.path.as_os_str().is_empty() || transcript_lines::epoch(&self.path).ok() == self.epoch
    }
}

fn open_jsonl(path: &Path) -> Result<JsonlReader, ReaderError> {
    if path.extension().is_some_and(|suffix| suffix == "zstd") {
        Ok(JsonlReader::open_compressed(path, MAX_FILE)?)
    } else {
        Ok(JsonlReader::open(path, MAX_FILE)?)
    }
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

pub(super) fn path_name(file: &Path) -> &str {
    file.file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
}

fn header_matches(file: &Path, format: Format, id: &str) -> bool {
    if format == Format::DeepSeek {
        let Ok(mut reader) = open_jsonl(file) else {
            return false;
        };
        let mut found = false;
        let checked = reader.visit(|_, _, row| {
            found = row.is_some_and(|row| row["id"] == id);
            ControlFlow::Break(())
        });
        return checked.is_ok() && found;
    }
    if format == Format::Gemini {
        return gemini_id(file).as_deref() == Some(id);
    }
    let Ok(mut reader) = JsonlReader::open(file, MAX_FILE) else {
        return false;
    };
    let Ok(head) = reader.read_prefix(HEAD) else {
        return false;
    };
    head.split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_str::<Value>(&String::from_utf8_lossy(line)).ok())
        .any(|row| match format {
            Format::Codex => row["type"] == "session_meta" && row["payload"]["id"] == id,
            Format::Claude | Format::WorkBuddy | Format::Qwen => row["sessionId"] == id,
            Format::Pi => row["id"] == id,
            _ => false,
        })
}

fn gemini_id(file: &Path) -> Option<String> {
    use std::sync::LazyLock;
    static ID: LazyLock<Option<regex::Regex>> =
        LazyLock::new(|| regex::Regex::new(r#""sessionId"\s*:\s*"([A-Za-z0-9_-]{1,128})""#).ok());
    let mut reader = JsonlReader::open(file, MAX_FILE).ok()?;
    let bytes = reader.read_prefix(HEAD).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    Some(ID.as_ref()?.captures(&text)?.get(1)?.as_str().to_owned())
}

fn by_name(file: &Path, format: Format, id: &str) -> bool {
    if !matches!(format, Format::Codex | Format::Claude) {
        return format.file_id(file) == Some(id);
    }
    let stem = path_name(file);
    stem == id
        || matches!(format, Format::Codex)
            && stem
                .strip_suffix(id)
                .is_some_and(|prefix| prefix.ends_with('-'))
}

pub(super) fn list(agent: &str, root: &str) -> Vec<PathBuf> {
    policy::files_under(agent, root, &mut Audit::new(), None).map_or_else(
        |_| Vec::new(),
        |result| result.files.into_iter().map(PathBuf::from).collect(),
    )
}

fn uuid_suffix(name: &str) -> Option<&str> {
    let suffix = name.get(name.len().checked_sub(36)?..)?;
    suffix
        .bytes()
        .enumerate()
        .all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
        .then_some(suffix)
}

pub fn file_index(
    format: Format,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<HashMap<String, PathBuf>, ReaderError> {
    let mut index = HashMap::<String, (PathBuf, (bool, u64))>::new();
    for root in roots {
        control.check()?;
        for file in format.list(root) {
            control.check()?;
            let id = if format == Format::Gemini {
                gemini_id(&file)
            } else {
                format.file_id(&file).map(str::to_owned)
            };
            let Some(id) = id else {
                continue;
            };
            let Some(epoch) = transcript_lines::epoch(&file).ok() else {
                continue;
            };
            let rank = if format == Format::Antigravity {
                (full_antigravity(&file), 0)
            } else if format == Format::DeepSeek {
                (false, version(&file))
            } else if format == Format::Gemini {
                (
                    file.extension()
                        .is_some_and(|extension| extension == "jsonl"),
                    0,
                )
            } else {
                (false, epoch.length)
            };
            if index.get(&id).is_none_or(|(_, old)| rank > *old) {
                index.insert(id, (file, rank));
            }
        }
    }
    Ok(index
        .into_iter()
        .map(|(id, (path, _))| (id, path))
        .collect())
}

fn main_file(
    format: Format,
    id: &str,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<PathBuf, ReaderError> {
    let mut paths = Vec::new();
    for root in roots {
        control.check()?;
        if format == Format::Antigravity {
            let descend = |directory: &str, name: &str| {
                let path = Path::new(directory);
                let brain =
                    |path: &Path| path.file_name().and_then(|name| name.to_str()) == Some("brain");
                if brain(path) {
                    return name == id;
                }
                if path.parent().is_some_and(brain) {
                    return name == ".system_generated";
                }
                if path
                    .file_name()
                    .is_some_and(|name| name == ".system_generated")
                    && path.parent().and_then(Path::parent).is_some_and(brain)
                {
                    return name == "logs";
                }
                true
            };
            if let Ok(listed) =
                policy::files_under("antigravity", root, &mut Audit::new(), Some(&descend))
            {
                paths.extend(listed.files.into_iter().map(PathBuf::from));
            }
        } else {
            paths.extend(format.list(root));
        }
    }
    let mut matching: Vec<_> = paths
        .iter()
        .filter(|file| by_name(file, format, id))
        .collect();
    if matching.is_empty()
        && matches!(
            format,
            Format::Codex
                | Format::Claude
                | Format::WorkBuddy
                | Format::Gemini
                | Format::Pi
                | Format::Qwen
                | Format::DeepSeek
        )
    {
        for path in paths
            .iter()
            .filter(|file| {
                file.parent()
                    .and_then(Path::file_name)
                    .is_none_or(|name| name != "subagents")
            })
            .take(if format == Format::DeepSeek {
                500
            } else {
                MAX_HEADERS
            })
        {
            control.check()?;
            if header_matches(path, format, id) {
                matching.push(path);
            }
        }
    }
    let mut best = None;
    for file in matching {
        if let Ok(epoch) = transcript_lines::epoch(file) {
            let modified = matches!(format, Format::Codex | Format::Claude | Format::Gemini)
                .then_some(epoch.modified);
            let size_rank = if format == Format::DeepSeek {
                version(file)
            } else {
                epoch.length
            };
            let preferred = match format {
                Format::Gemini => file
                    .extension()
                    .is_some_and(|extension| extension == "jsonl"),
                Format::Antigravity => full_antigravity(file),
                Format::Kimi => file
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name == "main"),
                _ => false,
            };
            let size_rank = if format == Format::Antigravity {
                0
            } else {
                size_rank
            };
            let key = (preferred, size_rank, modified);
            if best.as_ref().is_none_or(|(_, previous)| key > *previous) {
                best = Some((file, key));
            }
        }
    }
    best.map(|(path, _)| path.to_owned())
        .ok_or(ReaderError::NotFound)
}

fn version(file: &Path) -> u64 {
    file.to_str()
        .and_then(crate::extended_sources::generation)
        .unwrap_or_default()
        .max(0) as u64
}

fn full_antigravity(file: &Path) -> bool {
    file.file_name()
        .is_some_and(|name| name == "transcript_full.jsonl")
}

fn agent_file(file: &Path) -> bool {
    file.extension()
        .is_some_and(|extension| extension == "jsonl")
        && path_name(file)
            .strip_prefix("agent-")
            .is_some_and(|name| !name.is_empty())
}

pub(super) fn placed_directory(parent: &Path, middle: &[&str]) -> Option<PathBuf> {
    let directory = middle
        .iter()
        .fold(parent.to_owned(), |path, name| path.join(name));
    let expected = parent
        .canonicalize()
        .ok()
        .map(|root| middle.iter().fold(root, |path, name| path.join(name)));
    if expected.is_none() || directory.canonicalize().ok() != expected {
        return None;
    }
    Some(directory)
}

pub(super) fn placed_subagents(parent: &Path, middle: &[&str], rule: &str) -> Vec<PathBuf> {
    placed_directory(parent, middle)
        .as_deref()
        .and_then(Path::to_str)
        .map(|root| list(rule, root))
        .unwrap_or_default()
}

fn sort_subagents(files: &mut Vec<PathBuf>) {
    files.sort_by(|left, right| {
        left.to_string_lossy()
            .encode_utf16()
            .cmp(right.to_string_lossy().encode_utf16())
    });
    files.truncate(MAX_SUBAGENTS);
}

fn subagents(
    main: &Path,
    id: &str,
    control: &TranscriptControl<'_>,
) -> Result<Vec<PathBuf>, ReaderError> {
    let Some(parent) = main.parent() else {
        return Ok(Vec::new());
    };
    let mut files = placed_subagents(parent, &[path_name(main), "subagents"], "claude");
    files.retain(|file| agent_file(file));
    if !agent_file(main) {
        if let Ok(entries) = fs::read_dir(parent) {
            let mut siblings: Vec<_> = entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|file| agent_file(file))
                .collect();
            siblings.sort();
            for sibling in siblings.into_iter().take(MAX_HEADERS) {
                control.check()?;
                if header_matches(&sibling, Format::Claude, id) {
                    files.push(sibling);
                }
            }
        }
    }
    sort_subagents(&mut files);
    Ok(files)
}

pub struct Sources {
    pub format: Format,
    pub sources: Vec<Source>,
    pub dependencies: Vec<(PathBuf, Option<SourceEpoch>)>,
}

impl Sources {
    pub fn resolve(
        agent: &str,
        id: &str,
        roots: &[String],
        control: &TranscriptControl<'_>,
    ) -> Result<Self, ReaderError> {
        let format = Format::parse(agent)?;
        if !valid_id(id) {
            return Err(ReaderError::NotFound);
        }
        if format.database() && format != Format::Kilo {
            return transcript_database::resolve(format, id, roots, control);
        }
        let main = match main_file(format, id, roots, control) {
            Err(ReaderError::NotFound) if format == Format::Kilo => {
                return transcript_database::resolve(format, id, roots, control)
            }
            result => result?,
        };
        Self::from_listed(format, main, id, true, control)
    }

    pub fn from_listed(
        format: Format,
        main: PathBuf,
        id: &str,
        direct: bool,
        control: &TranscriptControl<'_>,
    ) -> Result<Self, ReaderError> {
        let children = match format {
            Format::Claude => subagents(&main, id, control)?,
            Format::Cursor if direct => {
                let mut files = main
                    .parent()
                    .map(|parent| placed_subagents(parent, &["subagents"], "transcript:cursor-sub"))
                    .unwrap_or_default();
                sort_subagents(&mut files);
                files
            }
            _ => Vec::new(),
        };
        let decode = match format {
            Format::Codex => Decode::Codex { events: false },
            Format::Claude => Decode::Claude {
                embedded: direct && children.is_empty(),
            },
            Format::Copilot => Decode::Copilot,
            Format::WorkBuddy => Decode::WorkBuddy,
            Format::Cursor => Decode::Cursor,
            Format::Cline | Format::Kilo => Decode::Cline(format),
            Format::Continue => Decode::Continue,
            Format::Gemini => Decode::Gemini,
            Format::Pi => Decode::Pi,
            Format::Qwen => Decode::Qwen,
            Format::DeepSeek => Decode::DeepSeek,
            Format::Kimi => Decode::Kimi,
            Format::Antigravity => Decode::Antigravity,
            _ => return Err(ReaderError::Unsupported),
        };
        let epoch = transcript_lines::epoch(&main).map_err(ReaderError::from)?;
        let mut sources = vec![Source {
            path: main,
            epoch: Some(epoch),
            decode,
            side: None,
            rows: None,
            plan: None,
        }];
        sources.extend(children.into_iter().map(|path| {
            let epoch = transcript_lines::epoch(&path).ok();
            let (decode, side) = if matches!(format, Format::Cursor) {
                (Decode::Cursor, prefix(path_name(&path), 12))
            } else {
                (
                    Decode::Claude { embedded: false },
                    path_name(&path)
                        .strip_prefix("agent-")
                        .filter(|id| !id.is_empty())
                        .unwrap_or("agent"),
                )
            };
            let side = side.to_owned();
            Source {
                path,
                epoch,
                decode,
                side: Some(side),
                rows: None,
                plan: None,
            }
        }));
        Ok(Self {
            format,
            sources,
            dependencies: Vec::new(),
        })
    }

    pub fn stamp(&self) -> String {
        if self.dependencies.is_empty() {
            return stamp_of(self.sources.iter().map(|source| source.epoch));
        }
        stamp_of(self.dependencies.iter().map(|(_, epoch)| *epoch))
    }

    pub fn verify(&self) -> Result<(), ReaderError> {
        if self.sources.iter().all(Source::exists_unchanged)
            && self
                .dependencies
                .iter()
                .all(|(file, saved)| transcript_lines::epoch(file).ok() == *saved)
        {
            Ok(())
        } else {
            Err(ReaderError::Changed)
        }
    }
}

pub(super) fn stamp_of(epochs: impl IntoIterator<Item = Option<SourceEpoch>>) -> String {
    let stamp = epochs
        .into_iter()
        .map(|epoch| {
            epoch.map_or_else(
                || "-".to_owned(),
                |epoch| format!("{}:{}", epoch.length, epoch.rounded_ms()),
            )
        })
        .collect::<Vec<_>>()
        .join("|");
    if stamp.len() > 64 {
        format!("{:x}", Sha256::digest(stamp.as_bytes()))
    } else {
        stamp
    }
}

pub(super) fn stamp_now(
    agent: &str,
    id: &str,
    roots: &[String],
    control: &TranscriptControl<'_>,
) -> Result<String, ReaderError> {
    let format = Format::parse(agent)?;
    if !valid_id(id) {
        return Err(ReaderError::NotFound);
    }
    if format.database() && format != Format::Kilo {
        return transcript_database::stamp_now(format, id, roots, control);
    }
    let file = match main_file(format, id, roots, control) {
        Err(ReaderError::NotFound) if format == Format::Kilo => {
            return transcript_database::stamp_now(format, id, roots, control)
        }
        result => result?,
    };
    if file
        .extension()
        .is_some_and(|extension| extension == "json")
    {
        return Ok(stamp_of([transcript_lines::epoch(&file).ok()]));
    }
    Ok(Sources::from_listed(format, file, id, true, control)?.stamp())
}

pub fn prepare_codex(
    source: &mut Source,
    reader: &mut JsonlReader,
    control: &TranscriptControl<'_>,
) -> Result<(), ReaderError> {
    let mut messages = false;
    reader.visit(|_, _, row| {
        if control.check().is_err() {
            return ControlFlow::Break(());
        }
        if row.as_ref().is_some_and(transcript_events::codex_message) {
            messages = true;
            ControlFlow::Break(())
        } else {
            ControlFlow::Continue(())
        }
    })?;
    control.check()?;
    source.decode = Decode::Codex { events: !messages };
    reader.rewind()?;
    Ok(())
}
