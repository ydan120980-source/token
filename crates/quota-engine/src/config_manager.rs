//! Explicit local configuration management. Static health checks never call the writer.
#[path = "config_manager_inventory.rs"]
mod config_inventory;
#[path = "config_manager_io.rs"]
mod config_io;

use self::config_io::{
    absent, anchor, atomic, check, checked_root, digest, move_tree, new_id, parse, read, revision,
    serialize, skill_bytes, skill_parts, utf8, Result, Tree,
};
use crate::dpapi::{protect, unprotect};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use usage_engine::{
    config_health::{guard, FILE_LIMIT},
    config_health_project::project,
    js_json::ordered_keys,
};
use zeroize::{Zeroize, Zeroizing};

const BACKUP_PURPOSE: &[u8] = b"QuotaDock/configuration-backup/v1";
const BACKUP_LIMIT: u64 = 4 * 1024 * 1024;
const STALE: &str = "CONFIG_PREVIEW_STALE";
const FORMAT: &str = "CONFIG_FORMAT_UNSUPPORTED";
const EDIT: &str = "CONFIG_EDIT_INVALID";

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum Kind {
    Mcp,
    Hooks,
    Skills,
}

impl Kind {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "mcp" => Ok(Self::Mcp),
            "hooks" => Ok(Self::Hooks),
            "skills" => Ok(Self::Skills),
            _ => Err("CONFIG_SELECTION_INVALID"),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::Hooks => "hooks",
            Self::Skills => "skills",
        }
    }
}

pub struct Selection<'a> {
    pub root: &'a Path,
    pub agent: &'a str,
    pub scope: &'a str,
    pub kind: Kind,
}

struct Snapshot {
    file: PathBuf,
    bytes: Option<Vec<u8>>,
    value: Value,
}

impl Snapshot {
    fn read(file: PathBuf) -> Result<Self> {
        let bytes = read(&file, FILE_LIMIT)?;
        let value = parse(&file, bytes.as_deref())?;
        Ok(Self { file, bytes, value })
    }

    fn check(&self) -> Result<()> {
        check(&self.file, revision(self.bytes.as_deref()).as_deref())
    }
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        if let Some(bytes) = &mut self.bytes {
            bytes.zeroize();
        }
    }
}

enum RowTarget {
    Mcp(String),
    Hook {
        event: String,
        group: usize,
        handler: usize,
    },
    Skill {
        directory: PathBuf,
        revision: String,
    },
}

struct Row {
    name: String,
    enabled: Option<bool>,
    target: RowTarget,
}

struct Context {
    id: String,
    root: PathBuf,
    agent: String,
    scope: String,
    kind: Kind,
    path: PathBuf,
    disabled: PathBuf,
    primary: Option<Snapshot>,
    control: Option<Snapshot>,
    rows: Vec<Row>,
}

fn display_name(name: &str) -> String {
    name.chars()
        .map(|ch| if ch.is_ascii_control() { ' ' } else { ch })
        .take(120)
        .collect()
}

fn control_file(agent: &str, scope: &str) -> &'static str {
    match (agent, scope) {
        ("codex", _) => ".codex/config.toml",
        (_, "project") => ".claude/settings.local.json",
        _ => ".claude/settings.json",
    }
}

fn mcp_key(agent: &str) -> &'static str {
    if agent == "codex" {
        "mcp_servers"
    } else {
        "mcpServers"
    }
}

fn projected_kind(agent: &str, kind: Kind) -> &'static str {
    match (agent, kind) {
        ("codex", Kind::Mcp) => "codex-config",
        ("codex", Kind::Hooks) => "codex-hooks",
        (_, Kind::Mcp) => "claude-mcp",
        (_, Kind::Hooks) => "claude-settings",
        (_, Kind::Skills) => "skill",
    }
}

