use crate::{
    js_json,
    normalize::truthy,
    sessions::js_trim,
    transcript::{ReaderError, TranscriptControl},
    transcript_changes,
    transcript_events::{array, line, mark, pieces, render, string, time, RowEvents},
    transcript_lines::{JsonlReader, SourceEpoch},
    transcript_sources::{Format, MAX_FILE},
};
use regex::Regex;
use serde_json::{json, Value};
use std::{path::Path, sync::LazyLock};

pub fn read(
    path: &Path,
    format: Format,
    epoch: SourceEpoch,
    control: &TranscriptControl<'_>,
) -> Result<Vec<Value>, ReaderError> {
    control.check()?;
    if epoch.length > MAX_FILE {
        return Err(ReaderError::TooLarge);
    }
    let mut file = JsonlReader::open(path, MAX_FILE)?;
    if file.epoch() != epoch {
        return Err(ReaderError::Changed);
    }
    let mut document = file.read_document()?.unwrap_or_default();
    let rows = match format {
        Format::Cline | Format::Kilo if document.is_array() => document,
        Format::Cline | Format::Kilo | Format::Gemini => document
            .get_mut("messages")
            .map(Value::take)
            .unwrap_or_default(),
        Format::Continue => document
            .get_mut("history")
            .map(Value::take)
            .unwrap_or_default(),
        _ => return Err(ReaderError::Unsupported),
    };
    control.check()?;
    Ok(if let Value::Array(rows) = rows {
        rows
    } else {
        Vec::new()
    })
}

fn first<'a>(values: impl IntoIterator<Item = &'a Value>) -> &'a Value {
    values
        .into_iter()
        .find(|value| !value.is_null())
        .unwrap_or(&Value::Null)
}

fn truthy_text(value: &Value) -> Option<&str> {
    value.as_str().filter(|text| !text.is_empty())
}

fn formatted(value: &Value) -> String {
    if value.is_null() {
        String::new()
    } else {
        js_json::pretty(value)
    }
}

pub fn open_message(message: &Value, agent: &str, side: Option<&str>) -> RowEvents {
    let mut out = RowEvents {
        at: time(&message["time"]),
        side: side.map(str::to_owned),
        ..RowEvents::default()
    };
    let role = string(&message["role"]);
    let parts = array(&message["parts"]);
    if role == "system" {
        let text = parts
            .iter()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| truthy_text(&part["text"]))
            .collect::<Vec<_>>()
            .join("\n");
        out.text("context", text);
        return out;
    }
    for part in parts
        .iter()
        .filter(|part| part.is_object() || part.is_array())
    {
        match string(&part["type"]) {
            "text" => {
                let text = string(&part["text"]);
                if part["synthetic"] == true || part["ignored"] == true {
                    out.marked("context", text, mark("注入的上下文"), true);
                } else if role == "assistant" {
                    out.text("assistant", text);
                } else if role == "user" {
                    out.user(text);
                } else {
                    out.text("context", text);
                }
            }
            "reasoning" => out.text("thinking", render(&part["text"])),
            "compaction" => {
                let trigger = part["auto"]
                    .as_bool()
                    .map(|auto| if auto { "auto" } else { "manual" });
                out.compact(&json!(trigger), &Value::Null);
            }
            "tool" => {
                let state = &part["state"];
                let input = first([&state["input"], &part["input"]]);
                let empty = input.is_null()
                    || input.as_object().is_some_and(|map| map.is_empty())
                    || input.as_array().is_some_and(|items| items.is_empty())
                    || input.as_str() == Some("");
                let summary = state["title"]
                    .as_str()
                    .filter(|title| empty && !js_trim(title).is_empty())
                    .map(|title| line(title, 240));
                let id = first([&part["callID"], &part["id"]]);
                let name = string(first([&part["tool"], &part["name"]]));
                let id = if id.is_null() {
                    json!(format!("\0{}", out.values.len()))
                } else {
                    id.to_owned()
                };
                let default;
                let input = if input.is_null() {
                    default = json!({});
                    &default
                } else {
                    input
                };
                out.tool(
                    &id,
                    name,
                    input,
                    summary,
                    transcript_changes::change(name, input),
                    None,
                );
                let error = state["status"] == "error";
                if state["status"] == "completed" || error {
                    let output = if error && truthy_text(&state["error"]).is_some() {
                        &state["error"]
                    } else {
                        &state["output"]
                    };
                    out.result(&id, output, error);
                }
            }
            "file" => {
                if !out.url_image(role, &part["url"]) {
                    let label = truthy_text(&part["filename"])
                        .or(part["mime"].as_str())
                        .unwrap_or_default();
                    out.text(
                        if role == "assistant" {
                            "assistant"
                        } else {
                            "user"
                        },
                        format!("[文件] {}", line(label, 120)),
                    );
                }
            }
            "subtask" => {
                let text = [&part["description"], &part["prompt"]]
                    .into_iter()
                    .filter_map(truthy_text)
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let label = part["agent"].as_str().map_or_else(
                    || "子任务".to_owned(),
                    |agent| format!("子任务 · {}", line(agent, 40)),
                );
                out.marked("context", text, mark(&label), false);
            }
            "retry" => out.marked(
                "context",
                formatted(first([&part["error"], part])),
                mark("重试"),
                true,
            ),
            "step-start" | "step-finish" | "snapshot" | "patch" | "agent" => {}
            _ => out.unknown(&part["type"], part),
        }
    }
    if role == "assistant" {
        out.usage(agent, &message["tokens"], "exclusive", None, None);
    }
    if truthy(&message["error"]) {
        let error = &message["error"];
        let text = error["data"]["message"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| formatted(error));
        out.marked("context", text, mark("这次回复出错"), false);
    }
    out
}

