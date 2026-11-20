use crate::{
    config_health::{guard, management_read, FILE_LIMIT},
    config_health_project::project,
    config_health_syntax as syntax,
    js_json::{ordered_keys, stringify},
    pathx,
    policy::mtime_ms,
    skill_front,
    time::{iso_from_ms, parse_iso},
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::LazyLock,
};

#[path = "agent_inventory_files.rs"]
mod files;
#[path = "agent_inventory_mcp.rs"]
mod mcp;

const TOTAL_LIMIT: u64 = 16 * 1024 * 1024;
const ITEM_LIMIT: usize = 1000;
const ENTRY_LIMIT: usize = 256;
const WALK_LIMIT: usize = 512;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Environment {
    pub path: String,
    pub path_ext: String,
    pub names: Option<HashSet<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub level: &'static str,
    pub text: String,
    pub fix: String,
    pub remedy: &'static str,
}
fn problem(
    level: &'static str,
    text: impl Into<String>,
    fix: impl Into<String>,
    remedy: Option<&'static str>,
) -> Problem {
    let fix = fix.into();
    Problem {
        level,
        text: text.into(),
        remedy: remedy.unwrap_or(if fix.is_empty() { "none" } else { "manual" }),
        fix,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub label: &'static str,
    pub value: String,
}
fn detail(label: &'static str, value: impl AsRef<str>) -> Detail {
    Detail {
        label,
        value: clean(value.as_ref()),
    }
}

#[derive(Clone)]
pub struct Locator {
    pub root: PathBuf,
    pub scope: &'static str,
    pub file: PathBuf,
    pub key: String,
    pub directory: Option<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub agent: &'static str,
    pub kind: &'static str,
    pub name: String,
    pub scope: &'static str,
    pub project: Option<String>,
    pub file: String,
    pub openable: bool,
    pub enabled: Option<bool>,
    pub health: &'static str,
    pub problems: Vec<Problem>,
    pub details: Vec<Detail>,
    pub updated_at: Option<String>,
    pub actions: Vec<&'static str>,
    #[serde(skip)]
    pub locator: Locator,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: &'static str,
    pub name: &'static str,
    pub found: bool,
    pub writable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub agent: &'static str,
    pub text: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    pub schema_version: &'static str,
    pub agents: Vec<Agent>,
    pub items: Vec<Item>,
    pub notes: Vec<Note>,
    pub truncated: bool,
    pub bytes_read: u64,
}

struct Place {
    root: PathBuf,
    label: Option<String>,
}
impl Place {
    fn scope(&self) -> &'static str {
        if self.label.is_some() {
            "project"
        } else {
            "user"
        }
    }

    fn show(&self, file: &Path) -> String {
        let relative = pathx::relative(&self.root.to_string_lossy(), &file.to_string_lossy())
            .replace('\\', "/");
        format!("{}/{relative}", self.label.as_deref().unwrap_or("~"))
    }
}
fn disk_path(path: &Path) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(pathx::normalize(&path.to_string_lossy()))
    } else {
        path.to_owned()
    }
}

struct Draft {
    file: PathBuf,
    kind: &'static str,
    name: String,
    enabled: Option<bool>,
    unchecked: bool,
    problems: Vec<Problem>,
    details: Vec<Detail>,
    updated: Option<i64>,
    actions: Vec<&'static str>,
    directory: Option<PathBuf>,
    key: Option<String>,
}
impl Draft {
    fn new(file: &Path, kind: &'static str, name: impl Into<String>) -> Self {
        Self {
            file: disk_path(file),
            kind,
            name: name.into(),
            enabled: None,
            unchecked: false,
            problems: Vec::new(),
            details: Vec::new(),
            updated: metadata_time(file),
            actions: Vec::new(),
            directory: None,
            key: None,
        }
    }
}

