use crate::{
    collate,
    session_list::valid_key,
    store::Store,
    transcript::{self, FindRequest, MarkdownRequest, PartRequest, ReaderError, TranscriptControl},
    transcript_sources::{valid_id, Format},
    transcript_tasks::TranscriptTasks,
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

fn default_all() -> String {
    "all".to_owned()
}

fn reference<'a>(value: &'a Value, stamp: &str) -> Option<(&'a str, &'a str)> {
    value
        .get("agent")
        .and_then(Value::as_str)
        .filter(|agent| !agent.is_empty())
        .zip(
            value
                .get(stamp)
                .and_then(Value::as_str)
                .filter(|end| !end.is_empty()),
        )
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default = "default_all")]
    pub range: String,
    #[serde(default = "default_all")]
    pub agent: String,
    #[serde(default)]
    pub offset: usize,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileHistoryRequest {
    pub key: String,
    pub path: String,
    #[serde(default)]
    pub offset: usize,
}

enum ScanKind {
    Search(String),
    FileHistory(transcript::sweep::FileTarget),
    AgentUse,
}

struct Candidate {
    entry: transcript::sweep::Entry,
    end: String,
}

/// A detached scan over requested, saved session identities and approved roots only.
pub struct TranscriptScan {
    kind: ScanKind,
    entries: Vec<Candidate>,
    roots: Value,
    offset: usize,
}

pub enum TranscriptRequest {
    Preview { proof: Option<Value> },
    Stamp,
    Part(PartRequest),
    Find(FindRequest),
    Facts,
    Markdown(MarkdownRequest),
}

/// An authorized lookup detached from the store so the host releases it before awaiting the reader.
pub struct TranscriptTarget {
    agent: &'static str,
    id: String,
    roots: Vec<String>,
}

impl Store {
    pub fn transcript_target(&self, key: &str) -> Result<TranscriptTarget, ReaderError> {
        if !valid_key(key) {
            return Err(ReaderError::NotFound);
        }
        let identity = &self.state["sessions"][key];
        let id = identity["id"]
            .as_str()
            .filter(|id| valid_id(id))
            .ok_or(ReaderError::NotFound)?;
        let format = Format::parse(identity["agent"].as_str().ok_or(ReaderError::NotFound)?)?;
        let agent = format.name();
        let roots = self.source_roots();
        let roots = roots[agent]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        Ok(TranscriptTarget {
            agent,
            id: id.to_owned(),
            roots,
        })
    }

    pub fn transcript_search(&self, request: SearchRequest) -> Result<TranscriptScan, ReaderError> {
        if !matches!(request.range.as_str(), "today" | "7" | "30" | "all")
            || !transcript::sweep::allowed_text(crate::sessions::js_trim(&request.query), 120)
        {
            return Err(ReaderError::InvalidSearch);
        }
        Ok(self.transcript_scan(
            ScanKind::Search(request.query),
            &request.agent,
            None,
            request.offset,
        ))
    }

    pub fn transcript_file_history(
        &self,
        request: FileHistoryRequest,
    ) -> Result<TranscriptScan, ReaderError> {
        let session = &self.state["sessions"][&request.key];
        if !valid_key(&request.key) || !session["id"].as_str().is_some_and(|id| !id.is_empty()) {
            return Err(ReaderError::NotFound);
        }
        if !transcript::sweep::allowed_text(&request.path, 1000) {
            return Err(ReaderError::InvalidSearch);
        }
        let cwd = session["cwd"]
            .as_str()
            .filter(|cwd| !cwd.is_empty())
            .map(str::to_owned);
        let target = transcript::sweep::FileTarget {
            path: request.path,
            cwd,
        };
        Ok(self.transcript_scan(
            ScanKind::FileHistory(target),
            "all",
            Some(&request.key),
            request.offset,
        ))
    }

    pub fn transcript_agent_use(&self, offset: usize) -> TranscriptScan {
        self.transcript_scan(ScanKind::AgentUse, "all", None, offset)
    }

    fn transcript_scan(
        &self,
        kind: ScanKind,
        wanted_agent: &str,
        excluded: Option<&str>,
        offset: usize,
    ) -> TranscriptScan {
        let mut references = IndexMap::<&str, (&str, &str)>::new();
        for record in self.record_refs() {
            let Some(key) = record["sessionKey"].as_str().filter(|key| valid_key(key)) else {
                continue;
            };
            if let Some((agent, end)) = reference(record, "timestamp") {
                let current = references.entry(key).or_insert((agent, end));
                current.1 = current.1.max(end);
            }
        }
        let saved = &self.state["sessions"];
        for (key, value) in saved.as_object().into_iter().flatten() {
            if valid_key(key) {
                if let Some(reference) = reference(value, "at") {
                    references.entry(key).or_insert(reference);
                }
            }
        }
        let mut entries: Vec<_> = references
            .into_iter()
            .filter_map(|(key, (agent, end))| {
                if excluded == Some(key)
                    || (wanted_agent != "all" && wanted_agent != agent)
                    || Format::parse(agent).is_err()
                {
                    return None;
                }
                let meta = &saved[key];
                let id = meta["id"].as_str().filter(|id| !id.is_empty())?;
                let cwd = meta["cwd"]
                    .as_str()
                    .filter(|cwd| !cwd.is_empty())
                    .map(str::to_owned);
                Some(Candidate {
                    entry: transcript::sweep::Entry {
                        key: key.to_owned(),
                        agent: agent.to_owned(),
                        id: id.to_owned(),
                        cwd,
                    },
                    end: end.to_owned(),
                })
            })
            .collect();
        entries.sort_by(|left, right| collate::compare(&right.end, &left.end));
        TranscriptScan {
            kind,
            entries,
            roots: self.source_roots(),
            offset,
        }
    }
}

