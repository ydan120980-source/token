use crate::sessions::js_trim;
use indexmap::IndexSet;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;

macro_rules! matches_with {
    ($pattern:literal) => {{
        static REGEX: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new($pattern).ok());
        REGEX.as_ref()
    }};
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserText {
    pub kind: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attached: Option<Vec<Attachment>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answered: Option<bool>,
}

fn words(kind: &str, text: &str, label: Option<&str>) -> UserText {
    UserText {
        kind: kind.to_owned(),
        text: text.to_owned(),
        label: label.map(str::to_owned),
        attached: None,
        answered: None,
    }
}

fn label(tag: &str) -> Option<&'static str> {
    Some(match tag {
        "environment_context" => "环境信息",
        "user_instructions" => "用户指令",
        "INSTRUCTIONS" => "指令",
        "session_context" => "会话环境",
        "hook_context" => "Hook 内容",
        "permissions instructions" => "权限说明",
        "system-reminder" => "系统提醒",
        "external_codex_apps_open_page" => "打开了一个应用页面",
        "turn_aborted" => "这一轮被中断",
        "subagent_notification" | "subagent-notification" => "子 Agent 通知",
        "task-notification" => "任务通知",
        "in-app-browser-context" => "内置浏览器内容",
        "plugin_reference" => "插件引用",
        "recommended_plugins" => "推荐的插件",
        "skill" => "Skill 内容",
        "local-command-caveat" => "本地命令说明",
        "local-command-stdout" => "本地命令输出",
        _ => return None,
    })
}

pub(crate) fn prefix(text: &str, limit: usize) -> &str {
    let mut units = 0;
    for (index, character) in text.char_indices() {
        units += character.len_utf16();
        if units > limit {
            return &text[..index];
        }
    }
    text
}

fn tags(mut remaining: &str) -> Option<Vec<&str>> {
    let open = matches_with!(r"^<([a-zA-Z][a-zA-Z0-9_-]*)(?:\s[^>]*)?>")?;
    let mut tags = Vec::new();
    remaining = js_trim(remaining);
    while !remaining.is_empty() {
        let found = open.captures(remaining)?;
        let tag = found.get(1)?.as_str();
        let close = format!("</{tag}>");
        let (_, after) = remaining.split_once(&close)?;
        tags.push(tag);
        remaining = js_trim(after);
    }
    (!tags.is_empty()).then_some(tags)
}

