use crate::{session_list::valid_key, sessions::title, store_io::atomic};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    fmt, fs, io,
    path::{Path, PathBuf},
};

pub const FILE: &str = "session-labels.json";
const SCHEMA: &str = "SessionLabelsV1";
const MAX_LABELS: usize = 10_000;
const MAX_TURN: u32 = 100_000;
const MAX_GROUP: usize = 40;

#[derive(Debug)]
pub enum LabelError {
    NotFound,
    Invalid,
    Limit,
    Storage(io::Error),
}

impl fmt::Display for LabelError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::NotFound => "SESSION_NOT_FOUND",
            Self::Invalid => "SESSION_LABEL_INVALID",
            Self::Limit => "SESSION_LABEL_LIMIT",
            Self::Storage(_) => "LOCAL_STORAGE_INVALID",
        })
    }
}

impl std::error::Error for LabelError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Storage(error) => Some(error),
            _ => None,
        }
    }
}

#[derive(Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLabel {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}

fn turn(value: &Value) -> Option<u32> {
    let value = value.as_f64()?;
    (value > 0.0 && value <= f64::from(MAX_TURN) && value.fract() == 0.0).then_some(value as u32)
}

fn group(value: Option<&Value>) -> Option<String> {
    let mut group = title(value)?;
    let mut length = 0;
    let end = group.char_indices().find_map(|(index, character)| {
        length += character.len_utf16();
        (length > MAX_GROUP).then_some(index)
    });
    if let Some(end) = end {
        group.truncate(end);
    }
    Some(group)
}

fn entry(value: &Value) -> Option<Value> {
    let label = SessionLabel {
        alias: title(value.get("alias")),
        pinned: value["pinned"].as_bool().filter(|pinned| *pinned),
        turn: turn(&value["turn"]),
        group: group(value.get("group")),
    };
    if label.alias.is_none()
        && label.pinned.is_none()
        && label.turn.is_none()
        && label.group.is_none()
    {
        return None;
    }
    serde_json::to_value(label).ok()
}

fn read(file: &Path) -> Map<String, Value> {
    let saved = fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    saved
        .filter(|value| value["schemaVersion"] == SCHEMA)
        .and_then(|saved| {
            saved["labels"].as_object().map(|labels| {
                labels
                    .iter()
                    .take(MAX_LABELS)
                    .filter(|(key, _)| valid_key(key))
                    .filter_map(|(key, value)| entry(value).map(|label| (key.to_owned(), label)))
                    .collect()
            })
        })
        .unwrap_or_default()
}

pub struct SessionLabels {
    file: PathBuf,
    labels: Map<String, Value>,
}

impl SessionLabels {
    /// Read the app's own label file; an absent, malformed or foreign file is empty.
    pub fn open(directory: &Path) -> Self {
        let file = directory.join(FILE);
        let labels = read(&file);
        Self { file, labels }
    }

    pub fn all(&self) -> &Map<String, Value> {
        &self.labels
    }

    /// Set or clear only the whitelisted fields and commit atomically before publishing.
    pub fn set(&mut self, key: &str, patch: &Value) -> Result<&Map<String, Value>, LabelError> {
        if !valid_key(key) {
            return Err(LabelError::NotFound);
        }
        let patch = patch
            .as_object()
            .filter(|patch| !patch.is_empty())
            .ok_or(LabelError::Invalid)?;
        for (field, value) in patch {
            let valid = match field.as_str() {
                "alias" | "group" => {
                    value.is_null()
                        || value
                            .as_str()
                            .is_some_and(|text| text.encode_utf16().count() <= 400)
                }
                "pinned" => value.is_boolean(),
                "turn" => value.is_null() || turn(value).is_some(),
                _ => false,
            };
            if !valid {
                return Err(LabelError::Invalid);
            }
        }
        let mut merged = self
            .labels
            .get(key)
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        merged.extend(
            patch
                .iter()
                .map(|(field, value)| (field.to_owned(), value.to_owned())),
        );
        let next = entry(&Value::Object(merged));
        if next.is_some() && self.labels.len() >= MAX_LABELS && !self.labels.contains_key(key) {
            return Err(LabelError::Limit);
        }
        let mut labels = self.labels.clone();
        if let Some(next) = next {
            labels.insert(key.to_owned(), next);
        } else {
            labels.shift_remove(key);
        }
        let mut saved = json!({"schemaVersion": SCHEMA, "labels": null});
        saved["labels"] = Value::Object(labels);
        atomic(&self.file, &saved, false).map_err(LabelError::Storage)?;
        if let Value::Object(labels) = saved["labels"].take() {
            self.labels = labels;
        }
        Ok(self.all())
    }
}