pub fn deepseek(row: &Value) -> RowEvents {
    use crate::transcript_events::Event;
    let mut out = RowEvents {
        at: time(&row["time"]),
        ..RowEvents::default()
    };
    let kind = string(&row["type"]);
    let data = &row["data"];
    if kind == "session/end-seed" && data["inherited"] == true {
        out.values.push(Event::ClearUsage);
        return out;
    }
    let raw = match kind {
        "user/message" => data,
        "assistant/message" | "tool/result" => &data["message"],
        _ => &Value::Null,
    };
    if row["surfaceOp"]["op"] != "replace" && (raw.is_object() || raw.is_array()) {
        if let Some(id) = raw["id"].as_str() {
            out.values.push(Event::Deduplicate(id.to_owned()));
        }
        if kind == "tool/result" {
            out.result(
                &raw["toolCallId"],
                &json!(pieces(&raw["content"], false)),
                raw["isError"] == true,
            );
        } else {
            let user = kind == "user/message";
            let injected = user
                && raw["source"]["kind"]
                    .as_str()
                    .is_some_and(|kind| kind != "user");
            let spoken = |out: &mut RowEvents, value: &Value| {
                if !user {
                    out.text("assistant", render(value));
                } else if injected {
                    out.text("context", render(value));
                } else {
                    out.user(string(value));
                }
            };
            let content = &raw["content"];
            if content.is_string() {
                spoken(&mut out, content);
            }
            for part in array(content) {
                match string(&part["type"]) {
                    "text" => spoken(&mut out, &part["text"]),
                    "thinking" | "reasoning" => out.text(
                        "thinking",
                        render(first([&part["text"], &part["thinking"]])),
                    ),
                    "tool-call" => out.call(
                        &part["id"],
                        string(&part["name"]),
                        first([&part["arguments"], &json!({})]),
                    ),
                    _ if part.is_object() || part.is_array() => out.unknown(&part["type"], part),
                    _ => {}
                }
            }
        }
    }
    if matches!(kind, "assistant/message" | "assistant/attempt") {
        let chunk = array(&data["stream"])
            .iter()
            .find(|part| part["type"] == "chunk" && part["chunk"]["type"] == "usage")
            .map_or(&Value::Null, |part| &part["chunk"]["usage"]);
        let usage = first([&data["usage"], chunk]);
        if truthy(usage) {
            out.usage("deepseek", usage, "exclusive", None, None);
        }
    }
    out
}

