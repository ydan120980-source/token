use super::transcript_events::{array, mark, pieces, render, string, time, RowEvents};
use crate::{js_json, sessions::js_trim, transcript_marks::prefix};
use serde_json::{json, Value};

fn coalesce<'a>(values: impl IntoIterator<Item = &'a Value>) -> &'a Value {
    values
        .into_iter()
        .find(|value| !value.is_null())
        .unwrap_or(&Value::Null)
}

pub(super) fn copilot(row: &Value) -> RowEvents {
    let data = &row["data"];
    let mut out = RowEvents {
        at: time(&row["timestamp"]),
        ..RowEvents::default()
    };
    if !data.is_object() && !data.is_array() {
        return out;
    }
    out.side = data["parentToolCallId"]
        .as_str()
        .map(|side| prefix(side, 12).to_owned())
        .filter(|side| !side.is_empty());
    match string(&row["type"]) {
        "user.message" => out.user(string(&data["content"])),
        "assistant.reasoning" => out.text("thinking", render(&data["content"])),
        "assistant.message" => {
            if let Some(text) = data["reasoningText"].as_str() {
                out.text("thinking", text);
            }
            out.text("assistant", render(&data["content"]));
            for request in array(&data["toolRequests"]) {
                out.call_once(
                    &request["toolCallId"],
                    string(&request["name"]),
                    &request["arguments"],
                );
            }
        }
        "tool.execution_start" => out.call_once(
            &data["toolCallId"],
            string(&data["toolName"]),
            &data["arguments"],
        ),
        "tool.execution_complete" => {
            let failed = data["success"] == false;
            let preferred = if failed {
                &data["error"]["message"]
            } else {
                &data["result"]["detailedContent"]
            };
            let result = coalesce([preferred, &data["result"]["content"]]);
            out.at = None;
            out.result(&data["toolCallId"], result, failed);
        }
        "session.compaction_complete" if data["success"] != false => {
            out.compact(&Value::Null, &data["preCompactionTokens"])
        }
        kind if row["type"].is_string()
            && (data["message"].is_string() || data["content"].is_string()) =>
        {
            out.marked(
                "context",
                render(coalesce([&data["message"], &data["content"]])),
                mark(kind),
                true,
            );
        }
        _ => {}
    }
    out
}

pub(super) fn kimi(row: &Value, arguments: Option<&str>) -> RowEvents {
    let stamp = if let Some(seconds) = row["timestamp"].as_f64() {
        json!(seconds * 1000.0)
    } else {
        row["timestamp"].to_owned()
    };
    kimi_event(&row["message"], time(&stamp), None, arguments)
}

fn kimi_event(
    message: &Value,
    at: Option<String>,
    side: Option<String>,
    arguments: Option<&str>,
) -> RowEvents {
    use crate::normalize::truthy;
    let mut out = RowEvents {
        at,
        side,
        ..RowEvents::default()
    };
    let data = &message["payload"];
    let kind = string(&message["type"]);
    match kind {
        "TurnBegin" | "SteerInput" => {
            let value = &data["user_input"];
            if let Some(text) = value.as_str() {
                out.user(text);
            }
            for part in array(value) {
                match string(&part["type"]) {
                    "text" => out.user(string(&part["text"])),
                    "image_url" => {
                        out.url_image("user", &part["image_url"]["url"]);
                    }
                    _ => {}
                }
            }
        }
        "ContentPart" if data["type"] == "text" => out.text("assistant", render(&data["text"])),
        "ContentPart" if data["type"] == "think" && truthy(&data["think"]) => {
            out.text("thinking", render(&data["think"]))
        }
        "ToolCall" => {
            let call = &data["function"];
            let value = arguments.map(|args| json!(args));
            let args = value.as_ref().unwrap_or(&call["arguments"]);
            let empty = json!("");
            out.call(&data["id"], string(&call["name"]), coalesce([args, &empty]));
        }
        "ToolResult" => {
            let value = &data["return_value"];
            let text = pieces(&value["output"], false);
            let output = if text.is_empty() {
                coalesce([&value["message"], &Value::Null]).to_owned()
            } else {
                json!(text)
            };
            out.result_untimed(&data["tool_call_id"], &output, value["is_error"] == true);
        }
        "CompactionBegin" => out.compact(&Value::Null, &Value::Null),
        "PlanDisplay" | "Notification" => {
            let text = data["content"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    if message.get("payload").is_some() {
                        js_json::pretty(data)
                    } else {
                        String::new()
                    }
                });
            out.marked(
                "context",
                text,
                mark(if kind == "PlanDisplay" {
                    "计划"
                } else {
                    "通知"
                }),
                true,
            );
        }
        "StatusUpdate" => {
            let used = &data["token_usage"];
            if truthy(used) {
                out.usage("kimi", &json!({"input_tokens":used["input_other"],"output_tokens":used["output"],
                    "cache_read_input_tokens":used["input_cache_read"],"cache_creation_input_tokens":used["input_cache_creation"]}),
                    "exclusive", data["message_id"].as_str(), None);
            }
        }
        "SubagentEvent" if truthy(&data["event"]) => {
            let id = coalesce([&data["agent_id"], &data["subagent_type"]]);
            let id = if id.is_null() {
                "agent".to_owned()
            } else {
                prefix(&render(id), 40).to_owned()
            };
            return kimi_event(
                &data["event"],
                out.at,
                Some(id).filter(|side| !side.is_empty()),
                None,
            );
        }
        _ => {}
    }
    out
}