fn clean(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_control() { ' ' } else { ch })
        .take(160)
        .collect()
}
fn basename(path: &Path) -> String {
    path.file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
}
fn stat(path: &Path) -> Option<fs::Metadata> {
    guard(path).ok()?;
    fs::symlink_metadata(path).ok()
}
fn metadata_time(path: &Path) -> Option<i64> {
    fs::symlink_metadata(path)
        .ok()
        .map(|meta| mtime_ms(&meta))
        .filter(|time| time.is_finite())
        .map(|time| time as i64)
}
pub fn openable(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "json" | "toml" | "yaml" | "yml" | "txt"
            )
        })
}
pub fn sensitive_name(path: &Path) -> bool {
    let name = basename(path).to_ascii_lowercase();
    name == ".claude.json"
        || [
            "auth",
            "credential",
            "credentials",
            "token",
            "tokens",
            "secret",
            "secrets",
            "env",
        ]
        .iter()
        .any(|prefix| {
            name.trim_start_matches('.')
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with(['.', '_', '-']))
        })
}
fn size(bytes: u64) -> String {
    if bytes >= 1_048_576 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else if bytes >= 1024 {
        format!("{} KB", bytes.saturating_add(512) / 1024)
    } else {
        format!("{bytes} B")
    }
}

struct DirectoryEntry {
    path: PathBuf,
    name: String,
    link: bool,
    directory: bool,
    file: bool,
}
fn list(directory: &Path) -> Vec<DirectoryEntry> {
    if guard(directory).is_err() {
        return Vec::new();
    }
    let Ok(dir) = fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut entries: Vec<_> = dir
        .take(ENTRY_LIMIT)
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let kind = entry.file_type().ok()?;
            let path = disk_path(&entry.path());
            let link = kind.is_symlink() || guard(&path) == Err("PATH_REJECTED");
            Some(DirectoryEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path,
                link,
                directory: kind.is_dir() && !link,
                file: kind.is_file() && !link,
            })
        })
        .collect();
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

enum Format {
    Json,
    JsonComments,
    JsonManifest,
    Toml,
}
struct Document {
    value: Value,
    text: String,
}

static COMMENTS: LazyLock<Option<Regex>> = LazyLock::new(|| Regex::new(r"(?m)^\s*//.*$").ok());

struct Scanner<'a> {
    environment: &'a Environment,
    bytes: u64,
    items: Vec<Item>,
    seen: HashMap<(&'static str, String), usize>,
    stop: &'a dyn Fn() -> bool,
}