impl TranscriptScan {
    pub async fn read(self, tasks: &TranscriptTasks) -> Result<Value, ReaderError> {
        tasks
            .run(move |budget| self.read_now(&TranscriptControl::with_budget(budget)))
            .await
    }

    fn read_now(self, control: &TranscriptControl<'_>) -> Result<Value, ReaderError> {
        use transcript::sweep::{self, DEFAULT_BUDGET};
        let total = self.entries.len();
        let mut ends = IndexMap::new();
        let entries: Vec<_> = self
            .entries
            .into_iter()
            .skip(self.offset)
            .map(|candidate| {
                if matches!(self.kind, ScanKind::AgentUse) {
                    ends.insert(candidate.entry.key.to_owned(), candidate.end);
                }
                candidate.entry
            })
            .collect();
        let stamped = |schema, field: &str, data, scanned| {
            let searched = self.offset + scanned;
            json!({
                "schemaVersion": schema, (field): data, "searched": searched,
                "total": total, "next": (searched < total).then_some(searched)
            })
        };
        match &self.kind {
            ScanKind::Search(query) => {
                let batch = sweep::search(&entries, &self.roots, query, DEFAULT_BUDGET, control)?;
                Ok(stamped(
                    "TranscriptSearchV1",
                    "results",
                    json!(batch.results),
                    batch.scanned,
                ))
            }
            ScanKind::FileHistory(target) => {
                let batch =
                    sweep::file_history(&entries, &self.roots, target, DEFAULT_BUDGET, control)?;
                Ok(stamped(
                    "TranscriptFileHistoryV1",
                    "results",
                    json!(batch.results),
                    batch.scanned,
                ))
            }
            ScanKind::AgentUse => {
                let batch = sweep::tool_use(&entries, &self.roots, DEFAULT_BUDGET, control)?;
                let mut groups =
                    IndexMap::<(&str, &str, String), (usize, usize, Option<&str>)>::new();
                let agents: IndexMap<_, _> = entries
                    .iter()
                    .map(|entry| (entry.key.as_str(), entry.agent.as_str()))
                    .collect();
                for hit in batch.results {
                    let Some(&agent) = agents.get(hit.key.as_str()) else {
                        continue;
                    };
                    let end = ends.get(&hit.key).map(String::as_str);
                    for (kind, tools) in [("mcp", hit.mcp), ("skill", hit.skill)] {
                        for (tool, count) in tools {
                            let group = groups.entry((agent, kind, tool)).or_insert((0, 0, None));
                            group.0 += count.as_u64().unwrap_or_default() as usize;
                            group.1 += 1;
                            group.2 = group.2.max(end);
                        }
                    }
                }
                let rows: Vec<_> = groups.into_iter().map(|((agent, kind, name), (calls, sessions, last))| {
                    json!({"agent": agent, "kind": kind, "name": name, "calls": calls, "sessions": sessions, "last": last})
                }).collect();
                Ok(stamped(
                    "AgentUseV1",
                    "rows",
                    Value::Array(rows),
                    batch.scanned,
                ))
            }
        }
    }
}

impl TranscriptTarget {
    /// Execute the request under the existing blocking lane; no transcript is retained by the store.
    pub async fn read(
        self,
        tasks: &TranscriptTasks,
        request: TranscriptRequest,
    ) -> Result<Value, ReaderError> {
        tasks
            .run(move |budget| self.read_now(request, &TranscriptControl::with_budget(budget)))
            .await
    }

    fn read_now(
        &self,
        request: TranscriptRequest,
        control: &TranscriptControl<'_>,
    ) -> Result<Value, ReaderError> {
        let (agent, id, roots) = (self.agent, self.id.as_str(), self.roots.as_slice());
        match request {
            TranscriptRequest::Preview { proof } => {
                transcript::preview(agent, id, roots, proof.as_ref(), control)
            }
            TranscriptRequest::Stamp => {
                transcript::stamp(agent, id, roots, control).map(|stamp| json!({"stamp": stamp}))
            }
            TranscriptRequest::Part(request) => {
                transcript::part(agent, id, roots, &request, control)
            }
            TranscriptRequest::Find(request) => {
                let found = transcript::find(agent, id, roots, &request, control)?;
                serde_json::to_value(found).map_err(|_| ReaderError::Unreadable)
            }
            TranscriptRequest::Facts => transcript::facts(agent, id, roots, control),
            TranscriptRequest::Markdown(request) => {
                transcript::markdown(agent, id, roots, &request, control).map(Value::String)
            }
        }
    }
}