fn cline_user(out: &mut RowEvents, text: &str) {
    static ENV: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"(?s)<environment_details>.*?</environment_details>").ok());
    static ECHO: LazyLock<Option<Regex>> =
        LazyLock::new(|| Regex::new(r"^\[[^\]\n]{1,120}\] Result:").ok());
    let remaining = ENV
        .as_ref()
        .map_or(std::borrow::Cow::Borrowed(text), |env| {
            env.replace_all(text, |capture: &regex::Captures<'_>| {
                out.text("context", &capture[0]);
                ""
            })
        });
    let inner = js_trim(&remaining);
    if !inner.is_empty() {
        if ECHO.as_ref().is_some_and(|echo| echo.is_match(inner)) {
            out.text("context", inner);
        } else {
            let words = ["task", "feedback", "answer", "user_message"]
                .iter()
                .find_map(|tag| {
                    inner
                        .strip_prefix(&format!("<{tag}>"))?
                        .strip_suffix(&format!("</{tag}>"))
                        .map(js_trim)
                })
                .unwrap_or(inner);
            out.user(words);
        }
    }
}

pub fn cline(message: &Value, agent: &str) -> RowEvents {
    let mut out = RowEvents {
        at: time(&message["ts"]),
        ..RowEvents::default()
    };
    let role = match string(&message["role"]) {
        "user" => "user",
        "assistant" => "assistant",
        _ => return out,
    };
    let content = &message["content"];
    if let Some(text) = content.as_str() {
        if role == "user" {
            cline_user(&mut out, text);
        } else {
            out.text("assistant", text);
        }
    }
    for part in array(content) {
        let source = &part["source"];
        match string(&part["type"]) {
            "text" if role == "user" => cline_user(&mut out, string(&part["text"])),
            "text" => out.text("assistant", render(&part["text"])),
            "thinking" => out.text(
                "thinking",
                render(first([&part["thinking"], &part["text"]])),
            ),
            "tool_use" => out.call(&part["id"], string(&part["name"]), &part["input"]),
            "tool_result" => out.result(
                &part["tool_use_id"],
                &json!(pieces(&part["content"], false)),
                part["is_error"] == true,
            ),
            "image" if source["type"] == "base64" => {
                out.image(role, string(&source["media_type"]), string(&source["data"]))
            }
            _ if part.is_object() || part.is_array() => out.unknown(&part["type"], part),
            _ => {}
        }
    }
    let metrics = &message["metrics"];
    if role == "assistant" && truthy(metrics) {
        out.usage(agent, &json!({"input_tokens": metrics["inputTokens"], "output_tokens": metrics["outputTokens"], "cached_input_tokens": metrics["cacheReadTokens"]}), "inclusive", None, None);
    }
    out
}

pub fn continue_message(entry: &Value) -> RowEvents {
    let mut out = RowEvents::default();
    let message = &entry["message"];
    if message.is_null() {
        return out;
    }
    let content = &message["content"];
    match string(&message["role"]) {
        "user" => {
            if let Some(text) = content.as_str() {
                out.user(text);
            }
            for part in array(content) {
                match string(&part["type"]) {
                    "text" => out.user(string(&part["text"])),
                    "imageUrl" => {
                        out.url_image("user", &part["imageUrl"]["url"]);
                    }
                    _ => {}
                }
            }
        }
        "assistant" => {
            if let Some(text) = entry["reasoning"]["text"].as_str() {
                out.text("thinking", text);
            }
            out.text("assistant", pieces(content, false));
            for call in array(&message["toolCalls"]) {
                out.call(
                    &call["id"],
                    string(&call["function"]["name"]),
                    &call["function"]["arguments"],
                );
            }
        }
        "thinking" => out.text("thinking", pieces(content, false)),
        "tool" => out.result(
            &message["toolCallId"],
            &json!(pieces(content, false)),
            false,
        ),
        "system" => out.text("context", pieces(content, false)),
        _ => {}
    }
    for state in array(&entry["toolCallStates"]) {
        if truthy(&state["output"]) {
            let text = array(&state["output"])
                .iter()
                .map(|item| render(&item["content"]))
                .collect::<Vec<_>>()
                .join("\n");
            out.result(
                &state["toolCallId"],
                &json!(text),
                state["status"] == "errored",
            );
        }
    }
    out
}

