use crate::{
    js_json, normalize,
    sessions::js_trim,
    time::{iso_from_ms, parse_iso},
    transcript_changes::{self, TranscriptChange},
    transcript_marks::{self, one_line, prefix, Citation},
};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::{borrow::Cow, sync::LazyLock};

pub const MAX_IMAGE: usize = 20 * 1024 * 1024;

macro_rules! pattern {
    ($expression:literal) => {{
        static REGEX: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new($expression).ok());
        REGEX.as_ref()
    }};
}

pub struct Text {
    pub kind: &'static str,
    pub value: String,
    pub marks: Map<String, Value>,
    pub merge: bool,
}

pub struct Call {
    pub id: Option<String>,
    pub once: bool,
    pub name: String,
    pub summary: String,
    pub change: Option<TranscriptChange>,
    pub commands: Option<Vec<String>>,
}

pub enum Event {
    Deduplicate(String),
    ClearUsage,
    Text(Text),
    Cite(Vec<Citation>),
    Compact {
        trigger: Option<String>,
        before: Option<i64>,
    },
    Usage {
        total: Option<i64>,
        key: Option<String>,
        signature: Option<String>,
    },
    Image {
        from: &'static str,
        mime: String,
        data: String,
        bytes: usize,
    },
    Call(Call),
    Output {
        id: Option<String>,
        text: Option<String>,
        failed: bool,
        untimed: bool,
    },
}

#[derive(Default)]
pub struct RowEvents {
    pub at: Option<String>,
    pub side: Option<String>,
    pub keep_side: bool,
    pub values: Vec<Event>,
}

pub fn string(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}
pub fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}

pub(super) fn render(value: &Value) -> Cow<'_, str> {
    if value.is_null() {
        Cow::Borrowed("")
    } else if let Some(text) = value.as_str() {
        Cow::Borrowed(text)
    } else {
        Cow::Owned(js_json::stringify(value))
    }
}

pub(super) fn line(text: &str, limit: usize) -> String {
    let line = one_line(text);
    if line.encode_utf16().count() > limit {
        format!("{}…", prefix(&line, limit))
    } else {
        line
    }
}

pub(super) fn time(value: &Value) -> Option<String> {
    let stamp = value.as_str().and_then(parse_iso).or_else(|| {
        value
            .as_f64()
            .filter(|value| value.abs() <= 8_640_000_000_000_000.0)
            .map(|value| value as i64)
    })?;
    Some(iso_from_ms(stamp))
}

fn integer(value: &Value) -> Option<i64> {
    value
        .as_f64()
        .filter(|value| value.abs() <= 9_007_199_254_740_991.0 && value.fract() == 0.0)
        .map(|value| value as i64)
}

fn tool_summary(input: &Value) -> String {
    let parsed = input
        .as_str()
        .and_then(|input| serde_json::from_str::<Value>(input).ok())
        .filter(|parsed| !parsed.is_null());
    let value = parsed.as_ref().unwrap_or(input);
    if value.is_object() || value.is_array() {
        let joined = value["command"]
            .as_array()
            .map(|args| args.iter().map(render).collect::<Vec<_>>().join(" "));
        let command = joined
            .as_deref()
            .or_else(|| value["command"].as_str())
            .or_else(|| {
                value["command"]
                    .is_null()
                    .then(|| value["cmd"].as_str())
                    .flatten()
            });
        if let Some(candidate) = command
            .into_iter()
            .chain(
                [
                    "file_path",
                    "filePath",
                    "path",
                    "absolute_path",
                    "pattern",
                    "query",
                    "url",
                    "description",
                    "prompt",
                ]
                .iter()
                .filter_map(|key| value[*key].as_str()),
            )
            .find(|value| !js_trim(value).is_empty())
        {
            return line(candidate, 240);
        }
    }
    line(&render(value), 240)
}

fn joined<'a>(
    content: &'a Value,
    separator: &str,
    extract: impl Fn(&'a Value) -> Option<&'a str>,
) -> String {
    array(content)
        .iter()
        .filter_map(extract)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(separator)
}

pub(super) fn pieces(content: &Value, claude: bool) -> String {
    content.as_str().map(str::to_owned).unwrap_or_else(|| {
        joined(content, "\n", |part| {
            part.as_str().or_else(|| {
                (!claude || part["type"] == "text")
                    .then(|| part["text"].as_str())
                    .flatten()
            })
        })
    })
}