pub fn antigravity_result(kind: &str) -> bool {
    matches!(
        kind,
        "RUN_COMMAND" | "CODE_ACTION" | "VIEW_FILE" | "GREP_SEARCH" | "LIST_DIRECTORY" | "GENERIC"
    )
}

pub(super) fn antigravity(
    step: &Value,
    call: Option<&Value>,
    written: Option<&Value>,
) -> RowEvents {
    use crate::{transcript_changes, transcript_events::line};
    use std::collections::HashMap;
    let at = time(&step["created_at"]);
    let mut out = RowEvents {
        at,
        ..RowEvents::default()
    };
    let content = string(&step["content"]);
    let kind = string(&step["type"]);
    match kind {
        "USER_INPUT" => {
            let request = content
                .split_once("<USER_REQUEST>")
                .and_then(|(prefix, rest)| {
                    rest.split_once("</USER_REQUEST>")
                        .map(|(request, suffix)| (prefix, js_trim(request), suffix))
                })
                .filter(|(_, request, _)| !request.is_empty());
            if let Some((prefix, request, suffix)) = request {
                out.text("user", request);
                out.text("context", js_trim(&format!("{prefix}{suffix}")));
            } else {
                out.user(content);
            }
        }
        "PLANNER_RESPONSE" => {
            if let Some(thinking) = step["thinking"].as_str() {
                out.text("thinking", thinking);
            }
            out.text("assistant", content);
            out.usage("antigravity",&json!({
                "input_tokens":step["input_tokens"],"output_tokens":step["output_tokens"],"cached_input_tokens":step["cache_read_tokens"]
            }), "exclusive", None,None);
        }
        _ if step["source"] == "MODEL" && !antigravity_result(kind) => {
            out.text("assistant", content)
        }
        _ => {
            let call = call.unwrap_or(&Value::Null);
            let args = &call["args"];
            let written = written.and_then(|call| {
                call["args"]["TargetFile"]
                    .as_str()
                    .zip(call["args"]["CodeContent"].as_str())
            });
            let changes = (kind == "CODE_ACTION")
                .then(|| {
                    let files = written
                        .into_iter()
                        .map(|(path, text)| {
                            (path.replace('\\', "/").to_lowercase(), text.to_owned())
                        })
                        .collect::<HashMap<_, _>>();
                    transcript_changes::from_antigravity(content, &files)
                })
                .flatten();
            let summary = changes.is_none().then(|| {
                let provided = [
                    "CommandLine",
                    "TargetFile",
                    "AbsolutePath",
                    "Query",
                    "DirectoryPath",
                ]
                .iter()
                .filter_map(|key| args[*key].as_str())
                .find(|value| !js_trim(value).is_empty());
                match provided {
                    Some(text) => line(text, 240),
                    None if !content.is_empty() => line(content, 240),
                    None => line(&js_json::stringify(step), 240),
                }
            });
            let name = call["name"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| step["type"].as_str().map(str::to_lowercase))
                .unwrap_or_else(|| "step".to_owned());
            let id = json!("\0antigravity-step");
            out.tool(&id, &name, &Value::Null, summary, changes, None);
            let failed = step["status"] == "ERROR"
                || kind == "RUN_COMMAND"
                    && content
                        .split_once("The command failed with exit code: ")
                        .is_some_and(|(_, tail)| {
                            tail.as_bytes().first().is_some_and(u8::is_ascii_digit)
                        });
            let output = if content.is_empty() {
                js_json::pretty_width(step, 2)
            } else {
                content.to_owned()
            };
            out.result(&id, &json!(output), failed);
        }
    }
    out
}

