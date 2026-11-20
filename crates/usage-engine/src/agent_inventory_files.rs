use super::*;

struct Weight {
    files: usize,
    bytes: u64,
    seen: usize,
    more: bool,
}

impl Weight {
    fn visit(&mut self, path: &Path) {
        for row in list(path) {
            self.seen += 1;
            if self.seen > WALK_LIMIT {
                self.more = true;
                return;
            }
            if row.directory {
                self.visit(&row.path);
            } else if row.file {
                self.files += 1;
                self.bytes += stat(&row.path).map_or(0, |stat| stat.len());
            }
        }
    }

    fn display(path: &Path) -> String {
        let mut weight = Self {
            files: 0,
            bytes: 0,
            seen: 0,
            more: false,
        };
        weight.visit(path);
        format!(
            "{}{} 个 · {}",
            weight.files,
            if weight.more { "+" } else { "" },
            size(weight.bytes)
        )
    }
}

fn find_nested(path: &Path, depth: usize, seen: &mut usize, hits: &mut Vec<PathBuf>) {
    if depth > 6 {
        return;
    }
    for row in list(path) {
        *seen += 1;
        if *seen > WALK_LIMIT {
            return;
        }
        if !row.directory || row.name.starts_with('.') || row.name == "node_modules" {
            continue;
        }
        if stat(&row.path.join("SKILL.md")).is_some_and(|stat| stat.is_file()) {
            hits.push(row.path);
        } else {
            find_nested(&row.path, depth + 1, seen, hits);
        }
    }
}

fn tool_count(tools: &Value) -> Option<usize> {
    if let Some(items) = tools.as_array() {
        return Some(items.len());
    }
    let text = tools.as_str()?;
    let mut total = 0;
    for raw in text.split(',') {
        let mut depth = 0usize;
        let mut token = false;
        for ch in raw.chars() {
            if ch.is_whitespace() && depth == 0 {
                if token {
                    total += 1;
                    token = false;
                }
            } else {
                if ch == '(' {
                    depth += 1;
                }
                if ch == ')' {
                    depth = depth.saturating_sub(1);
                }
                token = true;
            }
        }
        if token {
            total += 1;
        }
    }
    Some(total)
}

