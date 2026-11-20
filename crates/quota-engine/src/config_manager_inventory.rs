use super::*;
use usage_engine::agent_inventory::Item;

const UNSUPPORTED: &str = "INVENTORY_ACTION_UNSUPPORTED";

fn owned_file(root: &Path, file: &Path) -> Result<()> {
    checked_root(root)?;
    let path = file
        .strip_prefix(root)
        .map_err(|_| "CONFIG_PATH_REJECTED")?;
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("CONFIG_PATH_REJECTED");
    }
    anchor(file)
}

fn selection(item: &Item, kind: Kind) -> Selection<'_> {
    Selection {
        root: &item.locator.root,
        agent: item.agent,
        scope: item.locator.scope,
        kind,
    }
}

impl ConfigManager {
    pub fn read_instruction(item: &Item) -> Result<Value> {
        if item.kind != "instruction" || !item.actions.contains(&"read") {
            return Err(UNSUPPORTED);
        }
        let locator = &item.locator;
        owned_file(&locator.root, &locator.file)?;
        let bytes = Zeroizing::new(read(&locator.file, FILE_LIMIT)?.ok_or("CONFIG_CHANGED")?);
        Ok(json!({"text":utf8(&bytes)?,"revision":digest(&bytes)}))
    }

    pub fn preview_item(&mut self, target: &Item, request: &Value) -> Result<Value> {
        match request["action"].as_str() {
            Some("toggle") => self.toggle_item(target, request["enabled"].as_bool().ok_or(EDIT)?),
            Some("copy") => self.copy_server(target, request["to"].as_str().ok_or(UNSUPPORTED)?),
            Some("text") => self.write_instruction(
                target,
                request["revision"].as_str().ok_or(EDIT)?,
                request["text"].as_str().ok_or(EDIT)?,
            ),
            _ => Err(UNSUPPORTED),
        }
    }

    fn toggle_item(&mut self, item: &Item, enabled: bool) -> Result<Value> {
        if item.actions.contains(&"toggle-plugin") {
            let locator = &item.locator;
            let context = Context::new(selection(item, Kind::Skills))?;
            if !matches!(item.agent, "codex" | "claude") || !locator.key.contains('@') {
                return Err("CONFIG_MANAGEMENT_UNSUPPORTED");
            }
            let file = locator.root.join(if item.agent == "codex" {
                ".codex/config.toml"
            } else {
                ".claude/settings.json"
            });
            let snapshot = Snapshot::read(file)?;
            let mut next = snapshot.value.clone();
            let key = if item.agent == "codex" {
                "plugins"
            } else {
                "enabledPlugins"
            };
            map_at(&next, key)?;
            if item.agent == "codex" {
                if next[key][&locator.key].is_null() {
                    next[key][&locator.key] = json!({});
                }
                let entry = next[key][&locator.key].as_object_mut().ok_or(FORMAT)?;
                entry.insert("enabled".to_owned(), json!(enabled));
            } else {
                next[key][&locator.key] = json!(enabled);
            }
            let operation = from_value(&snapshot, &next)?;
            let verb = if enabled { "启用" } else { "停用" };
            return self.preview_with_context(
                context,
                operation,
                format!(
                    "{verb}插件 {}；插件文件不变，重启 Agent 后生效。",
                    locator.key
                ),
                None,
            );
        }
        let kind = match item.kind {
            "skill" if item.actions.contains(&"toggle") => Kind::Skills,
            "hook" if item.actions.contains(&"toggle-layer") => Kind::Hooks,
            "mcp" if item.actions.contains(&"toggle") => Kind::Mcp,
            _ => return Err(UNSUPPORTED),
        };
        let view = self.list(selection(item, kind))?;
        let context = self.context.as_ref().ok_or(STALE)?;
        let row=match kind {
            Kind::Mcp=>Some(context.rows.iter().position(|row|matches!(&row.target,RowTarget::Mcp(name) if name==&item.locator.key)).ok_or("CONFIG_MANAGEMENT_UNSUPPORTED")?),
            Kind::Skills=>Some(context.rows.iter().position(|row|matches!(&row.target,RowTarget::Skill {directory,..} if item.locator.directory.as_ref()==Some(directory))).ok_or("CONFIG_MANAGEMENT_UNSUPPORTED")?),
            Kind::Hooks=>None,
        };
        self.prepare(
            selection(item, kind),
            &json!({"id":view["id"],"action":"toggle","row":row,"enabled":enabled}),
            None,
        )
    }