pub(super) fn antigravity_pending(call: &Value) -> RowEvents {
    let mut out = RowEvents::default();
    out.call(&Value::Null, string(&call["name"]), &call["args"]);
    out
}

fn words(value: &Value) -> String {
    let text = pieces(value, false);
    if text.is_empty() {
        string(&value["text"]).to_owned()
    } else {
        text
    }
}

pub(super) fn workbuddy(row: &Value) -> RowEvents {
    let mut out = RowEvents {
        at: time(&row["timestamp"]),
        ..RowEvents::default()
    };
    let id = coalesce([&row["callId"], &row["call_id"], &row["id"]]);
    match string(&row["type"]) {
        "message" => {
            let content = coalesce([&row["content"], &row["message"]["content"]]);
            match string(&row["role"]) {
                "user" => out.user(&words(content)),
                "assistant" => {
                    out.text("assistant", words(content));
                    let usage = coalesce([&row["message"]["usage"], &row["providerData"]["usage"]]);
                    if !usage.is_null() {
                        out.usage(
                            "workbuddy",
                            usage,
                            "exclusive",
                            row["providerData"]["messageId"].as_str(),
                            None,
                        );
                    }
                }
                _ => out.text("context", words(content)),
            }
        }
        "function_call" => out.call(id, string(&row["name"]), &row["arguments"]),
        "function_call_result" => {
            let output = &row["output"];
            let text = words(output);
            let text = if !text.is_empty() {
                text
            } else if row.get("output").is_some() && !output.is_string() {
                js_json::stringify(output)
            } else {
                string(output).to_owned()
            };
            out.at = None;
            out.result(
                id,
                &json!(text),
                row["isError"] == true || matches!(string(&row["status"]), "failed" | "error"),
            );
        }
        "reasoning" => {
            let text = [&row["rawContent"], &row["summary"], &row["content"]]
                .into_iter()
                .map(words)
                .find(|text| !text.is_empty())
                .unwrap_or_default();
            out.text("thinking", text);
        }
        _ if row.is_object() && (row["text"].is_string() || row.get("content").is_some()) => {
            out.unknown(&row["type"], row);
        }
        _ => {}
    }
    out
}

fn user_query(text: &str) -> &str {
    let trimmed = js_trim(text);
    trimmed
        .strip_prefix("<user_query>")
        .and_then(|text| text.strip_suffix("</user_query>"))
        .map(js_trim)
        .unwrap_or(text)
}

pub(super) fn cursor(row: &Value, side: Option<&str>) -> RowEvents {
    let mut out = RowEvents {
        side: side.map(str::to_owned),
        ..RowEvents::default()
    };
    let kind = match string(&row["role"]) {
        "user" => "user",
        "assistant" => "assistant",
        _ => return out,
    };
    let content = &row["message"]["content"];
    if let Some(text) = content.as_str() {
        if kind == "user" {
            out.user(user_query(text));
        } else {
            out.text("assistant", text);
        }
    }
    for part in array(content) {
        match string(&part["type"]) {
            "text" if kind == "user" => {
                let value = &part["text"];
                out.user(user_query(&render(value)));
            }
            "text" => out.text("assistant", render(&part["text"])),
            "tool_use" => out.call(&part["id"], string(&part["name"]), &part["input"]),
            "thinking" => out.text(
                "thinking",
                render(coalesce([&part["thinking"], &part["text"]])),
            ),
            _ if part.is_object() || part.is_array() => out.unknown(&part["type"], part),
            _ => {}
        }
    }
    out
}