pub(super) fn mark(label: &str) -> Map<String, Value> {
    Map::from_iter([("label".to_owned(), json!(label))])
}

impl RowEvents {
    pub(super) fn text(&mut self, kind: &'static str, value: impl Into<String>) {
        self.marked(kind, value, Map::new(), false);
    }

    pub(super) fn marked(
        &mut self,
        kind: &'static str,
        value: impl Into<String>,
        marks: Map<String, Value>,
        merge: bool,
    ) {
        self.values.push(Event::Text(Text {
            kind,
            value: value.into(),
            marks,
            merge,
        }));
    }

    pub(super) fn user(&mut self, text: &str) {
        if transcript_marks::slash(text) {
            self.text("command", text);
            return;
        }
        let formatted = transcript_marks::classify(text);
        let kind = match formatted.kind.as_str() {
            "context" => "context",
            "command" => "command",
            _ => "user",
        };
        let mut marks = Map::new();
        if let Some(label) = formatted.label {
            marks.insert("label".to_owned(), json!(label));
        }
        if let Some(attached) = formatted.attached {
            marks.insert("attached".to_owned(), json!(attached));
        }
        if let Some(answered) = formatted.answered {
            marks.insert("answered".to_owned(), json!(answered));
        }
        self.marked(kind, formatted.text, marks, false);
    }

    fn reply(&mut self, text: &str) {
        let formatted = transcript_marks::citations(text);
        self.text("assistant", formatted.text);
        if let Some(cited) = formatted.cited.filter(|cited| !cited.is_empty()) {
            self.values.push(Event::Cite(cited));
        }
    }

    pub(super) fn unknown(&mut self, kind: &Value, value: &Value) {
        let name = if kind.is_null() {
            "未知".into()
        } else {
            render(kind)
        };
        self.marked(
            "context",
            js_json::pretty(value),
            mark(&format!("未识别的记录 · {}", line(&name, 40))),
            true,
        );
    }

    pub(super) fn compact(&mut self, trigger: &Value, before: &Value) {
        self.values.push(Event::Compact {
            trigger: trigger.as_str().map(|text| prefix(text, 40).to_owned()),
            before: integer(before),
        });
    }

    pub(super) fn usage(
        &mut self,
        agent: &str,
        raw: &Value,
        semantics: &str,
        key: Option<&str>,
        signature: Option<String>,
    ) {
        let report = normalize::normalize(
            agent,
            raw,
            &json!({"id": "turn", "session": "turn", "model": "unknown", "time": 1e12}),
            "turn",
            semantics,
        );
        let total = report
            .as_ref()
            .and_then(|report| integer(&report["totalTokens"]));
        if total.is_some() || signature.is_some() {
            self.values.push(Event::Usage {
                total,
                key: key.filter(|key| !key.is_empty()).map(str::to_owned),
                signature,
            });
        }
    }

    pub(super) fn image(&mut self, from: &str, mime: &str, data: &str) {
        if !matches!(
            mime,
            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        ) {
            return;
        }
        let data: String = data
            .chars()
            .filter(|character| !character.is_whitespace() && *character != '\u{feff}')
            .collect();
        let without_padding = data.strip_suffix('=').unwrap_or(&data);
        let without_padding = if data.ends_with('=') {
            without_padding.strip_suffix('=').unwrap_or(without_padding)
        } else {
            without_padding
        };
        let bytes = without_padding.len().saturating_mul(3) / 4;
        if bytes == 0 {
            return;
        }
        let from = if from == "assistant" {
            "assistant"
        } else {
            "user"
        };
        if bytes > MAX_IMAGE {
            self.text(from, "[图片过大，未显示]");
            return;
        }
        self.values.push(Event::Image {
            from,
            mime: mime.to_owned(),
            data,
            bytes,
        });
    }

    pub(super) fn url_image(&mut self, from: &str, url: &Value) -> bool {
        let matched = pattern!(r"^data:(image/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$")
            .and_then(|pattern| pattern.captures(string(url)));
        if let Some(captures) = matched {
            self.image(from, &captures[1], &captures[2]);
            true
        } else {
            false
        }
    }

    pub(super) fn call_once(&mut self, id: &Value, name: &str, input: &Value) {
        self.call(id, name, input);
        if let Some(Event::Call(call)) = self.values.last_mut() {
            call.once = true;
        }
    }

