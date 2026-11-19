use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, sync::LazyLock};

const PATCH: &str = "*** Begin Patch";
const LCS_CELLS: usize = 40_000;
const CONTEXT: usize = 3;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Add,
    Delete,
    Edit,
    Write,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub kind: ChangeKind,
    pub added: usize,
    pub removed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptChange {
    pub files: Vec<ChangedFile>,
    pub diff: String,
}

fn lines(text: &str) -> impl Iterator<Item = &str> {
    text.split_inclusive('\n').map(|line| {
        if let Some(line) = line.strip_suffix('\n') {
            line.strip_suffix('\r').unwrap_or(line)
        } else {
            line
        }
    })
}

pub fn diff_lines(before: &str, after: &str) -> Vec<String> {
    let left: Vec<_> = lines(before).collect();
    let right: Vec<_> = lines(after).collect();
    let start = left
        .iter()
        .zip(&right)
        .take_while(|(left, right)| left == right)
        .count();
    let common_end = left[start..]
        .iter()
        .rev()
        .zip(right[start..].iter().rev())
        .take_while(|(left, right)| left == right)
        .count();
    let left_end = left.len() - common_end;
    let right_end = right.len() - common_end;
    let mut diff: Vec<_> = left[start.saturating_sub(CONTEXT)..start]
        .iter()
        .map(|line| format!(" {line}"))
        .collect();
    let removed = &left[start..left_end];
    let added = &right[start..right_end];
    if !removed.is_empty()
        && !added.is_empty()
        && removed.len().saturating_mul(added.len()) <= LCS_CELLS
    {
        let width = added.len() + 1;
        let mut scores = vec![0u16; (removed.len() + 1) * width];
        for (row, before) in removed.iter().enumerate().rev() {
            for (column, after) in added.iter().enumerate().rev() {
                scores[row * width + column] = if before == after {
                    scores[(row + 1) * width + column + 1] + 1
                } else {
                    scores[(row + 1) * width + column].max(scores[row * width + column + 1])
                };
            }
        }
        let (mut row, mut column) = (0, 0);
        while row < removed.len() || column < added.len() {
            if row < removed.len() && column < added.len() && removed[row] == added[column] {
                diff.push(format!(" {}", removed[row]));
                row += 1;
                column += 1;
            } else if row < removed.len()
                && (column == added.len()
                    || scores[(row + 1) * width + column] >= scores[row * width + column + 1])
            {
                diff.push(format!("-{}", removed[row]));
                row += 1;
            } else {
                diff.push(format!("+{}", added[column]));
                column += 1;
            }
        }
    } else {
        diff.extend(removed.iter().map(|line| format!("-{line}")));
        diff.extend(added.iter().map(|line| format!("+{line}")));
    }
    diff.extend(
        left[left_end..(left_end + CONTEXT).min(left.len())]
            .iter()
            .map(|line| format!(" {line}")),
    );
    diff
}

struct Section {
    path: String,
    kind: ChangeKind,
    to: Option<String>,
    lines: Vec<String>,
}

fn assemble(sections: impl IntoIterator<Item = Section>) -> TranscriptChange {
    let mut files = Vec::new();
    let mut diff = String::new();
    for Section {
        path,
        kind,
        to,
        lines,
    } in sections
    {
        if !files.is_empty() {
            diff.push('\n');
        }
        diff.push_str("*** ");
        diff.push_str(&path);
        let (mut added, mut removed) = (0, 0);
        for line in lines {
            added += usize::from(line.starts_with('+'));
            removed += usize::from(line.starts_with('-'));
            diff.push('\n');
            diff.push_str(&line);
        }
        files.push(ChangedFile {
            path,
            kind,
            added,
            removed,
            to,
        });
    }
    TranscriptChange { files, diff }
}

fn diff_line(line: &str) -> bool {
    line.starts_with("@@") || line.starts_with(['+', '-', ' '])
}

pub fn from_patch(text: &str) -> Option<TranscriptChange> {
    let (_, body) = text.split_once(PATCH)?;
    let mut sections: Vec<Section> = Vec::new();
    for line in lines(body) {
        if line.starts_with("*** End Patch") {
            break;
        }
        if let Some((kind, name)) = [
            ("*** Add File: ", ChangeKind::Add),
            ("*** Delete File: ", ChangeKind::Delete),
            ("*** Update File: ", ChangeKind::Edit),
        ]
        .into_iter()
        .find_map(|(head, kind)| {
            line.strip_prefix(head)
                .filter(|name| !name.is_empty())
                .map(|name| (kind, name))
        }) {
            sections.push(Section {
                path: name.trim().to_owned(),
                kind,
                to: None,
                lines: Vec::new(),
            });
        } else if let Some(current) = sections.last_mut() {
            if let Some(destination) = line
                .strip_prefix("*** Move to: ")
                .filter(|value| !value.is_empty())
            {
                current.to = Some(destination.trim().to_owned()).filter(|value| !value.is_empty());
            } else if !line.starts_with("*** ") && diff_line(line) {
                current.lines.push(line.to_owned());
            }
        }
    }
    (!sections.is_empty()).then(|| assemble(sections))
}

