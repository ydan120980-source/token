use super::*;

static SENSITIVE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(
        "(?i)(token|secret|password|passwd|api[_-]?key|apikey|credential|auth|bearer|cookie)",
    )
    .ok()
});
static ARG_SECRET: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new("(?i)(^|[-_])(token|api[-_]?key|password|secret)=.").ok());
static DYNAMIC: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"\$\{|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|\{env:|\{file:").ok());
static REFERENCE: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::new(r"\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%|\{env:([A-Za-z_][A-Za-z0-9_]*)\}").ok()
});

fn matches(re: &Option<Regex>, value: &str) -> bool {
    re.as_ref().is_some_and(|regex| regex.is_match(value))
}

fn executable(command: &str) -> Option<&str> {
    let command = command.trim();
    if matches(&DYNAMIC, command) {
        return None;
    }
    let name = if let Some(quote) = command.chars().next().filter(|ch| matches!(ch, '"' | '\'')) {
        command[1..].split_once(quote)?.0
    } else {
        command.split_whitespace().next()?
    };
    if name.is_empty() || name.contains(['|', '&', ';', '<', '>', '\u{60}']) {
        return None;
    }
    Some(name)
}

fn local_file(value: &str) -> bool {
    Path::new(value).is_absolute()
        && !value.starts_with(r"\\")
        && !value.starts_with("//")
        && fs::metadata(value).is_ok_and(|metadata| metadata.is_file())
}

fn locate(command: &str, env: &Environment) -> Option<bool> {
    let name = executable(command)?;
    if pathx::is_absolute(name) {
        return Some(local_file(name));
    }
    if name.contains(['\\', '/']) || env.path.is_empty() {
        return None;
    }
    let mut extensions = vec![String::new()];
    if cfg!(windows) {
        let suffix = if env.path_ext.is_empty() {
            ".COM;.EXE;.BAT;.CMD"
        } else {
            &env.path_ext
        };
        extensions.extend(suffix.split(';').take(16).map(str::to_ascii_lowercase));
    }
    Some(
        env.path
            .split(if cfg!(windows) { ';' } else { ':' })
            .filter(|dir| !dir.is_empty())
            .take(128)
            .any(|dir| {
                extensions
                    .iter()
                    .any(|ext| local_file(&pathx::join(&[dir, &format!("{name}{ext}")])))
            }),
    )
}

fn basename_of(command: &str) -> String {
    executable(command).map_or_else(
        || "未知（用了变量或 shell 语法）".to_owned(),
        |name| clean(&pathx::basename(name)),
    )
}

fn structural(code: &str) -> (&'static str, &'static str) {
    match code {
        "FIELD_TYPE" => ("配置里有字段的类型不对", "对照该 Agent 的文档改正这个字段"),
        "TRANSPORT_CONFLICT" => ("同时写了命令和地址，只能有一个", "删掉不用的那个"),
        "TRANSPORT_REQUIRED" => ("既没有命令也没有地址，启动不了", "补上 command 或 url"),
        "COMMAND_REQUIRED" => ("命令是空的", "填上要运行的程序"),
        "URL_TYPE" => ("地址不是有效的 http 或 https", "改成完整的地址"),
        "ENTRY_REQUIRED" => ("这一项不是有效的配置", "改成对象形式"),
        "HANDLER_VALUE_REQUIRED" => ("Hook 缺少要执行的内容", "补上 command 或 prompt"),
        "EVENT_HANDLER_UNSUPPORTED" => ("这个事件不支持这种 Hook", "换一种类型或换一个事件"),
        "GROUP_REQUIRED" | "GROUP_ARRAY_REQUIRED" => {
            ("Hook 分组的格式不对", "按 hooks 数组的格式改")
        }
        "HANDLER_REQUIRED" => ("Hook 的格式不对", "按文档的格式改"),
        "SKILL_FIELD_REQUIRED" => ("SKILL.md 缺少 name 或 description", "在开头的前言里补上"),
        "DUPLICATE_SKILL_NAME" => ("有两个 Skill 同名，只会用到其中一个", "改掉其中一个的名字"),
        "MCP_SETUP_UNAVAILABLE" => ("这个事件调用不了 MCP", "换一个事件"),
        "CONDITION_EVENT_UNSUPPORTED" => ("这个事件不支持 if 条件", "去掉 if"),
        _ => ("结构检查没有通过", ""),
    }
}