fn answers(text: &str) -> Option<UserText> {
    let body = js_trim(text)
        .strip_prefix("<send_user_message_question_reply>")?
        .strip_suffix("</send_user_message_question_reply>")?;
    let value: Value = serde_json::from_str(body).ok()?;
    let items = if let Some(items) = value.as_array() {
        items.as_slice()
    } else {
        std::slice::from_ref(&value)
    };
    let mut pairs = items
        .iter()
        .filter_map(|item| Some((item["question"].as_str()?, item["answer"].as_str()?)));
    let first = pairs.next()?;
    let first_line = first
        .1
        .split('\n')
        .map(js_trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    let text = std::iter::once(first)
        .chain(pairs)
        .map(|(question, answer)| {
            let quoted = question
                .split('\n')
                .map(|line| format!("> {line}"))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{quoted}\n\n{answer}")
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(UserText {
        kind: "user".to_owned(),
        text,
        label: Some(format!("回答：{}", prefix(first_line, 80))),
        attached: None,
        answered: Some(true),
    })
}

fn attachments(text: &str) -> Vec<Attachment> {
    let Some(pattern) = matches_with!(r"^##\s+(.+?)(?::\s+(.+))?\s*$") else {
        return Vec::new();
    };
    let excluded = matches_with!(r"^(?:My request|Referenced ChatGPT conversation)(?-u:\b)");
    text.split('\n')
        .filter_map(|line| {
            let found = pattern.captures(line)?;
            let name = found.get(1)?.as_str();
            if excluded.is_some_and(|pattern| pattern.is_match(name)) {
                return None;
            }
            Some(Attachment {
                name: prefix(js_trim(name), 200).to_owned(),
                path: found
                    .get(2)
                    .map(|path| prefix(js_trim(path.as_str()), 1000).to_owned()),
            })
        })
        .take(64)
        .collect()
}

/// Identify recorded user text and surrounding context without evaluating it.
pub fn classify(value: &str) -> UserText {
    let text = matches_with!(r"<image(?-u:\b)[^>]*>\s*</image>\s*")
        .map_or(std::borrow::Cow::Borrowed(value), |pattern| {
            pattern.replace_all(value, "")
        });
    let leading = js_trim(&text);
    if [
        "# Files mentioned by the user:",
        "# Context from my IDE setup:",
        "## Referenced ChatGPT conversation:",
    ]
    .iter()
    .any(|head| leading.starts_with(head))
    {
        let (block, request) = text
            .rsplit_once("\n## My request for Codex:\n")
            .unwrap_or((&text, ""));
        let attached = attachments(block);
        let request = js_trim(request);
        if !request.is_empty() {
            let mut classified = classify(request);
            if !attached.is_empty() {
                classified.attached = Some(attached);
            }
            return classified;
        }
        if !attached.is_empty() {
            let text = attached
                .iter()
                .map(|file| file.name.as_str())
                .collect::<Vec<_>>()
                .join("\n");
            let label = format!("附带了 {} 个文件", attached.len());
            let mut classified = words("user", &text, Some(&label));
            classified.attached = Some(attached);
            return classified;
        }
    }
    if let Some(answer) = answers(&text) {
        return answer;
    }
    if leading.starts_with("# AGENTS.md instructions") {
        return words("context", &text, Some("AGENTS.md 指令"));
    }
    if matches_with!(r"^<permissions instructions(?-u:\b)")
        .is_some_and(|pattern| pattern.is_match(leading))
    {
        return words("context", &text, label("permissions instructions"));
    }
    match tags(&text) {
        Some(tags) if tags.iter().all(|tag| label(tag).is_some() ||
            matches_with!(r"(?i:[a-z0-9][_-][a-z0-9])").is_some_and(|pattern| pattern.is_match(tag))) => {
            if tags.as_slice() == ["user_shell_command"] {
                let command = text.split_once("<command>").and_then(|(_, rest)| rest.split_once("</command>"))
                    .map(|(command, _)| js_trim(command));
                if let Some(command) = command.filter(|command| !command.is_empty()) { return words("command", command, None); }
            }
            return words("context", &text, tags.iter().find_map(|tag| label(tag)).or(Some("注入的上下文")));
        }
        None => {
            if let Some(known) = matches_with!(r"^<(environment_context|user_instructions|system-reminder|INSTRUCTIONS|session_context|hook_context)(?-u:\b)")
                .and_then(|pattern| pattern.captures(leading)).and_then(|found| found.get(1)) {
                return words("context", &text, label(known.as_str()));
            }
        }
        _ => {}
    }
    words("user", &text, None)
}

pub fn slash(text: &str) -> bool {
    text.encode_utf16().count() <= 500
        && !js_trim(text).contains('\n')
        && matches_with!(r"^\s*/[A-Za-z][a-zA-Z0-9_:-]*(?:\s|$)")
            .is_some_and(|pattern| pattern.is_match(text))
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub path: String,
    pub lines: String,
    pub note: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitedText {
    pub text: String,
    pub cited: Option<Vec<Citation>>,
}

pub fn citations(text: &str) -> CitedText {
    if !text.contains("<oai-mem-citation>") {
        return CitedText {
            text: text.to_owned(),
            cited: None,
        };
    }
    let mut cited = Vec::new();
    let clean = if let Some(pattern) =
        matches_with!(r"(?s)\s*<oai-mem-citation>(.*?)</oai-mem-citation>\s*")
    {
        pattern.replace_all(text, |found: &regex::Captures<'_>| {
            let block = found[1]
                .split_once("<citation_entries>")
                .and_then(|(_, body)| body.split_once("</citation_entries>"))
                .map(|(body, _)| body);
            if let Some((block, pattern)) = block.zip(matches_with!(
                r"^\s*(.+?):([0-9]+(?:-[0-9]+)?)\|note=\[(.*)\]\s*$"
            )) {
                for line in block.split('\n') {
                    if cited.len() >= 64 {
                        break;
                    }
                    if let Some(entry) = pattern.captures(line) {
                        cited.push(Citation {
                            path: prefix(&entry[1], 1000).to_owned(),
                            lines: entry[2].to_owned(),
                            note: prefix(&entry[3], 400).to_owned(),
                        });
                    }
                }
            }
            "\n\n"
        })
    } else {
        std::borrow::Cow::Borrowed(text)
    };
    CitedText {
        text: js_trim(&clean).to_owned(),
        cited: Some(cited),
    }
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeMode {
    pub name: String,
    pub summary: String,
    pub commands: Vec<String>,
    pub patch: Option<String>,
}

fn literal(source: &str) -> Option<String> {
    let mut chars = source.chars().peekable();
    let quote = chars.next()?;
    if !matches!(quote, '\'' | '"' | '`') {
        return None;
    }
    let mut units = Vec::<u16>::new();
    while let Some(mut character) = chars.next() {
        if character == quote {
            return Some(String::from_utf16_lossy(&units));
        }
        if character == '\\' {
            character = chars.next()?;
            character = match character {
                'n' => '\n',
                't' => '\t',
                'r' => '\r',
                'u' => {
                    let hex: String = chars.clone().take(4).collect();
                    if hex.len() == 4 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                        let value = u16::from_str_radix(&hex, 16).ok()?;
                        units.push(value);
                        for _ in 0..4 {
                            chars.next();
                        }
                        continue;
                    }
                    'u'
                }
                other => other,
            };
        }
        units.extend_from_slice(character.encode_utf16(&mut [0; 2]));
    }
    None
}

pub(crate) fn one_line(text: &str) -> String {
    js_trim(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Extract tool names and literal arguments from historical code-mode source; never execute it.
pub fn code_mode(source: &str) -> Option<CodeMode> {
    let calls = matches_with!(
        r#"(?-u:\b)tools\s*(?:\.\s*([A-Za-z_$][A-Za-z0-9_$]*)|\[\s*["']([^"']+)["']\s*\])\s*\("#
    )?;
    let command_key = matches_with!(r"^\s*\{[^}]*?(?-u:\b)(?:cmd|command)\s*:\s*")?;
    let patch_key = matches_with!(r"^\s*(?:\{[^}]*?(?-u:\b)input\s*:\s*)?")?;
    let mut tools = IndexSet::new();
    let mut commands = Vec::new();
    let mut patch = None;
    for call in calls.captures_iter(source) {
        let tool = call.get(1).or_else(|| call.get(2))?.as_str();
        tools.insert(tool);
        let rest = source.get(call.get(0)?.end()..)?;
        let head = prefix(rest, 400);
        if matches!(
            tool,
            "exec_command" | "shell" | "shell_command" | "local_shell" | "write_stdin_never"
        ) {
            if let Some(command) = command_key
                .find(head)
                .and_then(|key| literal(&rest[key.end()..]))
                .filter(|command| !js_trim(command).is_empty())
            {
                commands.push(prefix(&one_line(&command), 240).to_owned());
            }
        } else if tool == "apply_patch" && patch.is_none() {
            patch = patch_key
                .find(head)
                .and_then(|key| literal(&rest[key.end()..]))
                .filter(|value| value.contains("*** Begin Patch"));
        }
    }
    let first = tools.first()?;
    let mut summary = if let Some(first) = commands.first() {
        first.to_owned()
    } else {
        tools
            .iter()
            .copied()
            .filter(|tool| {
                !matches!(
                    *tool,
                    "exec_command" | "shell" | "shell_command" | "local_shell"
                )
            })
            .take(4)
            .collect::<Vec<_>>()
            .join("、")
    };
    if commands.len() > 1 {
        summary.push_str(&format!(" 等 {} 条", commands.len()));
    }
    let name = if tools.len() == 1 {
        *first
    } else if commands.is_empty() {
        "exec"
    } else {
        "exec_command"
    };
    commands.truncate(64);
    Some(CodeMode {
        name: name.to_owned(),
        summary,
        commands,
        patch,
    })
}