fn text_fields<'a>(
    value: &'a Value,
    before: &[&str],
    after: &[&str],
) -> Option<(&'a str, &'a str)> {
    let first_text = |fields: &[&str]| {
        fields
            .iter()
            .find_map(|key| value.get(key).filter(|value| !value.is_null()))
            .and_then(Value::as_str)
    };
    Some((first_text(before)?, first_text(after)?))
}

/// Derive an edit description from recorded tools. Nothing is executed or written.
pub fn change(name: &str, input: &Value) -> Option<TranscriptChange> {
    let parsed = input
        .as_str()
        .and_then(|source| serde_json::from_str::<Value>(source).ok());
    let value = parsed
        .as_ref()
        .filter(|parsed| !parsed.is_null())
        .unwrap_or(input);
    if let Some(text) = value.as_str() {
        return from_patch(text);
    }
    let command_array = value["command"].as_array().map(|parts| {
        parts
            .iter()
            .map(|part| part.as_str().unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n")
    });
    let command = command_array.as_deref().or_else(|| {
        value
            .get("command")
            .filter(|value| !value.is_null())
            .unwrap_or(&value["cmd"])
            .as_str()
    });
    for candidate in [
        value["input"].as_str(),
        value["patch"].as_str(),
        value["patchText"].as_str(),
        value["patch_text"].as_str(),
        command,
    ]
    .into_iter()
    .flatten()
    {
        if candidate.contains(PATCH) {
            return from_patch(candidate);
        }
    }
    let path = ["file_path", "filePath", "path"]
        .into_iter()
        .find_map(|key| value[key].as_str().filter(|path| !path.trim().is_empty()))?;
    let old = ["old_string", "oldString"];
    let new = ["new_string", "newString"];
    let (kind, lines) = match name.to_ascii_lowercase().as_str() {
        "edit" | "replace" | "multiedit" if value["edits"].is_array() => {
            let lines: Vec<_> = value["edits"]
                .as_array()?
                .iter()
                .filter_map(|edit| text_fields(edit, &old, &new))
                .flat_map(|(before, after)| diff_lines(before, after))
                .collect();
            if lines.is_empty() {
                return None;
            }
            (ChangeKind::Edit, lines)
        }
        "edit" | "replace" => {
            let (before, after) = text_fields(value, &old, &new)?;
            (ChangeKind::Edit, diff_lines(before, after))
        }
        "write" | "write_file" => (
            ChangeKind::Write,
            lines(value["content"].as_str()?)
                .map(|line| format!("+{line}"))
                .collect(),
        ),
        "str_replace_editor" if value["command"] == "str_replace" => (
            ChangeKind::Edit,
            diff_lines(value["old_str"].as_str()?, value["new_str"].as_str()?),
        ),
        _ => return None,
    };
    Some(assemble([Section {
        path: path.to_owned(),
        kind,
        to: None,
        lines,
    }]))
}

fn decode_uri(value: &str) -> Option<String> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut remaining = value.as_bytes();
    while let Some((&start, tail)) = remaining.split_first() {
        if start != b'%' {
            bytes.push(start);
            remaining = tail;
            continue;
        }
        let hex = std::str::from_utf8(tail.get(..2)?).ok()?;
        if !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return None;
        }
        let code = u8::from_str_radix(hex, 16).ok()?;
        if b";/?:@&=+$,#".contains(&code) {
            bytes.extend_from_slice(&remaining[..3]);
        } else {
            bytes.push(code);
        }
        remaining = &tail[2..];
    }
    String::from_utf8(bytes).ok()
}

pub fn from_antigravity(
    content: &str,
    written: &HashMap<String, String>,
) -> Option<TranscriptChange> {
    static NAMED: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"\btool to: (.+?)(?:\.\s|\.?\n|$)").ok());
    if let Some((head, body)) = content.split_once("[diff_block_start]") {
        let path = NAMED
            .as_ref()?
            .captures(head)?
            .get(1)?
            .as_str()
            .trim()
            .to_owned();
        let body = body
            .split_once("[diff_block_end]")
            .map_or(body, |(body, _)| body);
        let selected: Vec<_> = lines(body)
            .filter(|line| diff_line(line))
            .map(str::to_owned)
            .collect();
        return (!selected.is_empty()).then(|| {
            assemble([Section {
                path,
                kind: ChangeKind::Edit,
                to: None,
                lines: selected,
            }])
        });
    }
    let path = antigravity_created_path(content)?;
    let text = written.get(&path.to_lowercase())?;
    Some(assemble([Section {
        path,
        kind: ChangeKind::Write,
        to: None,
        lines: lines(text).map(|line| format!("+{line}")).collect(),
    }]))
}

pub(super) fn antigravity_created_path(content: &str) -> Option<String> {
    static CREATED: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"Created file file:///?(\S+) with requested content").ok());
    let path = CREATED.as_ref()?.captures(content)?.get(1)?.as_str();
    let mut path = decode_uri(path).unwrap_or_else(|| path.to_owned());
    if !matches!(path.as_bytes(), [drive, b':', ..] if drive.is_ascii_alphabetic()) {
        path.insert(0, '/');
    }
    Some(path)
}