fn gemini_output(call: &Value) -> String {
    let display = &call["resultDisplay"];
    if let Some(display) = truthy_text(display) {
        return display.to_owned();
    }
    if display.is_object() || display.is_array() {
        return display["fileDiff"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| js_json::stringify(display));
    }
    let result = &call["result"];
    for part in array(result) {
        let response = &part["functionResponse"]["response"];
        if let Some(text) = response["output"].as_str().or(response["error"].as_str()) {
            return text.to_owned();
        }
    }
    if truthy(result) {
        render(result).into_owned()
    } else {
        String::new()
    }
}

pub fn gemini(message: &Value) -> RowEvents {
    let mut out = RowEvents {
        at: time(&message["timestamp"]),
        ..RowEvents::default()
    };
    let content = &message["content"];
    let role = string(&message["type"]);
    for part in array(content) {
        let image = &part["inlineData"];
        if truthy(image) {
            out.image(
                if role == "gemini" {
                    "assistant"
                } else {
                    "user"
                },
                string(&image["mimeType"]),
                string(&image["data"]),
            );
        }
    }
    let text = pieces(content, false);
    match role {
        "user" => out.user(&text),
        "gemini" => {
            let thoughts = array(&message["thoughts"])
                .iter()
                .map(|item| {
                    let subject = truthy_text(&item["subject"]).map(|text| format!("**{text}**"));
                    let description = truthy_text(&item["description"]);
                    subject
                        .as_deref()
                        .into_iter()
                        .chain(description)
                        .collect::<Vec<_>>()
                        .join("\n\n")
                })
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n");
            out.text("thinking", thoughts);
            out.text("assistant", text);
            for (index, call) in array(&message["toolCalls"]).iter().enumerate() {
                let Some(name) = call["name"].as_str() else {
                    continue;
                };
                let id = json!(call["id"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| format!("{name}-{index}")));
                let default = json!({});
                out.call(&id, name, first([&call["args"], &default]));
                let status = string(&call["status"]);
                if !status.is_empty()
                    && !matches!(
                        status,
                        "executing" | "scheduled" | "validating" | "awaiting_approval"
                    )
                {
                    out.result(
                        &id,
                        &json!(gemini_output(call)),
                        matches!(status, "error" | "cancelled" | "canceled"),
                    );
                }
            }
            let tokens = &message["tokens"];
            if truthy(tokens) {
                out.usage("gemini", &json!({"input": tokens["input"], "output": tokens["output"], "cached_input_tokens": tokens["cached"], "reasoning": tokens["thoughts"], "total": tokens["total"]}), "inclusive", None, None);
            }
        }
        "warning" => out.marked("context", text, mark("警告"), false),
        "error" => out.marked("context", text, mark("错误"), false),
        _ => out.text("context", text),
    }
    out
}