    pub(super) fn call(&mut self, id: &Value, name: &str, input: &Value) {
        let change = transcript_changes::change(name, input);
        self.tool(id, name, input, None, change, None);
    }

    pub(super) fn tool(
        &mut self,
        id: &Value,
        name: &str,
        input: &Value,
        summary: Option<String>,
        change: Option<TranscriptChange>,
        commands: Option<Vec<String>>,
    ) {
        let name = if name.is_empty() { "tool" } else { name };
        let summary = summary.unwrap_or_else(|| {
            change
                .as_ref()
                .map(|change| {
                    line(
                        &change
                            .files
                            .iter()
                            .map(|file| file.path.as_str())
                            .collect::<Vec<_>>()
                            .join("、"),
                        240,
                    )
                })
                .unwrap_or_else(|| tool_summary(input))
        });
        self.values.push(Event::Call(Call {
            once: false,
            id: id.as_str().map(str::to_owned),
            name: line(name, 80),
            summary,
            change,
            commands,
        }));
    }

    pub(super) fn result(&mut self, id: &Value, output: &Value, failed: bool) {
        self.result_at(id, output, failed, false);
    }

    pub(super) fn result_untimed(&mut self, id: &Value, output: &Value, failed: bool) {
        self.result_at(id, output, failed, true);
    }

    fn result_at(&mut self, id: &Value, output: &Value, failed: bool, untimed: bool) {
        self.values.push(Event::Output {
            untimed,
            id: id.as_str().map(str::to_owned),
            text: (!output.is_null()).then(|| render(output).into_owned()),
            failed,
        });
    }

    fn codex_output(&mut self, raw: &Value) -> Value {
        if let Some(list) = raw.as_array().or_else(|| raw["content_items"].as_array()) {
            let mut words = Vec::new();
            for part in list {
                if let Some(text) = part["text"].as_str() {
                    words.push(text.to_owned());
                } else if part["type"] == "input_image" {
                    if !self.url_image("assistant", &part["image_url"]) {
                        words.push("[图片]".to_owned());
                    }
                } else if part["type"] != "encrypted_content" {
                    words.push(js_json::stringify(part));
                }
            }
            json!(words.join("\n"))
        } else {
            raw.to_owned()
        }
    }
}

pub fn codex_message(row: &Value) -> bool {
    (if row["type"] == "response_item" {
        &row["payload"]
    } else {
        row
    })["type"]
        == "message"
}

const CODEX_ITEMS: &[&str] = &[
    "message",
    "agent_message",
    "reasoning",
    "local_shell_call",
    "function_call",
    "custom_tool_call",
    "tool_search_call",
    "function_call_output",
    "custom_tool_call_output",
    "local_shell_call_output",
    "tool_search_output",
    "web_search_call",
    "image_generation_call",
    "compaction",
    "context_compaction",
    "compaction_summary",
];
const CODEX_QUIET: &[&str] = &[
    "ghost_snapshot",
    "additional_tools",
    "configuration_update",
    "compaction_trigger",
    "other",
];

pub fn codex(row: &Value, events: bool) -> RowEvents {
    let mut out = RowEvents {
        at: time(&row["timestamp"]),
        ..RowEvents::default()
    };
    let kind = string(&row["type"]);
    let payload = &row["payload"];
    if kind == "compacted" {
        out.compact(&Value::Null, &Value::Null);
        if let Some(text) = payload["message"].as_str() {
            out.marked("context", text, mark("压缩摘要"), false);
        }
    } else if kind == "event_msg" {
        match string(&payload["type"]) {
            "token_count" if !payload["info"].is_null() => {
                let info = &payload["info"];
                let signature = js_json::stringify(&json!([
                    info["total_token_usage"],
                    info["last_token_usage"]
                ]));
                out.usage(
                    "codex",
                    &info["last_token_usage"],
                    "inclusive",
                    None,
                    Some(signature),
                );
            }
            "context_compacted" => out.compact(&Value::Null, &Value::Null),
            "turn_aborted" => {
                let reason = payload["reason"]
                    .as_str()
                    .map(|reason| format!("：{reason}"))
                    .unwrap_or_default();
                out.marked(
                    "context",
                    format!("这一轮被中断{reason}"),
                    mark("这一轮被中断"),
                    false,
                );
            }
            "entered_review_mode" => {
                out.marked("context", js_json::pretty(payload), mark("进入审查"), false)
            }
            "exited_review_mode" => {
                out.marked("context", js_json::pretty(payload), mark("结束审查"), false)
            }
            "item_completed" if string(&payload["item"]["type"]).eq_ignore_ascii_case("plan") => {
                if let Some(text) = payload["item"]["text"].as_str() {
                    out.marked("context", text, mark("计划"), false);
                }
            }
            "user_message" if events => out.user(string(&payload["message"])),
            "agent_message" if events => out.reply(string(&payload["message"])),
            "agent_reasoning" if events => out.text("thinking", render(&payload["text"])),
            _ => {}
        }
    } else if kind == "response_item" || CODEX_ITEMS.contains(&kind) {
        if kind != "response_item" || payload.is_object() || payload.is_array() {
            codex_item(
                &mut out,
                if kind == "response_item" {
                    payload
                } else {
                    row
                },
            );
        }
    } else if row["type"].is_string() && !matches!(kind, "session_meta" | "turn_context") {
        out.unknown(&row["type"], row);
    }
    out
}