fn map_at<'a>(value: &'a Value, key: &str) -> Result<Option<&'a Map<String, Value>>> {
    value
        .get(key)
        .map(|value| value.as_object().ok_or(FORMAT))
        .transpose()
}

impl Context {
    fn new(selection: Selection<'_>) -> Result<Self> {
        let Selection {
            root,
            agent,
            scope,
            kind,
        } = selection;
        checked_root(root)?;
        if !matches!(scope, "home" | "project")
            || !matches!(agent, "codex" | "claude" | "gemini" | "opencode")
        {
            return Err("CONFIG_SELECTION_INVALID");
        }
        if (kind != Kind::Skills && !matches!(agent, "codex" | "claude"))
            || (kind == Kind::Mcp && agent == "claude" && scope == "home")
        {
            return Err("CONFIG_MANAGEMENT_UNSUPPORTED");
        }
        let relative = match (kind, agent, scope) {
            (Kind::Mcp, "codex", _) => ".codex/config.toml",
            (Kind::Mcp, _, _) => ".mcp.json",
            (Kind::Hooks, "codex", _) => ".codex/hooks.json",
            (Kind::Hooks, _, _) => control_file(agent, scope),
            (Kind::Skills, "codex", _) => ".agents/skills",
            (Kind::Skills, "claude", _) => ".claude/skills",
            (Kind::Skills, "gemini", _) => ".gemini/skills",
            (Kind::Skills, "opencode", "home") => ".config/opencode/skills",
            (Kind::Skills, _, _) => ".opencode/skills",
        };
        Ok(Self {
            id: new_id(),
            root: root.to_owned(),
            agent: agent.to_owned(),
            scope: scope.to_owned(),
            kind,
            path: root.join(relative),
            disabled: root.join(".agent-usage/disabled-skills").join(agent),
            primary: None,
            control: None,
            rows: Vec::new(),
        })
    }

    fn matches(&self, selection: &Selection<'_>) -> bool {
        self.root == selection.root
            && self.agent == selection.agent
            && self.scope == selection.scope
            && self.kind == selection.kind
    }

    fn control(&self) -> Result<&Snapshot> {
        self.control
            .as_ref()
            .or(self.primary.as_ref())
            .ok_or(FORMAT)
    }

    fn check(&self) -> Result<()> {
        checked_root(&self.root)?;
        for snapshot in [self.primary.as_ref(), self.control.as_ref()]
            .into_iter()
            .flatten()
        {
            snapshot.check()?;
        }
        Ok(())
    }

    fn load(&mut self) -> Result<Option<bool>> {
        if self.kind == Kind::Skills {
            self.load_skills()?;
            return Ok(None);
        }
        self.primary = Some(Snapshot::read(self.path.clone())?);
        let control = self.root.join(control_file(&self.agent, &self.scope));
        if control != self.path {
            self.control = Some(Snapshot::read(control)?);
        }
        let primary = &self.primary.as_ref().ok_or(FORMAT)?.value;
        let control = &self
            .control
            .as_ref()
            .or(self.primary.as_ref())
            .ok_or(FORMAT)?
            .value;
        if self.kind == Kind::Mcp {
            let disabled = control
                .get("disabledMcpjsonServers")
                .map(|value| {
                    value
                        .as_array()
                        .filter(|rows| rows.iter().all(Value::is_string))
                        .ok_or(FORMAT)
                })
                .transpose()?;
            if let Some(map) = map_at(primary, mcp_key(&self.agent))? {
                if map.len() > 64 {
                    return Err(FORMAT);
                }
                for key in ordered_keys(map) {
                    let row = map[key].as_object().ok_or(FORMAT)?;
                    let enabled = if self.agent == "codex" {
                        row.get("enabled").and_then(Value::as_bool) != Some(false)
                    } else {
                        disabled
                            .is_none_or(|rows| rows.iter().all(|value| value.as_str() != Some(key)))
                    };
                    self.rows.push(Row {
                        name: key.clone(),
                        enabled: Some(enabled),
                        target: RowTarget::Mcp(key.clone()),
                    });
                }
            }
            return Ok(None);
        }

        if let Some(map) = map_at(primary, "hooks")? {
            for event in ordered_keys(map) {
                let groups = map[event].as_array().ok_or(FORMAT)?;
                for (group, value) in groups.iter().enumerate() {
                    let handlers = value["hooks"].as_array().ok_or(FORMAT)?;
                    for (handler, value) in handlers.iter().enumerate() {
                        if self.rows.len() >= 128 || !value.is_object() {
                            return Err("CONFIG_MANAGEMENT_LIMIT");
                        }
                        let kind = value["type"]
                            .as_str()
                            .filter(|kind| {
                                matches!(
                                    *kind,
                                    "command" | "http" | "mcp_tool" | "prompt" | "agent"
                                )
                            })
                            .unwrap_or("其他");
                        let name = format!("{event} · {kind} · {}", self.rows.len() + 1);
                        self.rows.push(Row {
                            name,
                            enabled: None,
                            target: RowTarget::Hook {
                                event: event.clone(),
                                group,
                                handler,
                            },
                        });
                    }
                }
            }
        }
        if self.agent == "codex" {
            Ok(map_at(control, "features")?
                .and_then(|value| value.get("hooks"))
                .and_then(Value::as_bool))
        } else {
            Ok(control["disableAllHooks"].as_bool().map(|value| !value))
        }
    }