pub fn pi(row: &Value) -> RowEvents {
    let message = &row["message"];
    let mut out = RowEvents {
        at: time(first([&message["timestamp"], &row["timestamp"]])),
        ..RowEvents::default()
    };
    match string(&row["type"]) {
        "compaction" => {
            out.compact(&Value::Null, &row["tokensBefore"]);
            out.text("context", render(&row["summary"]));
        }
        "branch_summary" => out.text("context", render(&row["summary"])),
        "custom_message" if row["display"] != false => {
            out.text("context", pieces(&row["content"], false))
        }
        "message" if !message.is_null() => {
            let role = string(&message["role"]);
            let body = &message["content"];
            if matches!(role, "user" | "assistant") {
                if let Some(text) = body.as_str() {
                    if role == "user" {
                        out.user(text);
                    } else {
                        out.text("assistant", text);
                    }
                }
                for part in array(body) {
                    match (role, string(&part["type"])) {
                        ("user", "text") => out.user(string(&part["text"])),
                        ("user", "image") => {
                            out.image("user", string(&part["mimeType"]), string(&part["data"]))
                        }
                        ("assistant", "text") => out.text("assistant", render(&part["text"])),
                        ("assistant", "thinking") if !truthy(&part["redacted"]) => {
                            out.text("thinking", render(&part["thinking"]))
                        }
                        ("assistant", "toolCall") => {
                            out.call(&part["id"], string(&part["name"]), &part["arguments"])
                        }
                        _ => {}
                    }
                }
                if role == "assistant" {
                    if truthy(&message["errorMessage"]) {
                        out.text("context", render(&message["errorMessage"]));
                    }
                    let used = &message["usage"];
                    if truthy(used) {
                        out.usage("pi", &json!({"input_tokens":used["input"],"output_tokens":used["output"],
                            "cache_read_input_tokens":used["cacheRead"],"cache_creation_input_tokens":used["cacheWrite"],"total_tokens":used["totalTokens"]}), "exclusive", None, None);
                    }
                }
            } else {
                match role {
                    "toolResult" => {
                        out.at = None;
                        out.result(
                            &message["toolCallId"],
                            &json!(pieces(body, false)),
                            message["isError"] == true,
                        );
                    }
                    "bashExecution" => {
                        let args = if message.get("command").is_some() {
                            json!({"command":message["command"]})
                        } else {
                            json!({})
                        };
                        let id = if row["id"].is_string() {
                            row["id"].to_owned()
                        } else {
                            json!("\0pi-bash")
                        };
                        out.call(&id, "bash", &args);
                        let failed = message["exitCode"]
                            .as_f64()
                            .is_some_and(|code| code != 0.0 && code.fract() == 0.0);
                        out.result(&id, &message["output"], failed);
                    }
                    _ => {
                        let text = pieces(body, false);
                        if text.is_empty() {
                            out.text("context", render(&message["summary"]));
                        } else {
                            out.text("context", text);
                        }
                    }
                }
            }
        }
        _ => {}
    }
    out
}

pub fn qwen(row: &Value) -> RowEvents {
    let kind = string(&row["type"]);
    let mut out = RowEvents {
        at: time(&row["timestamp"]),
        side: truthy(&row["isSidechain"]).then(|| {
            let id = &row["agentId"];
            if id.is_null() {
                "agent".to_owned()
            } else {
                crate::transcript_marks::prefix(&render(id), 40).to_owned()
            }
        }),
        ..RowEvents::default()
    };
    if kind == "system" {
        if row["subtype"] == "chat_compression" {
            out.compact(&Value::Null, &Value::Null);
        }
        return out;
    }
    for part in array(&row["message"]["parts"]) {
        if let Some(text) = part["text"].as_str() {
            if part["thought"] == true {
                out.text("thinking", text);
            } else if kind == "user" {
                out.user(text);
            } else {
                out.text("assistant", text);
            }
        } else if truthy(&part["functionCall"]) {
            let call = &part["functionCall"];
            out.call(
                first([&call["id"], &call["name"]]),
                string(&call["name"]),
                &call["args"],
            );
        } else if truthy(&part["functionResponse"]) {
            let call = &part["functionResponse"];
            let answer = &call["response"];
            out.result_untimed(
                first([&call["id"], &call["name"]]),
                first([&answer["error"], &answer["output"], answer]),
                truthy(&answer["error"]) || row["toolCallResult"]["status"] == "error",
            );
        } else if truthy(&part["inlineData"]) {
            let data = &part["inlineData"];
            out.image(
                if kind == "user" { "user" } else { "assistant" },
                string(&data["mimeType"]),
                string(&data["data"]),
            );
        }
    }
    let used = &row["usageMetadata"];
    if truthy(used) {
        out.usage("qwen", &json!({"input_tokens":used["promptTokenCount"],"output_tokens":used["candidatesTokenCount"],
            "cached_input_tokens":used["cachedContentTokenCount"],"total_tokens":used["totalTokenCount"]}), "inclusive", row["uuid"].as_str(), None);
    }
    out
}