fn codex_item(out: &mut RowEvents, payload: &Value) {
    let kind = string(&payload["type"]);
    let id = &payload["call_id"];
    match kind {
        "message" => {
            let role = string(&payload["role"]);
            let text = joined(&payload["content"], "\n\n", |part| part["text"].as_str());
            match role {
                "user" => out.user(&text),
                "assistant" => out.reply(&text),
                _ => out.text("context", text),
            }
            for part in array(&payload["content"])
                .iter()
                .filter(|part| part["type"] == "input_image")
            {
                if !out.url_image(role, &part["image_url"]) && role == "user" {
                    out.text("user", "[图片]");
                }
            }
        }
        "agent_message" => {
            let author = payload["author"]
                .as_str()
                .map(|author| format!(" · {}", line(author, 40)))
                .unwrap_or_default();
            out.marked(
                "context",
                pieces(&payload["content"], false),
                mark(&format!("子 Agent 消息{author}")),
                false,
            );
        }
        "reasoning" => out.text(
            "thinking",
            array(&payload["summary"])
                .iter()
                .chain(array(&payload["content"]))
                .filter_map(|part| part["text"].as_str())
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n"),
        ),
        "compaction" | "context_compaction" | "compaction_summary" => {
            out.compact(&Value::Null, &Value::Null)
        }
        "tool_search_call" => out.call(id, "tool_search", &payload["arguments"]),
        "tool_search_output" => out.result(
            id,
            &json!(if payload["tools"].is_null() {
                "[]".to_owned()
            } else {
                js_json::pretty(&payload["tools"])
            }),
            payload["status"] == "failed",
        ),
        "image_generation_call" => {
            let input = if let Some(prompt) = payload.get("revised_prompt") {
                json!({"prompt": prompt})
            } else {
                json!({})
            };
            out.call(&payload["id"], "image_generation", &input);
            out.image("assistant", "image/png", string(&payload["result"]));
        }
        "function_call" | "custom_tool_call" => {
            let name = string(&payload["name"]);
            if kind == "custom_tool_call" && name == "exec" {
                let source = string(&payload["input"]);
                if let Some(code) = transcript_marks::code_mode(source) {
                    let change = code
                        .patch
                        .as_deref()
                        .and_then(transcript_changes::from_patch);
                    out.tool(
                        id,
                        &code.name,
                        &Value::Null,
                        Some(code.summary).filter(|text| !text.is_empty()),
                        change,
                        Some(code.commands),
                    );
                } else {
                    let code = source
                        .split_once('\n')
                        .filter(|(first, _)| first.starts_with("// @exec:"))
                        .map_or(source, |(_, tail)| tail);
                    out.tool(
                        id,
                        "exec",
                        &json!(code),
                        None,
                        transcript_changes::from_patch(code),
                        Some(Vec::new()),
                    );
                }
            } else {
                let name = payload["namespace"]
                    .as_str()
                    .filter(|name| !name.is_empty())
                    .map(|namespace| format!("{namespace}__{name}"));
                let input = payload
                    .get("arguments")
                    .filter(|value| !value.is_null())
                    .unwrap_or(&payload["input"]);
                out.call(
                    id,
                    name.as_deref().unwrap_or(string(&payload["name"])),
                    input,
                );
            }
        }
        "local_shell_call" => {
            let input = if let Some(command) = payload["action"].get("command") {
                json!({"command": command})
            } else {
                json!({})
            };
            out.call(id, "shell", &input);
        }
        "web_search_call" => {
            let action = &payload["action"];
            let queries = action["queries"]
                .as_array()
                .map(|queries| queries.iter().map(render).collect::<Vec<_>>().join("、"));
            let query = action["query"]
                .as_str()
                .or(queries.as_deref())
                .or(action["pattern"].as_str())
                .or(action["url"].as_str())
                .unwrap_or_default();
            out.call(&payload["id"], "web_search", &json!({"query": query}));
        }
        "function_call_output" | "custom_tool_call_output" | "local_shell_call_output" => {
            let output = &payload["output"];
            let raw = if output.is_string() {
                output.to_owned()
            } else {
                out.codex_output(
                    output
                        .get("content")
                        .filter(|value| !value.is_null())
                        .unwrap_or(output),
                )
            };
            let parsed = raw
                .as_str()
                .filter(|raw| {
                    raw.trim_start_matches([' ', '\t', '\r', '\n'])
                        .starts_with('{')
                })
                .and_then(|value| serde_json::from_str::<Value>(value).ok());
            let exit = parsed
                .as_ref()
                .and_then(|parsed| integer(&parsed["metadata"]["exit_code"]))
                .or_else(|| integer(&output["metadata"]["exit_code"]));
            let said = pattern!(r"(?m)^Process exited with code ([0-9]+)\r?$")
                .and_then(|pattern| pattern.captures(prefix(string(&raw), 400)))
                .is_some_and(|matched| &matched[1] != "0");
            let failed = exit.is_some_and(|exit| exit != 0) || output["success"] == false || said;
            let reported = parsed
                .as_ref()
                .and_then(|value| value.get("output"))
                .filter(|value| value.is_string())
                .unwrap_or(&raw);
            out.result(id, reported, failed);
        }
        other if CODEX_QUIET.contains(&other) => {}
        _ => out.unknown(&payload["type"], payload),
    }
}