    fn load_skills(&mut self) -> Result<()> {
        let alternative = self.root.join(".codex/skills");
        let mut paths = vec![(&self.path, true)];
        if self.agent == "codex" && self.scope == "home" {
            paths.push((&alternative, true));
        }
        paths.push((&self.disabled, false));
        let mut total = 0;
        for (path, enabled) in paths {
            anchor(path)?;
            let entries = match fs::read_dir(path) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err("CONFIG_FILE_REJECTED"),
            };
            let mut entries = entries
                .take(513)
                .collect::<std::io::Result<Vec<_>>>()
                .map_err(|_| "CONFIG_FILE_REJECTED")?;
            if entries.len() > 512 {
                return Err("CONFIG_MANAGEMENT_LIMIT");
            }
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let directory = entry.path();
                guard(&directory).map_err(|_| "CONFIG_PATH_REJECTED")?;
                if !entry
                    .file_type()
                    .map_err(|_| "CONFIG_FILE_REJECTED")?
                    .is_dir()
                {
                    continue;
                }
                let Some(bytes) = read(&directory.join("SKILL.md"), FILE_LIMIT)? else {
                    continue;
                };
                total += bytes.len();
                if total > 4 * 1024 * 1024 {
                    return Err("CONFIG_MANAGEMENT_LIMIT");
                }
                self.rows.push(Row {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    enabled: Some(enabled),
                    target: RowTarget::Skill {
                        directory,
                        revision: digest(&bytes),
                    },
                });
            }
        }
        Ok(())
    }
}

enum Operation {
    Write {
        file: PathBuf,
        before: Option<Vec<u8>>,
        bytes: Vec<u8>,
    },
    Move {
        source: PathBuf,
        destination: PathBuf,
        revision: String,
    },
    Import {
        source: PathBuf,
        destination: PathBuf,
        bundle: Tree,
    },
}

struct Draft {
    id: String,
    root: PathBuf,
    summary: String,
    operation: Operation,
    import_source: Option<(PathBuf, String)>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    root: PathBuf,
    at: String,
    summary: String,
    operation: SavedOperation,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum SavedOperation {
    Write {
        file: PathBuf,
        before: Option<Vec<u8>>,
        after: String,
    },
    Move {
        source: PathBuf,
        destination: PathBuf,
        revision: String,
    },
    Import {
        destination: PathBuf,
        revision: String,
    },
}

impl Drop for Backup {
    fn drop(&mut self) {
        if let SavedOperation::Write {
            before: Some(bytes),
            ..
        } = &mut self.operation
        {
            bytes.zeroize();
        }
    }
}

impl Draft {
    fn view(&self) -> Value {
        let normalization = matches!(&self.operation, Operation::Write { file, .. } if file.extension().is_some_and(|ext| ext=="toml" || ext=="json"));
        json!({"id":self.id,"summary":self.summary,"backupRequired":true,"normalization":normalization})
    }