impl Scanner<'_> {
    fn add(&mut self, agent: &'static str, place: &Place, mut row: Draft) {
        if self.items.len() >= ITEM_LIMIT || (self.stop)() {
            return;
        }
        let scope = place.scope();
        let identity = format!(
            "{agent}|{scope}|{}|{}|{}|{}",
            place.root.display(),
            row.kind,
            row.name,
            row.file.display()
        );
        let id = format!("{:x}", Sha256::digest(identity));
        let health = if row.problems.iter().any(|item| item.level == "issue") {
            "issue"
        } else if row.problems.iter().any(|item| item.level == "warn") {
            "warn"
        } else if row.unchecked || !row.problems.is_empty() {
            "unknown"
        } else {
            "ok"
        };
        let locator = Locator {
            root: place.root.clone(),
            scope: if scope == "user" { "home" } else { "project" },
            key: row.key.take().unwrap_or_else(|| row.name.clone()),
            directory: row.directory,
            file: row.file.clone(),
        };
        self.items.push(Item {
            id: id[..16].to_owned(),
            agent,
            kind: row.kind,
            name: clean(&row.name),
            scope,
            project: place.label.clone(),
            file: place.show(&row.file),
            openable: openable(&row.file),
            enabled: row.enabled,
            health,
            problems: row.problems,
            details: row.details,
            updated_at: row.updated.map(iso_from_ms),
            actions: row.actions,
            locator,
        });
    }

    fn read(&mut self, file: &Path) -> Result<Option<String>, &'static str> {
        if (self.stop)() {
            return Err("READ_FAILED");
        }
        let before = match fs::symlink_metadata(file) {
            Ok(meta) => meta,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                return Ok(None)
            }
            Err(_) => return Err("READ_FAILED"),
        };
        guard(file).map_err(|_| "READ_FAILED")?;
        if !before.is_file() || sensitive_name(file) {
            return Err("NOT_A_FILE");
        }
        if before.len() > FILE_LIMIT {
            return Err("TOO_LARGE");
        }
        self.bytes += before.len();
        if self.bytes > TOTAL_LIMIT {
            return Err("TOTAL_LIMIT");
        }
        let bytes = management_read(file, FILE_LIMIT)
            .map_err(|_| "READ_FAILED")?
            .ok_or("READ_FAILED")?;
        String::from_utf8(bytes)
            .map(|mut text| {
                if text.starts_with('\u{feff}') {
                    text.drain(..3);
                }
                Some(text)
            })
            .map_err(|_| "READ_FAILED")
    }

    fn parse(&mut self, file: &Path, format: Format) -> Result<Option<Document>, &'static str> {
        let Some(text) = self.read(file)? else {
            return Ok(None);
        };
        let parsed = match format {
            Format::Json => syntax::json(&text),
            Format::Toml => syntax::toml(&text),
            Format::JsonManifest => serde_json::from_str(&text).map_err(|_| "FORMAT"),
            Format::JsonComments => syntax::json(&COMMENTS.as_ref().map_or_else(
                || std::borrow::Cow::Borrowed(text.as_str()),
                |re| re.replace_all(&text, ""),
            )),
        };
        let value = parsed.ok().filter(Value::is_object).ok_or("FORMAT")?;
        Ok(Some(Document { value, text }))
    }

    fn inspect(
        &mut self,
        agent: &'static str,
        title: &str,
        place: &Place,
        file: &Path,
        format: Format,
    ) -> Option<Document> {
        match self.parse(file, format) {
            Ok(document) => document,
            Err(code) => {
                let mut row = Draft::new(file, "file", basename(file));
                row.problems.push(file_problem(title, code));
                self.add(agent, place, row);
                None
            }
        }
    }

    fn instructions(&mut self, agent: &'static str, place: &Place, names: &[&str]) {
        for name in names {
            let file = place.root.join(name);
            let Some(meta) = stat(&file).filter(fs::Metadata::is_file) else {
                continue;
            };
            let name = basename(&file);
            let label = place
                .label
                .as_ref()
                .map_or_else(|| name.clone(), |project| format!("{name} · {project}"));
            let mut row = Draft::new(&file, "instruction", label);
            let bytes = meta.len();
            if agent == "codex" && bytes > 32768 {
                row.problems.push(problem(
                    "warn",
                    "超过 32 KB，Codex 默认只读前面的部分",
                    "拆短，或调大 project_doc_max_bytes",
                    None,
                ));
            } else if bytes > 40960 {
                row.problems.push(problem(
                    "warn",
                    "文件很长，每次都会占用不少上下文",
                    "把不常用的内容拆出去",
                    None,
                ));
            }
            if bytes == 0 {
                row.problems.push(problem("warn", "文件是空的", "", None));
            }
            row.details.push(detail("大小", size(bytes)));
            if bytes <= FILE_LIMIT {
                row.actions = vec!["read", "edit"];
            }
            self.add(agent, place, row);
        }
    }

    fn agent(&mut self, spec: &Spec, place: &Place) {
        let agent = spec.id;
        let user = place.label.is_none();
        let at = |relative: &str| place.root.join(relative);
        let skills = match agent {
            "codex" => {
                let file = at(".codex/config.toml");
                let config = self.inspect(agent, spec.label, place, &file, Format::Toml);
                let mut enabled = None;
                if let Some(doc) = &config {
                    let checks = project(agent, "codex-config", &doc.text).0;
                    self.servers(
                        agent,
                        place,
                        &file,
                        &doc.value["mcp_servers"],
                        &checks,
                        true,
                        |_, raw| Some(raw["enabled"] != false),
                    );
                    enabled = doc.value["features"]
                        .get("hooks")
                        .or_else(|| doc.value["features"].get("codex_hooks"))
                        .and_then(Value::as_bool);
                    self.hooks(
                        agent,
                        place,
                        &file,
                        &doc.value["hooks"],
                        &checks,
                        enabled,
                        false,
                    );
                }
                let file = at(".codex/hooks.json");
                if let Some(doc) = self.inspect(agent, spec.label, place, &file, Format::Json) {
                    self.hooks(
                        agent,
                        place,
                        &file,
                        &doc.value["hooks"],
                        &project(agent, "codex-hooks", &doc.text).0,
                        enabled,
                        true,
                    );
                }
                let skills: &[&str] = if user {
                    &[".agents/skills", ".codex/skills"]
                } else {
                    &[".agents/skills"]
                };
                self.skills(spec, place, skills);
                if user {
                    self.codex_plugins(
                        place,
                        config
                            .as_ref()
                            .map_or(&Value::Null, |doc| &doc.value["plugins"]),
                    );
                }
                None
            }
            "claude" => {
                let relative: &[&str] = if user {
                    &[".claude/settings.json"]
                } else {
                    &[".claude/settings.json", ".claude/settings.local.json"]
                };
                let mut disabled = Vec::new();
                for name in relative {
                    let file = at(name);
                    let Some(doc) = self.inspect(agent, spec.label, place, &file, Format::Json)
                    else {
                        continue;
                    };
                    let local = name.ends_with(".local.json");
                    let kind = if local {
                        "claude-settings-local"
                    } else {
                        "claude-settings"
                    };
                    self.hooks(
                        agent,
                        place,
                        &file,
                        &doc.value["hooks"],
                        &project(agent, kind, &doc.text).0,
                        doc.value["disableAllHooks"].as_bool().map(|b| !b),
                        user || local,
                    );
                    if user {
                        self.claude_plugins(place, &doc.value["enabledPlugins"]);
                    }
                    if local {
                        disabled = doc.value["disabledMcpjsonServers"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default();
                    }
                }
                if !user {
                    let file = at(".mcp.json");
                    if let Some(doc) = self.inspect(agent, spec.label, place, &file, Format::Json) {
                        let checks = project(agent, "claude-mcp", &doc.text).0;
                        self.servers(
                            agent,
                            place,
                            &file,
                            &doc.value["mcpServers"],
                            &checks,
                            true,
                            |name, _| {
                                Some(disabled.iter().all(|value| value.as_str() != Some(name)))
                            },
                        );
                    }
                }
                Some(".claude/skills")
            }
            "gemini" => {
                let file = at(".gemini/settings.json");
                if let Some(doc) =
                    self.inspect(agent, spec.label, place, &file, Format::JsonComments)
                {
                    self.servers(
                        agent,
                        place,
                        &file,
                        &doc.value["mcpServers"],
                        &[],
                        false,
                        |_, _| None,
                    );
                    self.hooks(agent, place, &file, &doc.value["hooks"], &[], None, false);
                }
                self.skills(spec, place, &[".gemini/skills"]);
                if user {
                    self.gemini_extensions(place);
                }
                None
            }
            _ => {
                let file = at(if user {
                    ".config/opencode/opencode.json"
                } else {
                    "opencode.json"
                });
                if let Some(doc) =
                    self.inspect(agent, spec.label, place, &file, Format::JsonComments)
                {
                    self.servers(
                        agent,
                        place,
                        &file,
                        &doc.value["mcp"],
                        &[],
                        false,
                        |_, raw| Some(raw["enabled"] != false),
                    );
                    for name in doc.value["plugin"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .take(64)
                        .filter_map(Value::as_str)
                    {
                        let mut row = Draft::new(&file, "plugin", name);
                        row.enabled = Some(true);
                        row.details.push(detail("来源", "配置里写的 npm 包"));
                        self.add(agent, place, row);
                    }
                }
                let plugins = at(if user {
                    ".config/opencode/plugins"
                } else {
                    ".opencode/plugins"
                });
                for entry in list(&plugins).into_iter().filter(|entry| entry.file) {
                    let mut row = Draft::new(&entry.path, "plugin", entry.name);
                    row.enabled = Some(true);
                    row.details.push(detail("来源", "本地插件文件"));
                    self.add(agent, place, row);
                }
                Some(if user {
                    ".config/opencode/skills"
                } else {
                    ".opencode/skills"
                })
            }
        };
        if let Some(relative) = skills {
            self.skills(spec, place, &[relative]);
        }
        match (agent, user) {
            ("codex", true) => self.instructions(agent, place, &[".codex/AGENTS.md"]),
            ("codex", false) => self.instructions(agent, place, &["AGENTS.md"]),
            ("claude", true) => self.instructions(agent, place, &[".claude/CLAUDE.md"]),
            ("claude", false) => {
                self.instructions(agent, place, &["CLAUDE.md", ".claude/CLAUDE.md"])
            }
            ("gemini", true) => self.instructions(agent, place, &[".gemini/GEMINI.md"]),
            ("gemini", false) => self.instructions(agent, place, &["GEMINI.md"]),
            (_, true) => self.instructions(agent, place, &[".config/opencode/AGENTS.md"]),
            (_, false) => self.instructions(agent, place, &["AGENTS.md"]),
        }
    }
}

fn file_problem(agent: &str, code: &str) -> Problem {
    match code {
        "FORMAT" => problem(
            "issue",
            format!("配置文件解析不了，{agent} 可能读不到里面的内容"),
            "检查这个文件的语法",
            None,
        ),
        "TOO_LARGE" => problem("warn", "文件太大，没有检查", "", None),
        _ => problem("warn", "这个文件读取不了，没有检查", "", None),
    }
}
fn field<'a>(row: &'a Value, key: &str) -> &'a str {
    row[key].as_str().unwrap_or_default()
}
fn compact(value: &Value) -> String {
    if let Some(value) = value.as_str() {
        value.to_owned()
    } else {
        stringify(value)
    }
}