const CLAUDE_QUIET: &[&str] = &[
    "summary",
    "file-history-snapshot",
    "queue-operation",
    "progress",
    "custom-title",
    "ai-title",
    "last-prompt",
    "pr-link",
    "permission-mode",
    "agent-name",
    "agent-color",
    "agent-setting",
    "tag",
    "mode",
    "worktree-state",
    "content-replacement",
    "marble-origami-commit",
    "marble-origami-snapshot",
    "attribution-snapshot",
    "speculation-accept",
    "task-summary",
];
const CLAUDE_NOISE: &[&str] = &[
    "skill_listing",
    "deferred_tools_delta",
    "mcp_instructions_delta",
    "todo_reminder",
    "task_reminder",
    "hook_success",
    "hook_additional_context_empty",
    "token_usage",
    "budget_usd",
    "output_token_usage",
];

fn command(text: &str) -> String {
    pattern!(r"</?[a-z-]+>").map_or_else(
        || one_line(text),
        |pattern| one_line(&pattern.replace_all(text, " ")),
    )
}

pub fn claude(row: &Value, side: Option<&str>, embedded: bool) -> RowEvents {
    if row["type"] == "progress"
        && embedded
        && row["data"]["type"] == "agent_progress"
        && row["data"]["message"]["message"].is_object()
    {
        let mut out = claude(
            &row["data"]["message"],
            side.or(row["data"]["agentId"].as_str().filter(|id| !id.is_empty()))
                .or(Some("agent")),
            false,
        );
        if row["data"]["message"]["timestamp"].is_null() {
            out.at = time(&row["timestamp"]);
        }
        return out;
    }
    let internal = row["isSidechain"] == true;
    let origin = side.or_else(|| {
        internal.then(|| {
            row["agentId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .unwrap_or("agent")
        })
    });
    let mut out = RowEvents {
        at: time(&row["timestamp"]),
        side: origin.map(str::to_owned),
        ..RowEvents::default()
    };
    match string(&row["type"]) {
        "system" => {
            let kind = string(&row["subtype"]);
            match kind {
                "compact_boundary" => {
                    out.side = side.map(str::to_owned);
                    out.compact(
                        &row["compactMetadata"]["trigger"],
                        &row["compactMetadata"]["preTokens"],
                    );
                }
                "microcompact_boundary" => {}
                other => {
                    let text = row["content"].as_str().map(str::to_owned).or_else(|| {
                        (!row["error"].is_null()).then(|| js_json::pretty(&row["error"]))
                    });
                    if let Some(text) = text {
                        if other == "local_command" {
                            out.text("command", command(&text));
                        } else {
                            let label = match other {
                                "api_error" => "接口错误",
                                "informational" => "提示",
                                "stop_hook_summary" => "Hook",
                                "away_summary" => "离开时的摘要",
                                "scheduled_task_fire" => "定时任务",
                                _ => "系统消息",
                            };
                            out.marked("context", text, mark(label), false);
                        }
                    }
                }
            }
        }
        "attachment" => {
            let note = &row["attachment"];
            if note["type"] == "queued_command" {
                let value = note
                    .get("prompt")
                    .filter(|value| !value.is_null())
                    .unwrap_or(&note["content"]);
                out.user(&pieces(value, true));
            } else if !note.is_null() && !CLAUDE_NOISE.contains(&string(&note["type"])) {
                let body = note["content"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| js_json::pretty(note));
                out.marked("context", body, mark("附加内容"), true);
            }
        }
        "user" if !row["message"].is_null() => claude_message(&mut out, row, "user"),
        "assistant" if !row["message"].is_null() => claude_message(&mut out, row, "assistant"),
        other
            if row["type"].is_string()
                && !CLAUDE_QUIET.contains(&other)
                && !matches!(other, "user" | "assistant") =>
        {
            out.keep_side = true;
            out.unknown(&row["type"], row);
        }
        _ => out.keep_side = true,
    }
    out
}

fn claude_message(out: &mut RowEvents, row: &Value, speaker: &'static str) {
    let message = &row["message"];
    let content = &message["content"];
    if row["isCompactSummary"] == true {
        out.marked("context", pieces(content, true), mark("压缩摘要"), false);
        return;
    }
    if row["isMeta"] == true {
        out.text("context", pieces(content, true));
        return;
    }
    if let Some(text) = content.as_str() {
        if speaker == "assistant" {
            out.text("assistant", text);
        } else if ["<command-name", "<command-message", "<local-command-stdout"]
            .iter()
            .any(|tag| js_trim(text).starts_with(tag))
        {
            out.text("command", command(text));
        } else {
            out.user(text);
        }
    } else {
        for part in array(content).iter().filter(|part| part.is_object()) {
            let source = &part["source"];
            match string(&part["type"]) {
                "text" if speaker == "user" => out.user(string(&part["text"])),
                "text" => out.text("assistant", render(&part["text"])),
                "thinking" => out.text("thinking", render(&part["thinking"])),
                "tool_use" | "server_tool_use" | "mcp_tool_use" => {
                    out.call(&part["id"], string(&part["name"]), &part["input"])
                }
                kind if kind == "tool_result" || kind.ends_with("_tool_result") => {
                    let result = &part["content"];
                    let mut text = pieces(result, true);
                    if text.is_empty()
                        && (array(result).iter().any(|piece| piece["type"] != "image")
                            || (!result.is_array() && !result.is_null()))
                    {
                        text = js_json::pretty(result);
                    }
                    out.result(&part["tool_use_id"], &json!(text), part["is_error"] == true);
                    for piece in array(result).iter().filter(|piece| {
                        piece["type"] == "image" && piece["source"]["type"] == "base64"
                    }) {
                        out.image(
                            "assistant",
                            string(&piece["source"]["media_type"]),
                            string(&piece["source"]["data"]),
                        );
                    }
                }
                "image" if source["type"] == "base64" => out.image(
                    speaker,
                    string(&source["media_type"]),
                    string(&source["data"]),
                ),
                "image" => out.text(speaker, "[图片]"),
                "document" => out.text(
                    speaker,
                    format!(
                        "[文档] {}",
                        line(
                            part["title"]
                                .as_str()
                                .filter(|text| !text.is_empty())
                                .unwrap_or(string(&source["media_type"])),
                            120
                        )
                    ),
                ),
                "redacted_thinking" | "tool_reference" => {}
                _ => out.unknown(&part["type"], part),
            }
        }
    }
    if speaker == "assistant" && !message["usage"].is_null() {
        let key = message["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .or(row["uuid"].as_str());
        out.usage("claude", &message["usage"], "exclusive", key, None);
    }
}