    fn backup(&self) -> Backup {
        let operation = match &self.operation {
            Operation::Write {
                file,
                before,
                bytes,
            } => SavedOperation::Write {
                file: file.clone(),
                before: before.clone(),
                after: digest(bytes),
            },
            Operation::Move {
                source,
                destination,
                revision,
            } => SavedOperation::Move {
                source: source.clone(),
                destination: destination.clone(),
                revision: revision.clone(),
            },
            Operation::Import {
                destination,
                bundle,
                ..
            } => SavedOperation::Import {
                destination: destination.clone(),
                revision: bundle.revision.clone(),
            },
        };
        Backup {
            root: self.root.clone(),
            at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            summary: self.summary.clone(),
            operation,
        }
    }
}

impl Drop for Draft {
    fn drop(&mut self) {
        if let Operation::Write { before, bytes, .. } = &mut self.operation {
            if let Some(before) = before {
                before.zeroize();
            }
            bytes.zeroize();
        }
    }
}

#[derive(Default)]
pub struct ConfigManager {
    context: Option<Context>,
    draft: Option<Draft>,
    undo: Option<(PathBuf, String)>,
}

impl ConfigManager {
    pub fn release(&mut self) {
        self.context = None;
        self.draft = None;
    }

    pub fn release_selection(&mut self, selection: &Selection<'_>, id: Option<&str>) {
        if self
            .context
            .as_ref()
            .is_some_and(|context| context.matches(selection) && Some(context.id.as_str()) == id)
        {
            self.release();
        }
    }

    pub fn list(&mut self, selection: Selection<'_>) -> Result<Value> {
        let mut context = Context::new(selection)?;
        let enabled = context.load()?;
        let target = context
            .path
            .strip_prefix(&context.root)
            .map_err(|_| "CONFIG_PATH_REJECTED")?
            .to_string_lossy()
            .replace('\\', "/");
        let rows: Vec<_> = context
            .rows
            .iter()
            .enumerate()
            .map(|(id, row)| json!({"id":id,"name":display_name(&row.name),"enabled":row.enabled}))
            .collect();
        let undo = self
            .undo
            .as_ref()
            .is_some_and(|(root, _)| *root == context.root);
        let view = json!({"id":context.id,"kind":context.kind.name(),"target":target,"enabled":enabled,"rows":rows,"undo":undo,"normalization":context.kind!=Kind::Skills});
        self.context = Some(context);
        self.draft = None;
        Ok(view)
    }

    pub fn can_import(&self, selection: &Selection<'_>, id: Option<&str>) -> Result<()> {
        self.context
            .as_ref()
            .filter(|context| context.matches(selection) && Some(context.id.as_str()) == id)
            .ok_or(STALE)
            .map(drop)
    }