struct Spec {
    id: &'static str,
    label: &'static str,
    marker: &'static str,
    depth: Option<bool>,
    duplicate: &'static str,
}
const AGENTS: &[Spec] = &[
    Spec {
        id: "codex",
        label: "Codex",
        marker: ".codex",
        depth: Some(true),
        duplicate: "选择时两个都会出现，容易选错",
    },
    Spec {
        id: "claude",
        label: "Claude Code",
        marker: ".claude",
        depth: None,
        duplicate: "只会用到其中一个",
    },
    Spec {
        id: "gemini",
        label: "Gemini CLI",
        marker: ".gemini",
        depth: Some(false),
        duplicate: "只会用到其中一个",
    },
    Spec {
        id: "opencode",
        label: "OpenCode",
        marker: ".config/opencode",
        depth: None,
        duplicate: "OpenCode 要求名字在所有位置都不重复",
    },
];

pub fn scan(
    home: &Path,
    projects: &[PathBuf],
    environment: &Environment,
    stop: impl Fn() -> bool,
) -> Result<Inventory, &'static str> {
    if !home.is_absolute() {
        return Err("INVENTORY_HOME_REQUIRED");
    }
    let home = disk_path(home);
    let mut places = vec![Place {
        root: home.clone(),
        label: None,
    }];
    for root in projects {
        if guard(root).is_ok() && root.is_dir() {
            places.push(Place {
                root: disk_path(root),
                label: Some(clean(&basename(root))),
            });
        }
    }
    let mut scan = Scanner {
        environment,
        bytes: 0,
        items: Vec::new(),
        seen: HashMap::new(),
        stop: &stop,
    };
    let mut agents = Vec::new();
    for spec in AGENTS {
        if stop() {
            return Err("INVENTORY_TIMEOUT");
        }
        let found = stat(&home.join(spec.marker)).is_some_and(|metadata| metadata.is_dir());
        for place in &places {
            if place.label.is_some() || found {
                scan.agent(spec, place);
            }
        }
        agents.push(Agent {
            id: spec.id,
            name: spec.label,
            found: found || scan.items.iter().any(|item| item.agent == spec.id),
            writable: matches!(spec.id, "codex" | "claude"),
        });
    }
    if stop() {
        return Err("INVENTORY_TIMEOUT");
    }
    let notes = if agents
        .iter()
        .any(|agent| agent.id == "claude" && agent.found)
    {
        vec![Note {
            agent: "claude",
            text: "用户级 MCP 写在 ~/.claude.json，这个文件混有账号信息，没有读取。",
        }]
    } else {
        Vec::new()
    };
    Ok(Inventory {
        schema_version: "AgentInventoryV1",
        agents,
        truncated: scan.items.len() >= ITEM_LIMIT,
        items: scan.items,
        notes,
        bytes_read: scan.bytes,
    })
}
