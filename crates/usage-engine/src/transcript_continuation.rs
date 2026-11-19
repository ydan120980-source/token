use crate::{js_json, session_list::valid_key};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fmt;

pub const STEP: usize = 64;
pub const MAX_ITEMS: usize = 500_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidTranscriptPart;

impl fmt::Display for InvalidTranscriptPart {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TRANSCRIPT_PART_INVALID")
    }
}

impl std::error::Error for InvalidTranscriptPart {}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContinuationProof {
    pub count: usize,
    pub digests: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptDelta {
    pub schema_version: &'static str,
    pub offset: usize,
    pub transcript: Value,
    pub continuation: ContinuationProof,
}

fn index(value: &Value) -> Option<usize> {
    let value = value.as_f64()?;
    (value >= 0.0 && value <= MAX_ITEMS as f64 && value.fract() == 0.0).then_some(value as usize)
}

pub fn validate(value: &Value) -> Result<ContinuationProof, InvalidTranscriptPart> {
    let map = value.as_object().ok_or(InvalidTranscriptPart)?;
    if map.len() != 2 {
        return Err(InvalidTranscriptPart);
    }
    let count = index(&value["count"]).ok_or(InvalidTranscriptPart)?;
    let digests = value["digests"]
        .as_array()
        .filter(|digests| digests.len() == count.div_ceil(STEP))
        .ok_or(InvalidTranscriptPart)?;
    let digests = digests
        .iter()
        .map(|digest| {
            digest
                .as_str()
                .filter(|digest| valid_key(digest))
                .map(str::to_owned)
                .ok_or(InvalidTranscriptPart)
        })
        .collect::<Result<_, _>>()?;
    Ok(ContinuationProof { count, digests })
}

fn full(value: &Value) -> Option<&Vec<Value>> {
    (value["schemaVersion"] == "TranscriptV2"
        && value["agent"].is_string()
        && value["stamp"]
            .as_str()
            .is_some_and(|stamp| stamp.encode_utf16().count() <= 200))
    .then(|| value["items"].as_array())
    .flatten()
    .filter(|items| items.len() <= MAX_ITEMS)
}

pub fn request(previous: &Value) -> ContinuationProof {
    full(previous)
        .and_then(|items| {
            validate(&previous["continuation"])
                .ok()
                .filter(|proof| proof.count == items.len())
        })
        .unwrap_or_default()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn digest_text(hash: &mut Sha256, item: &Value, scratch: &mut Vec<u8>) {
    if let Some(text) = item["text"].as_str() {
        let units = text.encode_utf16().count();
        if units > 4096 {
            hash.update(b"text:");
            hash.update(js_json::stringify_without_field(item, "text").as_bytes());
            hash.update(format!("\0{units}:"));
            for unit in text.encode_utf16() {
                scratch.extend_from_slice(&unit.to_le_bytes());
                if scratch.len() == scratch.capacity() {
                    hash.update(&*scratch);
                    scratch.clear();
                }
            }
            hash.update(&*scratch);
            scratch.clear();
            return;
        }
    }
    hash.update(b"json:");
    hash.update(js_json::stringify(item).as_bytes());
}

/// Verify the previous preview against current content and transfer only the changed suffix.
pub fn make(
    mut transcript: Value,
    id: &str,
    provided: &Value,
) -> Result<TranscriptDelta, InvalidTranscriptPart> {
    let previous = validate(provided)?;
    let items = full(&transcript)
        .filter(|_| valid_id(id))
        .ok_or(InvalidTranscriptPart)?;
    let agent = transcript["agent"].as_str().ok_or(InvalidTranscriptPart)?;
    let mut hash = Sha256::new();
    hash.update(b"TranscriptPrefixV1\0");
    hash.update(agent.as_bytes());
    hash.update(b"\0");
    hash.update(id.as_bytes());
    hash.update(b"\0");
    let mut digests = Vec::with_capacity(items.len().div_ceil(STEP));
    let mut offset = 0;
    let mut scratch = Vec::with_capacity(64 * 1024);
    for (position, item) in items.iter().enumerate() {
        if !item.is_object() {
            return Err(InvalidTranscriptPart);
        }
        digest_text(&mut hash, item, &mut scratch);
        hash.update(b"\n");
        let count = position + 1;
        let boundary = count % STEP == 0;
        let publish = boundary || count == items.len();
        let compare = count <= previous.count && (boundary || count == previous.count);
        if !publish && !compare {
            continue;
        }
        let digest = format!("{:x}", hash.clone().finalize());
        if compare && previous.digests.get(count.div_ceil(STEP) - 1) == Some(&digest) {
            offset = count;
        }
        if publish {
            digests.push(digest);
        }
    }
    let count = items.len();
    transcript["items"]
        .as_array_mut()
        .ok_or(InvalidTranscriptPart)?
        .drain(..offset);
    Ok(TranscriptDelta {
        schema_version: "TranscriptDeltaV1",
        offset,
        transcript,
        continuation: ContinuationProof { count, digests },
    })
}

/// Merge a validated delta without copying the already-displayed prefix.
pub fn merge(previous: Value, mut wire: Value) -> Result<Value, InvalidTranscriptPart> {
    if full(&wire).is_some() {
        return Ok(wire);
    }
    if wire["schemaVersion"] != "TranscriptDeltaV1" {
        return Err(InvalidTranscriptPart);
    }
    let proof = validate(&wire["continuation"])?;
    let offset = index(&wire["offset"]).ok_or(InvalidTranscriptPart)?;
    let mut transcript = wire["transcript"].take();
    let suffix = full(&transcript).ok_or(InvalidTranscriptPart)?;
    if offset + suffix.len() != proof.count {
        return Err(InvalidTranscriptPart);
    }
    if offset != 0 {
        full(&previous)
            .filter(|items| {
                items.len() >= offset
                    && previous["agent"] == transcript["agent"]
                    && index(&previous["continuation"]["count"]) == Some(items.len())
            })
            .ok_or(InvalidTranscriptPart)?;
        let mut previous = previous;
        let mut items = previous["items"].take();
        let items_array = items.as_array_mut().ok_or(InvalidTranscriptPart)?;
        items_array.truncate(offset);
        items_array.append(
            transcript["items"]
                .as_array_mut()
                .ok_or(InvalidTranscriptPart)?,
        );
        transcript["items"] = items;
    }
    transcript["continuation"] = json!(proof);
    Ok(transcript)
}