    pub fn prepare(
        &mut self,
        selection: Selection<'_>,
        request: &Value,
        imported: Option<&Path>,
    ) -> Result<Value> {
        self.can_import(&selection, request["id"].as_str())?;
        let context = self.context.as_ref().ok_or(STALE)?;
        context.check()?;
        let row = request["row"]
            .as_u64()
            .and_then(|id| usize::try_from(id).ok())
            .and_then(|id| context.rows.get(id));
        let action = request["action"].as_str();
        let (operation, summary, import_source) = if let Some(source) = imported {
            prepare_import(context, source)?
        } else if context.kind == Kind::Skills {
            let row = row.ok_or(EDIT)?;
            let (operation, summary) = prepare_skill(context, row, request)?;
            (operation, summary, None)
        } else if let Some(enabled) = request["enabled"]
            .as_bool()
            .filter(|_| action == Some("toggle"))
        {
            let (operation, summary) = prepare_toggle(context, row, enabled)?;
            (operation, summary, None)
        } else if action == Some("edit") {
            let operation = prepare_edit(context, row.ok_or(EDIT)?, &request["patch"])?;
            (
                operation,
                "修改所选配置项；未填写的字段、环境变量和请求头保留原值。".to_owned(),
                None,
            )
        } else {
            return Err(EDIT);
        };
        let draft = Draft {
            id: new_id(),
            root: context.root.clone(),
            summary,
            operation,
            import_source,
        };
        let view = draft.view();
        self.draft = Some(draft);
        Ok(view)
    }

    pub fn apply(
        &mut self,
        selection: Selection<'_>,
        id: Option<&str>,
        backup_root: &Path,
    ) -> Result<Value> {
        let context = self
            .context
            .as_ref()
            .filter(|context| context.matches(&selection))
            .ok_or(STALE)?;
        let draft = self
            .draft
            .as_mut()
            .filter(|draft| Some(draft.id.as_str()) == id && draft.root == context.root)
            .ok_or(STALE)?;
        context.check()?;
        if let Some((source, expected)) = &draft.import_source {
            check(source, Some(expected))?;
        }
        match &draft.operation {
            Operation::Write { file, before, .. } => {
                check(file, revision(before.as_deref()).as_deref())?
            }
            Operation::Move {
                source,
                destination,
                revision,
            } => {
                if Tree::read(source)?.revision != *revision {
                    return Err("CONFIG_CHANGED");
                }
                absent(destination)?;
            }
            Operation::Import {
                source,
                destination,
                bundle,
            } => {
                if Tree::read(source)?.revision != bundle.revision {
                    return Err("CONFIG_CHANGED");
                }
                absent(destination)?;
            }
        }
        let id = save_backup(backup_root, &draft.backup())?;
        match &mut draft.operation {
            Operation::Write {
                file,
                before,
                bytes,
            } => atomic(file, revision(before.as_deref()).as_deref(), bytes)?,
            Operation::Move {
                source,
                destination,
                ..
            } => move_tree(source, destination)?,
            Operation::Import {
                source,
                destination,
                bundle,
            } => {
                // Revalidate after backup. Keep the preview reusable if install fails.
                let current = Tree::read(source)?;
                if current.revision != bundle.revision {
                    return Err("CONFIG_CHANGED");
                }
                current.install(destination)?;
            }
        }
        self.undo = Some((context.root.clone(), id.clone()));
        self.release();
        Ok(json!({"applied":true,"undo":true,"record":id}))
    }

    pub fn undo(&mut self, root: &Path, backup_root: &Path) -> Result<Value> {
        let (_, id) = self
            .undo
            .as_ref()
            .filter(|(saved, _)| saved == root)
            .ok_or("CONFIG_UNDO_UNAVAILABLE")?;
        self.restore(root, backup_root, id.clone())
    }