struct Server<'a> {
    command: Option<&'a str>,
    args: &'a [Value],
    url: Option<&'a str>,
    environment: Option<&'a Map<String, Value>>,
    headers: Option<&'a Map<String, Value>>,
    variables: Vec<&'a Value>,
    timeout: Option<f64>,
}
impl<'a> Server<'a> {
    fn new(agent: &str, raw: &'a Value) -> Self {
        if agent == "opencode" {
            let list = raw["command"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default();
            return Self {
                command: list.first().and_then(Value::as_str),
                args: list.get(1..).unwrap_or_default(),
                url: raw["url"].as_str(),
                environment: raw["environment"].as_object(),
                headers: raw["headers"].as_object(),
                variables: Vec::new(),
                timeout: raw["timeout"].as_f64().map(|value| value / 1000.0),
            };
        }
        let variables = raw["env_vars"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| {
                if row.is_string() {
                    Some(row)
                } else {
                    row.get("name")
                }
            })
            .chain(
                raw.get("bearer_token_env_var")
                    .filter(|value| value.is_string()),
            )
            .filter(|value| !value.is_null() && value.as_str() != Some(""))
            .collect();
        Self {
            command: raw["command"].as_str(),
            args: raw["args"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or_default(),
            url: raw["url"].as_str().or_else(|| raw["httpUrl"].as_str()),
            environment: raw["env"].as_object(),
            headers: raw["headers"]
                .as_object()
                .or_else(|| raw["http_headers"].as_object()),
            variables,
            timeout: raw["startup_timeout_sec"]
                .as_f64()
                .or_else(|| raw["timeout"].as_f64()),
        }
    }

    fn review(&self, env: &Environment, row: &mut Draft) {
        let url = self.url.filter(|url| !url.is_empty());
        let command = self.command.filter(|command| !command.is_empty());
        let connection = if url.is_some() {
            "远程"
        } else if command.is_some() {
            "本地命令"
        } else {
            "未知"
        };
        row.details.push(detail("连接方式", connection));
        if let Some(command) = command {
            let name = basename_of(command);
            row.details.extend([
                detail("命令", &name),
                detail("参数", format!("{} 个", self.args.len())),
            ]);
            if locate(command, env) == Some(false) {
                row.problems.push(problem(
                    "warn",
                    format!("在本机的 PATH 里找不到命令 {name}"),
                    "先安装它，或把 command 改成完整路径",
                    Some("stop-optional"),
                ));
            }
            if self
                .args
                .iter()
                .filter_map(Value::as_str)
                .any(|arg| matches(&ARG_SECRET, arg))
            {
                row.problems.push(problem(
                    "warn",
                    "启动参数里好像写了明文密钥",
                    "改成通过环境变量传入",
                    None,
                ));
            }
        }
        if let Some(url) = url {
            if let Ok(url) = url::Url::parse(url) {
                let host = url.host_str().unwrap_or_default();
                let target = url
                    .port()
                    .map_or_else(|| host.to_owned(), |port| format!("{host}:{port}"));
                row.details.push(detail("地址", target));
                if !url.username().is_empty()
                    || url.password().is_some_and(|password| !password.is_empty())
                    || url.query_pairs().any(|(key, _)| matches(&SENSITIVE, &key))
                {
                    row.problems.push(problem(
                        "warn",
                        "地址里好像带着密钥",
                        "改成通过请求头传入",
                        None,
                    ));
                }
                if url.scheme() == "http"
                    && !host.starts_with("localhost")
                    && !host.starts_with("127.")
                    && !host.starts_with("::1")
                    && !host.starts_with("[::1")
                {
                    row.problems.push(problem(
                        "warn",
                        "远程地址没有加密（http）",
                        "改用 https",
                        None,
                    ));
                }
            } else {
                row.details.push(detail(
                    "地址",
                    if matches(&DYNAMIC, url) {
                        "用了变量"
                    } else {
                        "无效"
                    },
                ));
            }
        }
        for (label, map) in [("环境变量", self.environment), ("请求头", self.headers)] {
            let Some(map) = map.filter(|map| !map.is_empty()) else {
                continue;
            };
            let keys = ordered_keys(map);
            row.details.push(detail(
                label,
                keys.iter()
                    .map(|key| clean(key))
                    .collect::<Vec<_>>()
                    .join("、"),
            ));
            for key in keys {
                let Some(value) = map[key].as_str() else {
                    continue;
                };
                let reference = REFERENCE.as_ref().and_then(|regex| regex.captures(value));
                let name = reference
                    .as_ref()
                    .and_then(|captures| captures.iter().skip(1).flatten().next())
                    .map(|m| m.as_str());
                if let Some(name) = name {
                    if env
                        .names
                        .as_ref()
                        .is_some_and(|names| !names.contains(name))
                        && !name.starts_with("CLAUDE_")
                    {
                        row.problems.push(problem(
                            "warn",
                            format!("引用的环境变量 {} 在本机没有设置", clean(name)),
                            "设置这个环境变量",
                            None,
                        ));
                    }
                } else if !value.is_empty() && matches(&SENSITIVE, key) {
                    let name = clean(key);
                    row.problems.push(problem(
                        "warn",
                        format!("{label} {name} 写了明文值"),
                        format!("改成引用系统环境变量，比如 \u{24}{{{name}}}"),
                        None,
                    ));
                }
            }
        }
        for name in self.variables.iter().filter(|value| {
            env.names
                .as_ref()
                .is_some_and(|names| value.as_str().is_none_or(|name| !names.contains(name)))
        }) {
            row.problems.push(problem(
                "warn",
                format!("需要的环境变量 {} 在本机没有设置", clean(&compact(name))),
                "设置这个环境变量",
                None,
            ));
        }
        if let Some(time) = self.timeout {
            row.details.push(detail("超时", format!("{time} 秒")));
        }
    }
}

impl Scanner<'_> {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn servers(
        &mut self,
        agent: &'static str,
        place: &Place,
        file: &Path,
        map: &Value,
        checks: &[Value],
        writable: bool,
        enabled: impl Fn(&str, &Value) -> Option<bool>,
    ) {
        let Some(map) = map.as_object() else {
            return;
        };
        for (index, name) in ordered_keys(map).into_iter().take(128).enumerate() {
            let raw = &map[name];
            let mut row = Draft::new(file, "mcp", name);
            if !raw.is_object() {
                let (text, fix) = structural("ENTRY_REQUIRED");
                row.problems.push(problem("issue", text, fix, None));
                self.add(agent, place, row);
                continue;
            }
            let checked = checks.iter().find(|check| {
                check["kind"] == "mcp"
                    && check["location"]["entry"].as_u64() == Some(index as u64 + 1)
            });
            if let Some(check) = checked {
                if check["state"] == "issue" {
                    let (text, fix) = structural(field(check, "reason"));
                    row.problems.push(problem("issue", text, fix, Some("stop")));
                }
                row.unchecked = check["state"] == "unchecked";
            }
            Server::new(agent, raw).review(self.environment, &mut row);
            let times = self.seen.entry((agent, name.clone())).or_default();
            *times += 1;
            if *times > 1 {
                row.details
                    .push(detail("同名", "多个范围都配置了它，以 Agent 的优先级为准"));
            }
            row.enabled = enabled(name, raw);
            if writable {
                row.actions.push("toggle");
            }
            self.add(agent, place, row);
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn hooks(
        &mut self,
        agent: &'static str,
        place: &Place,
        file: &Path,
        map: &Value,
        checks: &[Value],
        enabled: Option<bool>,
        writable: bool,
    ) {
        let Some(map) = map.as_object() else {
            return;
        };
        let mut total = 0;
        for (event_index, event) in ordered_keys(map).into_iter().enumerate() {
            for (group_index, group) in map[event].as_array().into_iter().flatten().enumerate() {
                for (handler_index, handler) in
                    group["hooks"].as_array().into_iter().flatten().enumerate()
                {
                    total += 1;
                    if total > 128 {
                        return;
                    }
                    if !handler.is_object() {
                        continue;
                    }
                    let kind = handler["type"].as_str().unwrap_or("command");
                    let mut name = event.clone();
                    let matcher = group["matcher"].as_str().filter(|value| !value.is_empty());
                    if let Some(matcher) = matcher {
                        name.push_str(&format!(" · {matcher}"));
                    }
                    name.push_str(&format!(" · {kind}"));
                    if total > 1
                        && self.items.iter().any(|item| {
                            item.agent == agent && item.kind == "hook" && item.name == clean(&name)
                        })
                    {
                        name.push_str(&format!(" #{total}"));
                    }
                    let mut row = Draft::new(file, "hook", name);
                    let checked = checks.iter().find(|check| {
                        check["kind"] == "hooks"
                            && check["location"]["event"].as_u64() == Some(event_index as u64 + 1)
                            && check["location"]["group"].as_u64() == Some(group_index as u64 + 1)
                            && check["location"]["handler"].as_u64()
                                == Some(handler_index as u64 + 1)
                    });
                    if let Some(check) = checked {
                        if check["state"] == "issue" {
                            let (text, fix) = structural(field(check, "reason"));
                            row.problems.push(problem("issue", text, fix, None));
                        }
                        row.unchecked = check["state"] == "unchecked";
                    }
                    row.details
                        .extend([detail("事件", event), detail("类型", kind)]);
                    if let Some(matcher) = matcher {
                        row.details.push(detail("匹配", matcher));
                    }
                    let command = handler["commandWindows"]
                        .as_str()
                        .or_else(|| handler["command_windows"].as_str())
                        .or_else(|| handler["command"].as_str());
                    if let Some(command) = command.filter(|_| kind == "command") {
                        let name = basename_of(command);
                        if locate(command, self.environment) == Some(false) {
                            row.problems.push(problem(
                                "warn",
                                format!("在本机的 PATH 里找不到 {name}"),
                                "先安装它，或改成完整路径",
                                None,
                            ));
                        }
                        row.details.push(detail("命令", name));
                    }
                    if let Some(time) = handler["timeout"].as_f64() {
                        row.details.push(detail("超时", format!("{time} 秒")));
                    }
                    if writable {
                        row.actions.push("toggle-layer");
                    }
                    row.enabled = enabled;
                    self.add(agent, place, row);
                }
            }
        }
    }
}