impl Scanner<'_> {
    fn skill(
        &mut self,
        spec: &Spec,
        directory: &Path,
        enabled: bool,
        direct: bool,
    ) -> Option<Draft> {
        let file = directory.join("SKILL.md");
        let name = basename(directory);
        let mut row = Draft::new(&file, "skill", &name);
        row.enabled = Some(enabled);
        match self.read(&file) {
            Ok(None) => None,
            Err(error) => {
                row.problems.push(file_problem(spec.label, error));
                Some(row)
            }
            Ok(Some(text)) => {
                let head = skill_front::read(&text);
                let value = |key: &str| {
                    head.fields
                        .get(key)
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim()
                };
                let label = spec.label;
                let required = spec.id != "claude";
                if !head.present {
                    row.problems.push(if required {
                        problem(
                            "issue",
                            format!("SKILL.md 开头没有前言（---），{label} 不会加载它"),
                            "在开头加上 name 和 description",
                            Some("stop"),
                        )
                    } else {
                        problem(
                            "note",
                            format!("SKILL.md 开头没有前言，{label} 用目录名和正文第一行代替"),
                            "想控制何时使用，就在开头写上 description",
                            None,
                        )
                    });
                } else if !head.closed {
                    row.problems.push(problem(
                        if required { "issue" } else { "note" },
                        "SKILL.md 的前言没有用 --- 结束",
                        "在前言末尾补上一行 ---",
                        None,
                    ));
                } else {
                    let missing = ["name", "description"]
                        .into_iter()
                        .filter(|key| value(key).is_empty())
                        .collect::<Vec<_>>();
                    if required && !missing.is_empty() {
                        row.problems.push(problem(
                            "issue",
                            format!("SKILL.md 缺少 {}，{label} 不会加载它", missing.join(" 和 ")),
                            "在前言里补上",
                            Some("stop"),
                        ));
                    } else if !required && value("description").is_empty() {
                        row.problems.push(problem(
                            "note",
                            format!("没有 description，{label} 用正文第一行判断什么时候用它"),
                            "在前言里写上 description",
                            None,
                        ));
                    }
                    if head.odd {
                        row.problems.push(problem(
                            "note",
                            format!("前言里有一行看不懂，没法确认 {label} 怎么读它"),
                            "检查前言的写法",
                            None,
                        ));
                    }
                    if let Some(hazard) = head.hazard.filter(|_| spec.id != "gemini") {
                        let text = if hazard == "colon" {
                            "前言的值里有没加引号的冒号，严格的 YAML 读取会失败"
                        } else {
                            "前言的值以特殊符号开头，严格的 YAML 读取会失败"
                        };
                        row.problems
                            .push(problem("note", text, "给这个值加上引号最稳", None));
                    }
                    if spec.id == "opencode" && !value("name").is_empty() && value("name") != name {
                        row.problems.push(problem(
                            "warn",
                            "name 和目录名不一样，OpenCode 要求两者相同",
                            "改成一样的名字",
                            None,
                        ));
                    }
                }
                if !value("name").is_empty() {
                    row.name = value("name").to_owned();
                }
                row.key = Some(name.clone());
                row.directory = Some(directory.to_owned());
                if direct {
                    row.actions.push("toggle");
                }
                if !value("description").is_empty() {
                    row.details.push(detail("描述", value("description")));
                }
                row.details.push(detail("文件", Weight::display(directory)));
                if let Some(tools) = head.fields.get("allowed-tools").and_then(tool_count) {
                    row.details
                        .push(detail("允许的工具", format!("{tools} 个")));
                }
                if !value("model").is_empty() {
                    row.details.push(detail("模型", value("model")));
                }
                if row.name != name {
                    row.details.push(detail("目录名", name));
                }
                Some(row)
            }
        }
    }

    pub(super) fn skills(&mut self, spec: &Spec, place: &Place, paths: &[&str]) {
        let disabled = place
            .root
            .join(".agent-usage/disabled-skills")
            .join(spec.id);
        let directories = paths
            .iter()
            .map(|relative| (place.root.join(relative), true))
            .chain([(disabled, false)]);
        let mut found = Vec::new();
        for (directory, enabled) in directories {
            for entry in list(&directory) {
                if (self.stop)() {
                    return;
                }
                if entry.link {
                    let mut row = Draft::new(&entry.path, "skill", &entry.name);
                    row.enabled = Some(enabled);
                    row.unchecked = true;
                    row.details
                        .push(detail("位置", "这是一个链接，没有跟随读取"));
                    self.add(spec.id, place, row);
                    continue;
                }
                if !entry.directory {
                    continue;
                }
                if stat(&entry.path.join("SKILL.md")).is_some() {
                    if let Some(row) = self.skill(spec, &entry.path, enabled, true) {
                        if row.directory.is_some() {
                            found.push(row);
                        } else {
                            self.add(spec.id, place, row);
                        }
                    }
                    continue;
                }
                if !enabled || entry.name.starts_with('.') {
                    continue;
                }
                let mut nested = Vec::new();
                find_nested(&entry.path, 2, &mut 0, &mut nested);
                if !nested.is_empty() && spec.depth == Some(true) {
                    for path in nested {
                        if let Some(row) = self.skill(spec, &path, true, false) {
                            found.push(row);
                        }
                    }
                    continue;
                }
                let mut row = Draft::new(&entry.path, "skill", entry.name);
                row.enabled = Some(enabled);
                let count = nested.len();
                if count == 0 {
                    row.problems.push(problem(
                        "warn",
                        "目录里没有 SKILL.md，Agent 会跳过它",
                        "不需要就自己删掉这个目录；要用就补上 SKILL.md",
                        None,
                    ));
                } else {
                    let label = spec.label;
                    row.problems.push(if spec.depth==Some(false) {
                        problem("warn",format!("里面的 {count} 个 Skill 放得太深，{label} 只找 skills/名字/SKILL.md，不会读到"),"把它们移到 skills 目录的第一层",None)
                    } else {
                        problem("note",format!("里面的 {count} 个 Skill 放在更深的目录，文档只写了 skills/名字/SKILL.md，没法确认会不会读到"),"把它们移到 skills 目录的第一层最稳",None)
                    });
                    let names = nested
                        .iter()
                        .take(12)
                        .map(|path| basename(path))
                        .collect::<Vec<_>>()
                        .join("、");
                    row.details.push(detail("里面的 Skill", names));
                }
                self.add(spec.id, place, row);
            }
        }
        let mut groups = HashMap::<String, Vec<usize>>::new();
        for (at, row) in found
            .iter()
            .enumerate()
            .filter(|(_, row)| row.enabled == Some(true))
        {
            groups.entry(row.name.clone()).or_default().push(at);
        }
        let first = paths.first().map(|path| disk_path(&place.root.join(path)));
        for group in groups.values().filter(|group| group.len() > 1) {
            let rank = |at: usize| {
                let row = &found[at];
                let primary = first
                    .as_ref()
                    .is_some_and(|first| row.file.starts_with(first));
                (primary, row.updated.unwrap_or_default())
            };
            let Some(keep) = group
                .iter()
                .copied()
                .max_by_key(|at| (rank(*at), std::cmp::Reverse(*at)))
            else {
                continue;
            };
            let Some(other) = group.iter().copied().find(|at| *at != keep) else {
                continue;
            };
            for &at in group {
                let target = &found[if at == keep { other } else { keep }];
                let shown = target
                    .directory
                    .as_ref()
                    .map_or_else(String::new, |path| place.show(path));
                let row = &mut found[at];
                row.problems.push(if at == keep {
                    problem(
                        "warn",
                        format!("有同名的 Skill（{shown}），{}", spec.duplicate),
                        "",
                        None,
                    )
                } else {
                    problem(
                        "warn",
                        format!("和 {shown} 同名，{}", spec.duplicate),
                        "停用这一个，或改掉其中一个的名字",
                        Some("stop"),
                    )
                });
            }
        }
        for row in found {
            self.add(spec.id, place, row);
        }
    }
}

