use crate::{config_health_syntax as syntax, js_json::ordered_keys};
use serde_json::{json, Value};
use std::sync::LazyLock;

const CODEX: &[&str] = &[
    "SessionStart",
    "SessionEnd",
    "SubagentStart",
    "SubagentStop",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "Stop",
    "Interrupt",
];
const CLAUDE: &[&str] = &[
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "UserPromptExpansion",
    "PreToolUse",
    "PermissionRequest",
    "PermissionDenied",
    "PostToolUse",
    "PostToolUseFailure",
    "PostToolBatch",
    "Notification",
    "SubagentStart",
    "SubagentStop",
    "Stop",
    "StopFailure",
    "PreCompact",
    "PostCompact",
    "TeammateIdle",
    "TaskCreated",
    "TaskCompleted",
    "ConfigChange",
    "InstructionsLoaded",
    "WorktreeCreate",
    "WorktreeRemove",
    "Elicitation",
    "ElicitationResult",
    "Setup",
    "CwdChanged",
    "FileChanged",
    "DirectoryAdded",
    "MessageDisplay",
    "PreModelSwitch",
    "PostModelSwitch",
];
const MODEL: &[&str] = &[
    "PermissionDenied",
    "PostToolBatch",
    "PostToolUse",
    "PostToolUseFailure",
    "PreToolUse",
    "Stop",
    "SubagentStop",
    "TaskCompleted",
    "TaskCreated",
    "TeammateIdle",
    "UserPromptExpansion",
    "UserPromptSubmit",
];
const TOOL: &[&str] = &[
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "PermissionDenied",
];