    pub fn restore(&mut self, root: &Path, backup_root: &Path, id: String) -> Result<Value> {
        let backup = load_backup(backup_root, &id)?;
        if root != backup.root {
            return Err("CONFIG_UNDO_UNAVAILABLE");
        }
        checked_root(root)?;
        let inside = |path: &Path| {
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "CONFIG_PATH_REJECTED")?;
            if relative.as_os_str().is_empty()
                || relative
                    .components()
                    .any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                return Err("CONFIG_PATH_REJECTED");
            }
            anchor(path)
        };
        match &backup.operation {
            SavedOperation::Write {
                file,
                before,
                after,
            } => {
                inside(file)?;
                check(file, Some(after))?;
                if let Some(bytes) = before {
                    atomic(file, Some(after), bytes)?;
                } else {
                    fs::remove_file(file).map_err(|_| "CONFIG_FILE_REJECTED")?;
                }
            }
            SavedOperation::Move {
                source,
                destination,
                revision,
            } => {
                inside(source)?;
                inside(destination)?;
                if Tree::read(destination)?.revision != *revision {
                    return Err("CONFIG_CHANGED");
                }
                absent(source).map_err(|_| "CONFIG_CHANGED")?;
                move_tree(destination, source)?;
            }
            SavedOperation::Import {
                destination,
                revision,
            } => {
                inside(destination)?;
                if Tree::read(destination)?.revision != *revision {
                    return Err("CONFIG_CHANGED");
                }
                let held = root.join(".agent-usage/undone-imports").join(new_id());
                move_tree(destination, &held)?;
            }
        }
        self.undo = None;
        self.release();
        Ok(json!({"restored":true}))
    }
}

fn save_backup(directory: &Path, backup: &Backup) -> Result<String> {
    let plain =
        Zeroizing::new(serde_json::to_vec(backup).map_err(|_| "CONFIG_BACKUP_UNAVAILABLE")?);
    let sealed = protect(&plain, BACKUP_PURPOSE).map_err(|_| "CONFIG_BACKUP_UNAVAILABLE")?;
    let id = new_id();
    atomic(&directory.join(format!("{id}.bin")), None, &sealed)
        .map_err(|_| "CONFIG_BACKUP_UNAVAILABLE")?;
    Ok(id)
}

fn load_backup(directory: &Path, id: &str) -> Result<Backup> {
    if uuid::Uuid::parse_str(id).is_err() || id.len() != 36 {
        return Err("CONFIG_UNDO_UNAVAILABLE");
    }
    let bytes = read(&directory.join(format!("{id}.bin")), BACKUP_LIMIT)?
        .ok_or("CONFIG_BACKUP_UNAVAILABLE")?;
    let plain = unprotect(&bytes, BACKUP_PURPOSE).map_err(|_| "CONFIG_BACKUP_UNAVAILABLE")?;
    serde_json::from_slice(plain.as_ref()).map_err(|_| "CONFIG_BACKUP_UNAVAILABLE")
}

fn make_write(file: &Path, before: Option<&[u8]>, bytes: Vec<u8>) -> Result<Operation> {
    if bytes == before.unwrap_or_default() {
        return Err("CONFIG_NO_CHANGE");
    }
    Ok(Operation::Write {
        file: file.to_owned(),
        before: before.map(<[u8]>::to_vec),
        bytes,
    })
}

fn from_value(snapshot: &Snapshot, value: &Value) -> Result<Operation> {
    make_write(
        &snapshot.file,
        snapshot.bytes.as_deref(),
        serialize(&snapshot.file, value)?,
    )
}

fn accepted(context: &Context, text: &str) -> bool {
    let (checks, _) = project(
        &context.agent,
        projected_kind(&context.agent, context.kind),
        text,
    );
    checks.iter().all(|row| {
        row["kind"] != "file" && (row["kind"] != context.kind.name() || row["state"] != "issue")
    })
}