fn names(map: Option<&Map<String, Value>>, fallback: &str) -> String {
    let Some(map) = map.filter(|map| !map.is_empty()) else {
        return fallback.to_owned();
    };
    ordered_keys(map)
        .into_iter()
        .take(12)
        .map(|name| clean(name))
        .collect::<Vec<_>>()
        .join("、")
}

impl Scanner<'_> {
    fn plugin_contents(&mut self, directory: &Path) -> Vec<Detail> {
        let mut details = Vec::new();
        let skills: Vec<_> = list(&directory.join("skills"))
            .into_iter()
            .filter(|entry| entry.directory)
            .map(|entry| entry.name)
            .collect();
        if !skills.is_empty() {
            details.push(detail(
                "Skills",
                format!(
                    "{} 个：{}",
                    skills.len(),
                    skills
                        .iter()
                        .take(12)
                        .map(String::as_str)
                        .collect::<Vec<_>>()
                        .join("、")
                ),
            ));
        }
        for (name, label) in [("commands", "命令"), ("agents", "子 Agent")] {
            let count = list(&directory.join(name))
                .iter()
                .filter(|entry| entry.file || entry.directory)
                .count();
            if count > 0 {
                details.push(detail(label, format!("{count} 个")));
            }
        }
        if stat(&directory.join("hooks/hooks.json")).is_some_and(|stat| stat.is_file()) {
            details.push(detail("Hooks", "有"));
        }
        if let Ok(Some(mcp)) = self.parse(&directory.join(".mcp.json"), Format::JsonManifest) {
            let map = mcp.value["mcpServers"]
                .as_object()
                .or_else(|| mcp.value.as_object());
            details.push(detail("MCP", names(map, "无")));
        }
        details
    }

    fn plugin_details(&mut self, meta: &Value, directory: &Path) -> Vec<Detail> {
        let mut rows = Vec::new();
        for (value, label) in [
            (&meta["description"], "描述"),
            (&meta["version"], "版本"),
            (&meta["author"]["name"], "作者"),
        ] {
            if let Some(value) = value.as_str() {
                rows.push(detail(label, value));
            }
        }
        rows.extend(self.plugin_contents(directory));
        rows
    }

    pub(super) fn claude_plugins(&mut self, place: &Place, enabled: &Value) {
        let root = disk_path(&place.root.join(".claude/plugins"));
        let file = root.join("installed_plugins.json");
        let Some(installed) =
            self.inspect("claude", "Claude Code", place, &file, Format::JsonManifest)
        else {
            return;
        };
        let Some(records) = installed.value["plugins"].as_object() else {
            return;
        };
        for id in ordered_keys(records).into_iter().take(128) {
            let value = &records[id];
            let record = value
                .as_array()
                .and_then(|rows| rows.iter().find(|value| value.is_object()))
                .or_else(|| value.is_object().then_some(value));
            let Some(record) = record else {
                continue;
            };
            let directory = record["installPath"]
                .as_str()
                .filter(|path| Path::new(path).is_absolute())
                .map(|path| disk_path(Path::new(path)));
            let mut row = Draft::new(&file, "plugin", id);
            let present = directory
                .as_ref()
                .filter(|path| path.starts_with(&root) && *path != &root)
                .filter(|path| stat(path).is_some_and(|stat| stat.is_dir()));
            if directory
                .as_ref()
                .is_some_and(|path| !path.starts_with(&root) || *path == root)
            {
                row.problems.push(problem(
                    "warn",
                    "插件放在插件目录之外，没有读取它的内容",
                    "",
                    None,
                ));
            } else if present.is_none() {
                row.problems.push(problem(
                    "issue",
                    "插件文件不见了，这个插件用不了",
                    "在 Claude Code 里运行 /plugin 重新安装；不想要就停用",
                    Some("stop"),
                ));
            }
            let mut meta = Value::Null;
            if let Some(directory) = present {
                match self.parse(
                    &directory.join(".claude-plugin/plugin.json"),
                    Format::JsonManifest,
                ) {
                    Ok(Some(result)) => {
                        meta = result.value;
                        row.details = self.plugin_details(&meta, directory);
                    }
                    Err(_) => row.problems.push(problem(
                        "issue",
                        "plugin.json 解析不了，插件可能加载失败",
                        "更新或重新安装这个插件",
                        Some("stop-optional"),
                    )),
                    _ => {}
                }
            }
            row.enabled = Some(
                enabled[id]
                    .as_bool()
                    .unwrap_or(meta["defaultEnabled"] != false),
            );
            row.updated = record["lastUpdated"]
                .as_str()
                .or_else(|| record["installedAt"].as_str())
                .and_then(parse_iso)
                .filter(|stamp| *stamp != 0);
            if let Some(version) = record["version"]
                .as_str()
                .filter(|_| !meta["version"].is_string())
            {
                row.details.push(detail("版本", version));
            }
            row.details
                .push(detail("范围", record["scope"].as_str().unwrap_or("user")));
            row.actions.push("toggle-plugin");
            self.add("claude", place, row);
        }
    }

    pub(super) fn codex_plugins(&mut self, place: &Place, enabled: &Value) {
        let cache = place.root.join(".codex/plugins/cache");
        for market in list(&cache).into_iter().filter(|entry| entry.directory) {
            for plugin in list(&market.path)
                .into_iter()
                .filter(|entry| entry.directory)
            {
                if (self.stop)() || self.items.len() >= ITEM_LIMIT {
                    return;
                }
                let mut versions: Vec<_> = list(&plugin.path)
                    .into_iter()
                    .filter(|entry| entry.directory)
                    .map(|entry| (metadata_time(&entry.path), entry))
                    .collect();
                versions.sort_by_key(|(time, _)| std::cmp::Reverse(*time));
                let Some((_, version)) = versions.first() else {
                    continue;
                };
                let directory = &version.path;
                let id = format!("{}@{}", plugin.name, market.name);
                let mut row = Draft::new(directory, "plugin", &id);
                let primary = self.parse(&directory.join("plugin.json"), Format::JsonManifest);
                let secondary = self.parse(
                    &directory.join(".codex-plugin/plugin.json"),
                    Format::JsonManifest,
                );
                let meta = match if matches!(&primary, Ok(None)) {
                    secondary
                } else {
                    primary
                } {
                    Ok(Some(doc)) => {
                        row.details = self.plugin_details(&doc.value, directory);
                        doc.value
                    }
                    Err(_) => {
                        row.problems.push(problem(
                            "issue",
                            "plugin.json 解析不了，插件可能加载失败",
                            "更新或重新安装这个插件",
                            Some("stop-optional"),
                        ));
                        Value::Null
                    }
                    Ok(None) => Value::Null,
                };
                if !meta["version"].is_string() {
                    row.details.push(detail("版本", &version.name));
                }
                if versions.len() > 1 {
                    row.details.push(detail(
                        "旧版本",
                        format!("{} 个还在缓存里", versions.len() - 1),
                    ));
                }
                row.enabled = enabled[&id]["enabled"].as_bool();
                row.actions.push("toggle-plugin");
                self.add("codex", place, row);
            }
        }
    }

    pub(super) fn gemini_extensions(&mut self, place: &Place) {
        for entry in list(&place.root.join(".gemini/extensions")) {
            let mut row = Draft::new(&entry.path, "plugin", entry.name);
            if entry.link {
                row.unchecked = true;
                row.updated = None;
                row.details
                    .push(detail("位置", "这是一个链接，没有跟随读取"));
            } else if entry.directory {
                match self.parse(
                    &entry.path.join("gemini-extension.json"),
                    Format::JsonManifest,
                ) {
                    Ok(Some(doc)) => {
                        let meta = doc.value;
                        if let Some(name) = meta["name"].as_str() {
                            row.name = name.to_owned();
                        }
                        if let Some(version) = meta["version"].as_str() {
                            row.details.push(detail("版本", version));
                        }
                        if let Some(mcp) = meta["mcpServers"].as_object() {
                            row.details.push(detail("MCP", names(Some(mcp), "")));
                        }
                        if let Some(tools) = meta["excludeTools"].as_array() {
                            row.details
                                .push(detail("隐藏的工具", format!("{} 个", tools.len())));
                        }
                    }
                    Ok(None) => row.problems.push(problem(
                        "issue",
                        "没有 gemini-extension.json，不会被当作扩展",
                        "重新安装这个扩展",
                        None,
                    )),
                    Err(_) => row.problems.push(problem(
                        "issue",
                        "gemini-extension.json 解析不了",
                        "更新或重新安装这个扩展",
                        None,
                    )),
                }
                row.details.extend(self.plugin_contents(&entry.path));
            } else {
                continue;
            }
            self.add("gemini", place, row);
        }
    }
}