    fn copy_server(&mut self, item: &Item, agent: &str) -> Result<Value> {
        if item.kind != "mcp" || !matches!(agent, "codex" | "claude") {
            return Err(UNSUPPORTED);
        }
        let locator = &item.locator;
        let name = locator.key.as_str();
        if name.len() > 64
            || !name.starts_with(|ch: char| ch.is_ascii_alphanumeric())
            || !name
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || b"_.-".contains(&ch))
        {
            return Err(EDIT);
        }
        owned_file(&locator.root, &locator.file)?;
        let bytes = Zeroizing::new(read(&locator.file, FILE_LIMIT)?.ok_or("CONFIG_CHANGED")?);
        let parsed = if matches!(item.agent, "opencode" | "gemini") {
            let source = utf8(&bytes)?;
            let cleaned = source
                .lines()
                .filter(|line| !line.trim_start().starts_with("//"))
                .collect::<Vec<_>>()
                .join("\n");
            usage_engine::config_health_syntax::json(&cleaned).map_err(|_| FORMAT)?
        } else {
            parse(&locator.file, Some(&bytes))?
        };
        let map = parsed
            .get("mcp_servers")
            .or_else(|| parsed.get("mcpServers"))
            .or_else(|| parsed.get("mcp"))
            .ok_or("CONFIG_CHANGED")?;
        let raw = map
            .get(name)
            .and_then(Value::as_object)
            .ok_or("CONFIG_CHANGED")?;
        if [
            "headers",
            "http_headers",
            "headersHelper",
            "http_headers_helper",
            "bearer_token_env_var",
        ]
        .iter()
        .any(|key| raw.get(*key).is_some_and(|value| !value.is_null()))
        {
            return Err(FORMAT);
        }
        let mut entry = Map::new();
        if let Some(args) = raw.get("command").and_then(Value::as_array) {
            let command = args.first().filter(|value| value.is_string()).ok_or(EDIT)?;
            entry.insert("command".to_owned(), command.clone());
            entry.insert("args".to_owned(), json!(args.get(1..).unwrap_or_default()));
            if let Some(env) = raw.get("environment") {
                entry.insert("env".to_owned(), env.clone());
            }
        } else {
            for (key, valid) in [
                ("command", Value::is_string as fn(&Value) -> bool),
                ("args", Value::is_array),
                ("env", Value::is_object),
                ("url", Value::is_string),
            ] {
                if let Some(value) = raw.get(key).filter(|value| valid(value)) {
                    entry.insert(key.to_owned(), value.clone());
                }
            }
        }
        if agent == "claude" {
            entry.insert(
                "type".to_owned(),
                json!(if entry.contains_key("url") {
                    "http"
                } else {
                    "stdio"
                }),
            );
        }
        let mut context = Context::new(Selection {
            root: &locator.root,
            agent,
            scope: locator.scope,
            kind: Kind::Mcp,
        })?;
        context.load()?;
        if context
            .rows
            .iter()
            .any(|row| matches!(&row.target,RowTarget::Mcp(key) if key==name))
        {
            return Err("CONFIG_IMPORT_COLLISION");
        }
        let snapshot = context.primary.as_ref().ok_or(FORMAT)?;
        let env_count = entry
            .get("env")
            .and_then(Value::as_object)
            .map_or(0, Map::len);
        let key = mcp_key(agent);
        let validation = json!({(key):{(name):entry}});
        if !accepted(&context, utf8(&serialize(&snapshot.file, &validation)?)?) {
            return Err(EDIT);
        }
        let mut next = snapshot.value.clone();
        next[key][name] = Value::Object(entry);
        let operation = from_value(snapshot, &next)?;
        let label = if agent == "codex" {
            "Codex"
        } else {
            "Claude Code"
        };
        let env = if env_count == 0 {
            String::new()
        } else {
            format!("，连同 {env_count} 个环境变量")
        };
        self.preview_with_context(
            context,
            operation,
            format!("把 MCP {name} 加到 {label}{env}；已有的配置不变，也不会启动它。"),
            Some((locator.file.clone(), digest(&bytes))),
        )
    }

    fn write_instruction(&mut self, item: &Item, expected: &str, text: &str) -> Result<Value> {
        if item.kind != "instruction" || !item.actions.contains(&"edit") {
            return Err(EDIT);
        }
        let locator = &item.locator;
        owned_file(&locator.root, &locator.file)?;
        let bytes = Zeroizing::new(read(&locator.file, FILE_LIMIT)?.ok_or("CONFIG_CHANGED")?);
        if digest(&bytes) != expected {
            return Err("CONFIG_CHANGED");
        }
        if text.len() as u64 > FILE_LIMIT {
            return Err("CONFIG_FILE_REJECTED");
        }
        let context = Context::new(selection(item, Kind::Skills))?;
        let operation = make_write(&locator.file, Some(&bytes), text.as_bytes().to_vec())?;
        let name = locator
            .file
            .file_name()
            .and_then(|file| file.to_str())
            .ok_or("CONFIG_PATH_REJECTED")?;
        self.preview_with_context(
            context,
            operation,
            format!("修改指令文件 {name}；写入前加密备份，可以恢复。"),
            None,
        )
    }

    fn preview_with_context(
        &mut self,
        context: Context,
        operation: Operation,
        summary: String,
        import_source: Option<(PathBuf, String)>,
    ) -> Result<Value> {
        let draft = Draft {
            id: new_id(),
            root: context.root.clone(),
            summary,
            operation,
            import_source,
        };
        let view = draft.view();
        self.context = Some(context);
        self.draft = Some(draft);
        Ok(view)
    }

    pub fn apply_item(&mut self, id: &str, backups: &Path) -> Result<(PathBuf, Value)> {
        let context = self.context.as_ref().ok_or(STALE)?;
        let (root, agent, scope, kind) = (
            context.root.clone(),
            context.agent.clone(),
            context.scope.clone(),
            context.kind,
        );
        let result = self.apply(
            Selection {
                root: &root,
                agent: &agent,
                scope: &scope,
                kind,
            },
            Some(id),
            backups,
        )?;
        Ok((root, result))
    }

    pub fn restore_record(&mut self, backups: &Path, id: &str) -> Result<(PathBuf, Value)> {
        let backup = load_backup(backups, id)?;
        let root = backup.root.clone();
        let result = self.restore(&root, backups, id.to_owned())?;
        Ok((root, result))
    }

    pub fn history(backups: &Path) -> Vec<Value> {
        if guard(backups).is_err() {
            return Vec::new();
        }
        let Ok(entries) = fs::read_dir(backups) else {
            return Vec::new();
        };
        let mut records: Vec<_> = entries
            .take(2048)
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let path = entry.path();
                let id = path.file_stem()?.to_str()?;
                if path.extension()? != "bin"
                    || id.len() != 36
                    || uuid::Uuid::parse_str(id).is_err()
                {
                    return None;
                }
                let modified = entry.metadata().ok()?.modified().ok()?;
                Some((modified, id.to_owned()))
            })
            .collect();
        records.sort_by(|a, b| b.0.cmp(&a.0));
        records.into_iter().take(40).filter_map(|(_,id)| {
            let backup=load_backup(backups,&id).ok()?;
            let (files,restorable)=match &backup.operation {
                SavedOperation::Write {file,after,..}=>(
                    vec![file.file_name()?.to_str()?],
                    owned_file(&backup.root,file).is_ok()&&check(file,Some(after)).is_ok()
                ),
                SavedOperation::Move {source,destination,..}=>(Vec::new(),!source.exists()&&destination.exists()),
                SavedOperation::Import {destination,..}=>(Vec::new(),destination.exists()),
            };
            Some(json!({"id":id,"at":backup.at,"summary":backup.summary,"files":files,"restorable":restorable}))
        }).collect()
    }
}