fn prepare_import(
    context: &Context,
    imported: &Path,
) -> Result<(Operation, String, Option<(PathBuf, String)>)> {
    let name = imported
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("CONFIG_IMPORT_REJECTED")?;
    if context.kind == Kind::Skills {
        if name.len() > 64
            || !name.starts_with(|ch: char| ch.is_ascii_alphanumeric())
            || !name
                .bytes()
                .all(|ch| ch.is_ascii_alphanumeric() || b"_-".contains(&ch))
        {
            return Err("CONFIG_IMPORT_REJECTED");
        }
        let destination = context.path.join(name);
        absent(&destination)?;
        if context.rows.iter().any(|row| row.name == name) {
            return Err("CONFIG_IMPORT_COLLISION");
        }
        let bundle = Tree::read(imported)?;
        let (value, body) = skill_parts(bundle.skill()?)?;
        skill_bytes(&context.agent, &value, body)?;
        let summary = format!(
            "导入 1 个 Skill 目录，共 {} 个文件；不会执行其中脚本。",
            bundle.files.len()
        );
        return Ok((
            Operation::Import {
                source: imported.to_owned(),
                destination,
                bundle,
            },
            summary,
            None,
        ));
    }

    if !matches!(
        name,
        ".mcp.json"
            | "mcp.json"
            | "hooks.json"
            | "settings.json"
            | "settings.local.json"
            | "config.toml"
            | "agent-config.json"
    ) {
        return Err("CONFIG_IMPORT_REJECTED");
    }
    let bytes = read(imported, FILE_LIMIT)?.ok_or("CONFIG_IMPORT_REJECTED")?;
    let value = parse(imported, Some(&bytes))?;
    let key = if context.kind == Kind::Mcp {
        mcp_key(&context.agent)
    } else {
        "hooks"
    };
    let incoming = map_at(&value, key)?
        .filter(|map| !map.is_empty() && map.len() <= 64)
        .ok_or("CONFIG_IMPORT_REJECTED")?;
    let snapshot = context.primary.as_ref().ok_or(FORMAT)?;
    let mut next = snapshot.value.clone();
    let mut entries = map_at(&next, key)?.cloned().unwrap_or_default();
    let count = incoming.len();
    for name in ordered_keys(incoming) {
        if entries.contains_key(name) {
            return Err("CONFIG_IMPORT_COLLISION");
        }
        entries.insert(name.clone(), incoming[name].clone());
    }
    next[key] = Value::Object(entries);
    let output = serialize(&snapshot.file, &next)?;
    if !accepted(context, utf8(&output)?) {
        return Err("CONFIG_IMPORT_REJECTED");
    }
    let summary = format!("合并导入 {count} 个配置键；同名键不覆盖。");
    Ok((
        make_write(&snapshot.file, snapshot.bytes.as_deref(), output)?,
        summary,
        Some((imported.to_owned(), digest(&bytes))),
    ))
}

fn prepare_skill(context: &Context, row: &Row, request: &Value) -> Result<(Operation, String)> {
    let RowTarget::Skill {
        directory,
        revision,
    } = &row.target
    else {
        return Err(EDIT);
    };
    let bundle = Tree::read(directory)?;
    let current = bundle.skill()?;
    if digest(current) != *revision {
        return Err("CONFIG_CHANGED");
    }
    if let Some(enabled) = request["enabled"]
        .as_bool()
        .filter(|enabled| request["action"] == "toggle" && row.enabled != Some(*enabled))
    {
        let destination = if enabled {
            &context.path
        } else {
            &context.disabled
        }
        .join(&row.name);
        absent(&destination)?;
        let summary = if enabled {
            "将 Skill 移回该 Agent 的技能目录。"
        } else {
            "将 Skill 移到本范围内的停用目录，原文件保留。"
        };
        return Ok((
            Operation::Move {
                source: directory.clone(),
                destination,
                revision: bundle.revision,
            },
            summary.to_owned(),
        ));
    }
    let patch = request["patch"]
        .as_object()
        .filter(|_| request["action"] == "edit")
        .ok_or(EDIT)?;
    let (mut value, body) = skill_parts(current)?;
    for (key, value_to_set) in patch {
        if !matches!(key.as_str(), "name" | "description")
            || value_to_set
                .as_str()
                .is_none_or(|value| value.encode_utf16().count() > 4096)
        {
            return Err(EDIT);
        }
        value[key] = value_to_set.clone();
    }
    let bytes = skill_bytes(&context.agent, &value, body)?;
    let operation = make_write(&directory.join("SKILL.md"), Some(current), bytes)?;
    Ok((
        operation,
        "修改 Skill 名称／描述，保留正文和其他前言字段。".to_owned(),
    ))
}