static DYNAMIC: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r"\$\{|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|\{file:").ok());
static COMMAND: LazyLock<Option<regex::Regex>> =
    LazyLock::new(|| regex::Regex::new(r#"^(?:[^\s"']+|[A-Za-z]:[\\/][^"']+)$"#).ok());

fn text(value: &Value) -> bool {
    value.as_str().is_some_and(|value| !value.trim().is_empty())
}
fn strings(value: &Value) -> bool {
    value
        .as_array()
        .is_some_and(|values| values.iter().all(Value::is_string))
}
fn string_map(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|values| values.values().all(Value::is_string))
}
fn finite(value: &Value) -> bool {
    value
        .as_f64()
        .is_some_and(|number| number.is_finite() && number >= 0.0)
}
fn present_bad(value: &Value, key: &str, valid: impl Fn(&Value) -> bool) -> bool {
    value.get(key).is_some_and(|value| !valid(value))
}

pub(crate) fn row(kind: &str, state: &str, reason: &str, extra: Value) -> Value {
    let mut output = json!({"kind":kind,"state":state,"reason":reason});
    if let (Some(output), Value::Object(extra)) = (output.as_object_mut(), extra) {
        output.extend(extra);
    }
    output
}

struct Diagnostic {
    check: Value,
    rank: u8,
}

impl Diagnostic {
    fn new(kind: &str, extra: Value) -> Self {
        Self {
            check: row(kind, "static-ok", "STRUCTURE_ONLY", extra),
            rank: 0,
        }
    }

    fn mark(&mut self, state: &str, reason: &str) {
        let rank = if state == "issue" { 2 } else { 1 };
        if rank > self.rank {
            self.rank = rank;
            self.check["state"] = json!(state);
            self.check["reason"] = json!(reason);
        }
    }

    fn issue(&mut self, reason: &str) {
        self.mark("issue", reason);
    }
    fn unchecked(&mut self, reason: &str) {
        self.mark("unchecked", reason);
    }
}

fn endpoint(value: &Value, diagnostic: &mut Diagnostic) {
    let Some(value) = value.as_str().filter(|value| !value.trim().is_empty()) else {
        diagnostic.issue("URL_TYPE");
        return;
    };
    if DYNAMIC
        .as_ref()
        .is_some_and(|pattern| pattern.is_match(value))
    {
        diagnostic.unchecked("DYNAMIC_REFERENCE_UNCHECKED");
    } else if !url::Url::parse(value).is_ok_and(|value| matches!(value.scheme(), "http" | "https"))
    {
        diagnostic.issue("URL_TYPE");
    }
}

fn mcp(value: &Value, codex: bool) -> Vec<Value> {
    let section = if codex { "mcp_servers" } else { "mcpServers" };
    let Some(map) = value.as_object() else {
        return vec![row(
            "mcp",
            "issue",
            "MAP_REQUIRED",
            json!({"location":{"section":section}}),
        )];
    };
    let mut rows = Vec::new();
    for (index, key) in ordered_keys(map).into_iter().take(64).enumerate() {
        let location = json!({"section":section,"entry":index+1});
        let item = &map[key];
        if !item.is_object() {
            rows.push(row(
                "mcp",
                "issue",
                "ENTRY_REQUIRED",
                json!({"location":location}),
            ));
            continue;
        }
        let headers = ["headers", "http_headers", "env_http_headers"];
        let mut check = Diagnostic::new(
            "mcp",
            json!({
                "location":location,"enabled":item["enabled"].as_bool(),"argsCount":item["args"].as_array().map_or(0, Vec::len),
                "environmentPresent":item.get("env").is_some(),"headersPresent":headers.iter().any(|key| item.get(key).is_some()),
                "transport":"unknown","executableCheck":"unchecked"
            }),
        );
        let timeouts: &[&str] = if codex {
            &[
                "startup_timeout_sec",
                "startup_timeout_ms",
                "tool_timeout_sec",
            ]
        } else {
            &["timeout"]
        };
        if present_bad(item, "enabled", Value::is_boolean)
            || codex && present_bad(item, "required", Value::is_boolean)
            || present_bad(item, "args", strings)
            || present_bad(item, "env", string_map)
            || headers.iter().any(|key| present_bad(item, key, string_map))
            || timeouts.iter().any(|key| present_bad(item, key, finite))
        {
            check.issue("FIELD_TYPE");
        }
        if codex {
            if ["enabled_tools", "disabled_tools", "scopes"]
                .iter()
                .any(|key| present_bad(item, key, strings))
                || present_bad(item, "cwd", Value::is_string)
                || present_bad(item, "env_vars", |value| {
                    value.as_array().is_some_and(|entries| {
                        entries.iter().all(|entry| {
                            entry.is_string()
                                || entry.is_object()
                                    && text(&entry["name"])
                                    && matches!(entry["source"].as_str(), Some("local" | "remote"))
                        })
                    })
                })
            {
                check.issue("FIELD_TYPE");
            }
            if item.get("startup_timeout_sec").is_some() && item.get("startup_timeout_ms").is_some()
            {
                check.unchecked("TIMEOUT_ALIAS_UNCHECKED");
            }
        }
        if let Some(helper) = item.get(if codex {
            "http_headers_helper"
        } else {
            "headersHelper"
        }) {
            if text(helper) {
                check.unchecked("DYNAMIC_HELPER_UNCHECKED");
            } else {
                check.issue("FIELD_TYPE");
            }
        }
        match (item.get("command"), item.get("url")) {
            (Some(_), Some(_)) => check.issue("TRANSPORT_CONFLICT"),
            (None, Some(url)) => {
                check.check["transport"] = json!("remote");
                check.check["executableCheck"] = json!("not-applicable");
                if !codex && !matches!(item["type"].as_str(), Some("http" | "sse")) {
                    if item.get("type").is_some() {
                        check.unchecked("TRANSPORT_UNCONFIRMED");
                    } else {
                        check.issue("TRANSPORT_UNCONFIRMED");
                    }
                    if !text(url) {
                        check.issue("URL_TYPE");
                    }
                } else {
                    endpoint(url, &mut check);
                }
            }
            (Some(command), None) => {
                check.check["transport"] = json!("stdio");
                if let Some(command) = command
                    .as_str()
                    .filter(|command| !command.trim().is_empty())
                {
                    if command.trim() != command
                        || command.contains([
                            '\r', '\n', ';', '&', '|', '<', '>', '`', '$', '%', '{', '}',
                        ])
                        || !COMMAND
                            .as_ref()
                            .is_some_and(|pattern| pattern.is_match(command))
                    {
                        check.unchecked("COMMAND_UNCHECKED");
                    }
                } else {
                    check.issue("COMMAND_REQUIRED");
                }
                if !codex && item.get("type").is_some() && item["type"] != "stdio" {
                    check.unchecked("TRANSPORT_UNCONFIRMED");
                }
            }
            (None, None) => check.issue("TRANSPORT_REQUIRED"),
        }
        rows.push(check.check);
    }
    if map.len() > 64 {
        rows.push(row(
            "mcp",
            "unchecked",
            "ENTRY_LIMIT",
            json!({"location":{"section":section},"omitted":map.len()-64}),
        ));
    }
    if rows.is_empty() {
        rows.push(row(
            "mcp",
            "static-ok",
            "NO_ENTRIES",
            json!({"location":{"section":section}}),
        ));
    }
    rows
}

fn handler(item: &Value, location: Value, codex: bool, event: &str, known: bool) -> Value {
    if !item.is_object() {
        return row(
            "hooks",
            "issue",
            "HANDLER_REQUIRED",
            json!({"location":location}),
        );
    }
    let kind = match item["type"].as_str() {
        Some(value @ ("command" | "http" | "mcp_tool" | "prompt" | "agent")) => value,
        _ => "unknown",
    };
    let mut check = Diagnostic::new(
        "hooks",
        json!({"location":location,"handlerType":kind,"executed":false}),
    );
    if !known {
        check.unchecked("EVENT_UNCONFIRMED");
    }
    if present_bad(item, "timeout", |value| {
        finite(value) && value.as_f64() != Some(0.0)
    }) || present_bad(item, "async", Value::is_boolean)
        || present_bad(item, "statusMessage", Value::is_string)
    {
        check.issue("FIELD_TYPE");
    }
    if codex
        && present_bad(item, "additionalContextLimit", |v| {
            v.as_f64()
                .is_some_and(|n| n >= 0.0 && n <= 9_007_199_254_740_991.0 && n.fract() == 0.0)
        })
    {
        check.issue("FIELD_TYPE");
    }
    if known && codex && kind == "mcp_tool" && event == "SessionEnd" {
        check.issue("EVENT_HANDLER_UNSUPPORTED");
    }
    if known && !codex {
        if matches!(kind, "prompt" | "agent")
            && !MODEL.contains(&event)
            && !(event == "PermissionRequest" && kind == "prompt")
            || kind == "http" && matches!(event, "SessionStart" | "Setup")
        {
            check.issue("EVENT_HANDLER_UNSUPPORTED");
        }
        if kind == "mcp_tool" && event == "Setup" {
            check.issue("MCP_SETUP_UNAVAILABLE");
        }
        if kind == "mcp_tool" && event == "SessionStart" {
            check.unchecked("MCP_STARTUP_CONTEXT_UNCHECKED");
        }
    }
    if item["async"] == true && kind != "command" {
        check.unchecked("ASYNC_COMMAND_ONLY");
    }
    if codex && event == "SessionEnd" && kind == "command" && item["async"] == true {
        check.unchecked("SESSION_END_FORCED_SYNC");
    }
    if !codex {
        if ["asyncRewake", "once"]
            .iter()
            .any(|key| present_bad(item, key, Value::is_boolean))
        {
            check.issue("FIELD_TYPE");
        }
        if item["asyncRewake"] == true && kind != "command" {
            check.unchecked("ASYNC_COMMAND_ONLY");
        }
        if item["once"] == true {
            check.unchecked("ONCE_IGNORED_IN_SETTINGS");
        }
        if let Some(condition) = item.get("if") {
            if !text(condition) {
                check.issue("FIELD_TYPE");
            } else if known && !TOOL.contains(&event) {
                check.issue("CONDITION_EVENT_UNSUPPORTED");
            } else {
                check.unchecked("CONDITION_UNCHECKED");
            }
        }
    }
    if kind == "unknown" || codex && matches!(kind, "http" | "prompt" | "agent") {
        check.unchecked("HANDLER_UNCONFIRMED");
    }
    match kind {
        "command" => {
            let keys: &[&str] = if codex {
                &["command", "commandWindows", "command_windows"]
            } else {
                &["command"]
            };
            if !keys.iter().any(|key| text(&item[*key])) {
                check.issue("HANDLER_VALUE_REQUIRED");
            }
            if keys
                .iter()
                .any(|key| present_bad(item, key, Value::is_string))
                || !codex && present_bad(item, "args", strings)
            {
                check.issue("FIELD_TYPE");
            }
        }
        "prompt" | "agent" => {
            if !text(&item["prompt"]) {
                check.issue("HANDLER_VALUE_REQUIRED");
            }
            if !codex && present_bad(item, "model", Value::is_string) {
                check.issue("FIELD_TYPE");
            }
        }
        "http" if !codex => {
            endpoint(&item["url"], &mut check);
            if present_bad(item, "headers", string_map)
                || present_bad(item, "allowedEnvVars", strings)
            {
                check.issue("FIELD_TYPE");
            }
        }
        "mcp_tool" => {
            if !text(&item["server"]) || !text(&item["tool"]) {
                check.issue("HANDLER_VALUE_REQUIRED");
            }
            if present_bad(item, "input", Value::is_object) {
                check.issue("FIELD_TYPE");
            }
            check.unchecked("MCP_RUNTIME_UNCHECKED");
        }
        _ => {}
    }
    check.check
}

fn hooks(value: &Value, codex: bool) -> Vec<Value> {
    let Some(map) = value.as_object() else {
        return vec![row(
            "hooks",
            "issue",
            "MAP_REQUIRED",
            json!({"location":{"section":"hooks"}}),
        )];
    };
    let mut checks = Vec::new();
    let mut count = 0;
    for (event_index, event) in ordered_keys(map).into_iter().enumerate() {
        let event_location = json!({"section":"hooks","event":event_index+1});
        let known = (if codex { CODEX } else { CLAUDE }).contains(&event.as_str());
        count += 1;
        if count > 64 {
            checks.push(row(
                "hooks",
                "unchecked",
                "ENTRY_LIMIT",
                json!({"location":event_location}),
            ));
            break;
        }
        let Some(groups) = map[event].as_array() else {
            checks.push(row(
                "hooks",
                "issue",
                "GROUP_ARRAY_REQUIRED",
                json!({"location":event_location}),
            ));
            continue;
        };
        if !known && groups.is_empty() {
            checks.push(row(
                "hooks",
                "unchecked",
                "EVENT_UNCONFIRMED",
                json!({"location":event_location}),
            ));
        }
        for (group_index, group) in groups.iter().enumerate() {
            let mut location = event_location.clone();
            location["group"] = json!(group_index + 1);
            count += 1;
            if count > 128 {
                checks.push(row(
                    "hooks",
                    "unchecked",
                    "ENTRY_LIMIT",
                    json!({"location":location}),
                ));
                return checks;
            }
            let group_hooks = group["hooks"]
                .as_array()
                .filter(|_| group.is_object() && !present_bad(group, "matcher", Value::is_string));
            let Some(group_hooks) = group_hooks else {
                checks.push(row(
                    "hooks",
                    "issue",
                    "GROUP_REQUIRED",
                    json!({"location":location}),
                ));
                continue;
            };
            if !known && group_hooks.is_empty() {
                checks.push(row(
                    "hooks",
                    "unchecked",
                    "EVENT_UNCONFIRMED",
                    json!({"location":location}),
                ));
            }
            for (index, item) in group_hooks.iter().enumerate() {
                let mut location = location.clone();
                location["handler"] = json!(index + 1);
                count += 1;
                if count > 128 {
                    checks.push(row(
                        "hooks",
                        "unchecked",
                        "ENTRY_LIMIT",
                        json!({"location":location}),
                    ));
                    return checks;
                }
                checks.push(handler(item, location, codex, event, known));
            }
        }
    }
    if checks.is_empty() {
        checks.push(row(
            "hooks",
            "static-ok",
            "NO_ENTRIES",
            json!({"location":{"section":"hooks"}}),
        ));
    }
    checks
}

fn skill(value: &Value, codex: bool) -> Value {
    let name_present = value.get("name").is_some();
    let description_present = value.get("description").is_some();
    let mut check = Diagnostic::new(
        "skills",
        json!({"location":{"section":"frontmatter"},"namePresent":name_present,"descriptionPresent":description_present}),
    );
    check.check["reason"] = json!("FRONTMATTER_ONLY");
    if present_bad(value, "name", text) || present_bad(value, "description", text) {
        check.issue("FIELD_TYPE");
    }
    if codex && (!name_present || !description_present) {
        check.issue("SKILL_FIELD_REQUIRED");
    }
    if !codex {
        for key in ["disable-model-invocation", "user-invocable"] {
            if let Some(raw) = value.get(key).filter(|raw| !raw.is_boolean()) {
                let alias = raw.as_str().is_some_and(|s| {
                    matches!(
                        s.to_ascii_lowercase().as_str(),
                        "true" | "false" | "yes" | "no" | "on" | "off" | "0" | "1"
                    )
                });
                if alias || matches!(raw.as_f64(), Some(0.0 | 1.0)) {
                    check.unchecked("BOOLEAN_COERCION_UNCHECKED");
                } else {
                    check.issue("FIELD_TYPE");
                }
            }
        }
        if present_bad(value, "allowed-tools", |v| v.is_string() || strings(v))
            || ["argument-hint", "when_to_use", "agent", "model"]
                .iter()
                .any(|key| present_bad(value, key, Value::is_string))
        {
            check.issue("FIELD_TYPE");
        }
        if let Some(context) = value.get("context") {
            if !context.is_string() {
                check.issue("FIELD_TYPE");
            } else if context != "fork" {
                check.unchecked("CONTEXT_UNCONFIRMED");
            }
        }
    }
    check.check
}

fn hook_switches(value: &Value, codex: bool, kind: &str) -> Vec<Value> {
    let mut result = Vec::new();
    if !codex && kind != "claude-mcp" {
        if let Some(raw) = value.get("disableAllHooks") {
            let location = json!({"section":"disableAllHooks"});
            let item = match raw.as_bool() {
                Some(disabled) => row(
                    "hooks",
                    if disabled { "unchecked" } else { "static-ok" },
                    if disabled {
                        "HOOKS_DISABLED_IN_FILE"
                    } else {
                        "STRUCTURE_ONLY"
                    },
                    json!({"location":location,"configuredEnabled":!disabled}),
                ),
                None => row("hooks", "issue", "FIELD_TYPE", json!({"location":location})),
            };
            result.push(item);
        }
    }
    if kind == "codex-config" {
        if let Some(features) = value.get("features") {
            if !features.is_object() {
                result.push(row(
                    "hooks",
                    "issue",
                    "FIELD_TYPE",
                    json!({"location":{"section":"features"}}),
                ));
            } else {
                for key in ["hooks", "codex_hooks"] {
                    if let Some(raw) = features.get(key) {
                        let location = json!({"section":format!("features.{key}")});
                        let item = match raw.as_bool() {
                            Some(enabled) => {
                                let reason = if !enabled {
                                    "HOOKS_DISABLED_IN_FILE"
                                } else if key == "codex_hooks" {
                                    "HOOKS_ALIAS_UNCHECKED"
                                } else if features.get("codex_hooks").is_some() {
                                    "HOOKS_PRECEDENCE_UNCHECKED"
                                } else {
                                    "STRUCTURE_ONLY"
                                };
                                row(
                                    "hooks",
                                    if reason == "STRUCTURE_ONLY" {
                                        "static-ok"
                                    } else {
                                        "unchecked"
                                    },
                                    reason,
                                    json!({"location":location,"configuredEnabled":enabled}),
                                )
                            }
                            None => {
                                row("hooks", "issue", "FIELD_TYPE", json!({"location":location}))
                            }
                        };
                        result.push(item);
                    }
                }
            }
        }
    }
    result
}

fn skill_overrides(skills: &Value) -> Vec<Value> {
    let section = "skills.config";
    if !skills.is_object() || present_bad(skills, "config", Value::is_array) {
        return vec![row(
            "skill-overrides",
            "issue",
            "FIELD_TYPE",
            json!({"location":{"section":section}}),
        )];
    }
    let Some(items) = skills["config"]
        .as_array()
        .filter(|items| !items.is_empty())
    else {
        return vec![row(
            "skill-overrides",
            "unchecked",
            "REFERENCES_NOT_FOLLOWED",
            json!({"location":{"section":section},"count":0}),
        )];
    };
    let mut rows: Vec<_> = items
        .iter()
        .take(64)
        .enumerate()
        .map(|(index, item)| {
            let valid = item.is_object()
                && text(&item["path"])
                && !present_bad(item, "enabled", Value::is_boolean);
            row(
                "skill-overrides",
                if valid { "unchecked" } else { "issue" },
                if valid {
                    "REFERENCES_NOT_FOLLOWED"
                } else {
                    "FIELD_TYPE"
                },
                json!({"location":{"section":section,"entry":index+1}}),
            )
        })
        .collect();
    if items.len() > 64 {
        rows.push(row(
            "skill-overrides",
            "unchecked",
            "ENTRY_LIMIT",
            json!({"location":{"section":section},"omitted":items.len()-64}),
        ));
    }
    rows
}

/// Returns only diagnostics and the transient name used to detect duplicate Skills.
pub fn project(agent: &str, kind: &str, source: &str) -> (Vec<Value>, Option<String>) {
    let parsed = match kind {
        "codex-config" => syntax::toml(source),
        "skill" => syntax::frontmatter(source),
        _ => syntax::json(source),
    };
    let value = match parsed {
        Ok(value) if value.is_object() => value,
        Ok(_) => {
            return (
                vec![row("file", "issue", "ROOT_OBJECT_REQUIRED", Value::Null)],
                None,
            )
        }
        Err(reason) => {
            let reason = if matches!(reason, "DUPLICATE_KEY" | "PARSE_LIMIT") {
                reason
            } else {
                "PARSE_UNSUPPORTED"
            };
            return (vec![row("file", "unchecked", reason, Value::Null)], None);
        }
    };
    let codex = agent == "codex";
    if kind == "skill" {
        return (
            vec![skill(&value, codex)],
            value["name"]
                .as_str()
                .filter(|name| !name.trim().is_empty())
                .map(str::to_owned),
        );
    }
    let mut rows = hook_switches(&value, codex, kind);
    if matches!(kind, "codex-config" | "claude-mcp") {
        let key = if codex { "mcp_servers" } else { "mcpServers" };
        if let Some(value) = value.get(key) {
            rows.extend(mcp(value, codex));
        } else {
            rows.push(row("mcp", "static-ok", "NO_ENTRIES", Value::Null));
        }
    }
    if kind != "claude-mcp" {
        if let Some(value) = value.get("hooks") {
            rows.extend(hooks(value, codex));
        } else {
            rows.push(row("hooks", "static-ok", "NO_ENTRIES", Value::Null));
        }
    }
    if kind == "codex-config" {
        if let Some(skills) = value.get("skills") {
            rows.extend(skill_overrides(skills));
        }
    }
    (rows, None)
}