fn prepare_toggle(
    context: &Context,
    row: Option<&Row>,
    enabled: bool,
) -> Result<(Operation, String)> {
    let control = context.control()?;
    let mut next = control.value.clone();
    let subject = if context.kind == Kind::Mcp {
        let RowTarget::Mcp(name) = &row.ok_or(EDIT)?.target else {
            return Err(EDIT);
        };
        if context.agent == "codex" {
            next[mcp_key(&context.agent)][name]["enabled"] = Value::Bool(enabled);
            "此 MCP 的本文件配置；不会启动服务。"
        } else {
            let mut rows = next["disabledMcpjsonServers"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            if enabled {
                rows.retain(|value| value.as_str() != Some(name));
            } else if !rows.iter().any(|value| value.as_str() == Some(name)) {
                rows.push(json!(name));
            }
            next["disabledMcpjsonServers"] = Value::Array(rows);
            "此项目 MCP 的拒绝列表设置；恢复不自动授信，仍需客户端确认。"
        }
    } else {
        if context.agent == "codex" {
            next["features"]["hooks"] = Value::Bool(enabled);
        } else {
            next["disableAllHooks"] = Value::Bool(!enabled);
        }
        "本文件层的 hooks；其他配置层仍可能覆盖。"
    };
    Ok((
        from_value(control, &next)?,
        format!("{}{subject}", if enabled { "启用" } else { "停用" }),
    ))
}

fn patch_entry(
    entry: &mut Value,
    patch: &Map<String, Value>,
    mcp: bool,
    codex: bool,
) -> Result<()> {
    let allowed: &[&str] = if mcp {
        &["command", "args", "url", "type"]
    } else {
        &["command", "prompt", "url", "server", "tool", "timeout"]
    };
    for (key, value) in patch {
        let valid = match key.as_str() {
            "args" => value
                .as_array()
                .is_some_and(|rows| rows.iter().all(Value::is_string)),
            "timeout" => value.is_number() || value.is_string(),
            _ => value.is_string(),
        };
        if !valid || !allowed.contains(&key.as_str()) {
            return Err(EDIT);
        }
        entry[key] = value.clone();
    }
    if mcp {
        if let Some(transport) = patch
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            let value = entry.as_object_mut().ok_or(EDIT)?;
            match transport {
                "stdio" => {
                    value.shift_remove("url");
                }
                "http" => {
                    value.shift_remove("command");
                    value.shift_remove("args");
                }
                _ => return Err(EDIT),
            }
            if codex {
                value.shift_remove("type");
            }
        }
    }
    Ok(())
}

fn prepare_edit(context: &Context, row: &Row, patch: &Value) -> Result<Operation> {
    let patch = patch.as_object().ok_or(EDIT)?;
    let snapshot = context.primary.as_ref().ok_or(FORMAT)?;
    let mut next = snapshot.value.clone();
    let validation = match &row.target {
        RowTarget::Mcp(name) => {
            let key = mcp_key(&context.agent);
            let entry = &mut next[key][name];
            patch_entry(entry, patch, true, context.agent == "codex")?;
            json!({(key):{(name):entry}})
        }
        RowTarget::Hook {
            event,
            group,
            handler,
        } => {
            let group = &mut next["hooks"][event][*group];
            let entry = &mut group["hooks"][*handler];
            patch_entry(entry, patch, false, context.agent == "codex")?;
            let entry = entry.clone();
            let mut projection = group.clone();
            projection["hooks"] = json!([entry]);
            json!({"hooks":{(event):[projection]}})
        }
        RowTarget::Skill { .. } => return Err(EDIT),
    };
    if !accepted(context, utf8(&serialize(&snapshot.file, &validation)?)?) {
        return Err(EDIT);
    }
    from_value(snapshot, &next)
}
