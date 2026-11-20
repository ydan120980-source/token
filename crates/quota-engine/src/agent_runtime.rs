use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashSet},
    env, fs, io,
    path::Path,
    time::{Duration, Instant},
};
use usage_engine::{
    pathx,
    time::{iso_from_ms, now_ms},
};

pub struct Definition {
    pub install: &'static str,
    pub help: &'static str,
    pub command: Option<&'static str>,
    pub names: &'static [&'static str],
    pub home: &'static [&'static str],
    pub local: &'static [&'static str],
    pub desktop: bool,
    pub note: &'static str,
}

pub fn definition(agent: &str) -> Option<Definition> {
    Some(match agent {
        "codex" => Definition {
            install: "https://learn.chatgpt.com/docs/codex/cli",
            help: "https://learn.chatgpt.com/docs/codex/cli",
            command: None,
            names: &["codex.exe", "codex.cmd", "codex.ps1"],
            home: &[".local/bin", ".codex/bin"],
            local: &[],
            desktop: false,
            note: "Desktop 与 CLI 会话均可统计。账号额度另需在额度页选择官方 codex.exe 并连接；发现 npm 启动脚本不代表额度读取器已就绪。",
        },
        "claude" => Definition {
            install: "https://code.claude.com/docs/en/setup",
            help: "https://code.claude.com/docs/en/troubleshooting",
            command: Some("irm https://claude.ai/install.ps1 | iex"),
            names: &["claude.exe", "claude.cmd", "claude.ps1"],
            home: &[".local/bin"],
            local: &[],
            desktop: false,
            note: "官方原生安装与 npm 入口可能共存；本地 assistant 用量与额度独立；额度页可接收本人配置的官方状态栏观测，不主动查询。",
        },
        "opencode" => Definition {
            install: "https://opencode.ai/docs/",
            help: "https://opencode.ai/docs/troubleshooting/",
            command: Some("npm install -g opencode-ai"),
            names: &["opencode.exe", "opencode.cmd", "opencode.ps1"],
            home: &[".opencode/bin", ".local/bin"],
            local: &[],
            desktop: false,
            note: "npm 安装需要 Node.js/npm。官方同时提供 Windows 安装选项；本应用不扫描 WSL，也不代为配置供应商。",
        },
        "workbuddy" => Definition {
            install: "https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Win-Guide",
            help: "https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Win-Guide",
            command: None,
            names: &["WorkBuddy.exe"],
            home: &[],
            local: &["Programs/WorkBuddy", "WorkBuddy"],
            desktop: true,
            note: "按官方 Windows 指南安装并在 WorkBuddy 内完成登录。会话 token 与积分是不同指标，额度页可用已授权 token 读取个人积分，公开 OAuth 接入仍有平台前提。",
        },
        "mimo" => Definition {
            install: "https://mimo.mi.com/docs/zh-CN/tokenplan/integration/mimo-code",
            help: "https://mimo.mi.com/docs/zh-CN/tokenplan/integration/mimo-code",
            command: Some("npm install -g @mimo-ai/cli"),
            names: &["mimo.exe", "mimo.cmd", "mimo.ps1", "mimocode.exe"],
            home: &[".mimocode/bin", ".local/bin"],
            local: &[],
            desktop: false,
            note: "Windows npm 安装需要 Node.js 18 或更新版本。授权及 Token Plan/余额在官方应用核对；本应用不推断授权失败或订阅到期。",
        },
        "gemini" => Definition {
            install: "https://geminicli.com/docs/get-started/installation/",
            help: "https://geminicli.com/docs/resources/troubleshooting/",
            command: Some("npm install -g @google/gemini-cli"),
            names: &["gemini.exe", "gemini.cmd", "gemini.ps1"],
            home: &[".local/bin"],
            local: &[],
            desktop: false,
            note: "npm 安装需要 Node.js 20 或更新版本；系统要求见官方说明。本地 chats 用量与 Google 账号限额分开，额度页提供需 OAuth token 与项目 ID 的试验只读路线。",
        },
        "cursor" => Definition {
            install: "https://cursor.com/download",
            help: "https://cursor.com/docs/sdk/typescript",
            command: None,
            names: &["Cursor.exe", "cursor.cmd", "cursor.exe"],
            home: &[],
            local: &["Programs/cursor", "Programs/cursor/resources/app/bin"],
            desktop: true,
            note: "安装 Cursor 不能保证普通聊天可计量。当前支持 SDK index.db、runs.ndjson 或符合字段要求的逐请求 CSV；团队汇总 CSV 不能替代逐请求用量。",
        },
        "zcode" => Definition {
            install: "https://zcode.z.ai/en/docs/welcome",
            help: "https://zcode.z.ai/en/docs/welcome",
            command: None,
            names: &["ZCode.exe", "zcode.exe", "zcode.cmd"],
            home: &[],
            local: &["Programs/ZCode", "ZCode"],
            desktop: true,
            note: "按官方文档安装或更新 ZCode；本应用读取本地 model_usage，未知计量字段维持未知，不推断账号会员及额度。",
        },
        "deepseek" => Definition {
            install: "https://github.com/deepseek-ai/deepseek-harness",
            help: "https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md",
            command: None,
            names: &["dsh.exe", "dsh.cmd", "dsh.ps1"],
            home: &[".local/bin", ".dsh/bin"],
            local: &[],
            desktop: false,
            note: "官方提供 Node.js 启动及桌面入口；npx 启动会运行服务，所以这里只打开指南。当前读取 v2–v4 会话，未来格式需要适配器核对，不要改写原日志。",
        },
        "antigravity" => Definition {
            install: "https://antigravity.google/docs/getting-started",
            help: "https://antigravity.google/docs/cli/troubleshooting/",
            command: None,
            names: &["agy.exe"],
            home: &[],
            local: &[],
            desktop: false,
            note: "桌面 transcript 用量与 CLI /usage 相互独立；各模型额度、积分及订阅有效期不按 token 数倒推。",
        },
        _ => return None,
    })
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Environment {
    pub platform: String,
    pub home: String,
    pub app_data: String,
    pub local_app_data: String,
    pub program_files: String,
    pub program_files_x86: String,
    pub path: String,
}

impl Environment {
    pub fn current() -> Self {
        let var = |key| env::var(key).unwrap_or_default();
        Self {
            platform: if cfg!(windows) {
                "win32".to_owned()
            } else {
                env::consts::OS.to_owned()
            },
            home: var("USERPROFILE"),
            app_data: var("APPDATA"),
            local_app_data: var("LOCALAPPDATA"),
            program_files: var("ProgramFiles"),
            program_files_x86: var("ProgramFiles(x86)"),
            path: var("Path"),
        }
    }

    fn expand(&self, entry: &str, app_data: bool) -> Option<String> {
        let mut source = entry
            .strip_prefix('"')
            .and_then(|entry| entry.strip_suffix('"'))
            .unwrap_or(entry);
        let mut result = String::new();
        while let Some((prefix, expression)) = source.split_once('%') {
            let (variable, rest) = expression.split_once('%')?;
            let value = match variable.to_ascii_uppercase().as_str() {
                "USERPROFILE" => &self.home,
                "APPDATA" if app_data => &self.app_data,
                "LOCALAPPDATA" => &self.local_app_data,
                "PROGRAMFILES" => &self.program_files,
                "PROGRAMFILES(X86)" => &self.program_files_x86,
                _ => return None,
            };
            result.push_str(prefix);
            result.push_str(&local(value, app_data)?);
            source = rest;
        }
        result.push_str(source);
        local(&result, app_data)
    }
}

fn local(value: &str, strict: bool) -> Option<String> {
    let bytes = value.as_bytes();
    if bytes.len() < 3
        || value.encode_utf16().count() > 32760
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || !pathx::is_sep(char::from(bytes[2]))
        || value.chars().any(|ch| ch < ' ' || "\"<>|?*%".contains(ch))
        || value.get(2..)?.contains(':')
        || strict
            && value
                .split(pathx::is_sep)
                .any(|part| part.ends_with(['.', ' ']))
    {
        return None;
    }
    Some(pathx::normalize(value))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub kind: &'static str,
    pub trust: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub complete: bool,
    pub checked_paths: usize,
    pub issues: Vec<&'static str>,
}

impl Coverage {
    fn new() -> Self {
        Self {
            complete: true,
            checked_paths: 0,
            issues: Vec::new(),
        }
    }

    fn issue(&mut self, issue: &'static str, incomplete: bool) {
        self.complete &= !incomplete;
        if !self.issues.contains(&issue) {
            self.issues.push(issue);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Effects {
    pub executed_cli: bool,
    pub read_credentials: bool,
    pub read_configuration: bool,
    pub requested_quota: bool,
}

fn effects() -> Effects {
    Effects {
        executed_cli: false,
        read_credentials: false,
        read_configuration: false,
        requested_quota: false,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiscovery {
    pub schema_version: &'static str,
    pub agent: String,
    pub checked_at: String,
    pub entries: Vec<Entry>,
    pub coverage: Coverage,
    pub effects: Effects,
}

type Directories = Vec<(String, &'static str)>;

fn push_directory(dirs: &mut Directories, value: String, origin: &'static str) {
    if let Some((last, _)) = dirs
        .iter_mut()
        .find(|(previous, _)| previous.eq_ignore_ascii_case(&value))
    {
        if origin != "path" {
            *last = value;
        }
    } else {
        dirs.push((value, origin));
    }
}

fn add_suffixes(
    dirs: &mut Directories,
    root: Option<&str>,
    suffixes: &[&str],
    origin: &'static str,
) {
    if let Some(root) = root {
        for suffix in suffixes {
            push_directory(dirs, pathx::join(&[root, suffix]), origin);
        }
    }
}

fn add_path(
    dirs: &mut Directories,
    environment: &Environment,
    antigravity: bool,
    coverage: &mut Coverage,
) {
    if environment.path.encode_utf16().count() > 65_536 {
        coverage.issue("PATH_LIMIT", true);
        return;
    }
    let existing = if antigravity { dirs.len() } else { 0 };
    for entry in environment
        .path
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        let Some(value) = environment.expand(entry, !antigravity) else {
            coverage.issue("PATH_ENTRY_SKIPPED", false);
            continue;
        };
        if dirs
            .iter()
            .any(|(previous, _)| previous.eq_ignore_ascii_case(&value))
        {
            continue;
        }
        if dirs.len() - existing >= 128 {
            coverage.issue("DIRECTORY_LIMIT", true);
            break;
        }
        push_directory(dirs, value, "path");
    }
}

fn missing(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
    )
}

pub fn discover(agent: &str, environment: &Environment) -> Result<RuntimeDiscovery, &'static str> {
    let spec = definition(agent)
        .filter(|_| agent != "antigravity")
        .ok_or("SETUP_AGENT_REJECTED")?;
    let mut result = RuntimeDiscovery {
        schema_version: "AgentRuntimeDiscoveryV1",
        agent: agent.to_owned(),
        checked_at: String::new(),
        entries: Vec::new(),
        coverage: Coverage::new(),
        effects: effects(),
    };
    if environment.platform != "win32" {
        result.coverage.issue("PLATFORM_UNSUPPORTED", true);
    } else {
        let home = local(&environment.home, true);
        let local_app = local(&environment.local_app_data, true);
        let app = local(&environment.app_data, true);
        if home.is_none() || local_app.is_none() || app.is_none() {
            result.coverage.issue("ROOT_UNAVAILABLE", true);
        }
        let mut dirs = Vec::new();
        add_suffixes(&mut dirs, home.as_deref(), spec.home, "conventional");
        add_suffixes(&mut dirs, local_app.as_deref(), spec.local, "conventional");
        for path in [&environment.program_files, &environment.program_files_x86] {
            let program = local(path, true);
            for suffix in spec
                .local
                .iter()
                .filter_map(|suffix| suffix.strip_prefix("Programs/"))
            {
                add_suffixes(&mut dirs, program.as_deref(), &[suffix], "conventional");
            }
        }
        if !spec.desktop {
            add_suffixes(&mut dirs, app.as_deref(), &["npm"], "conventional");
        }
        add_suffixes(&mut dirs, home.as_deref(), &["scoop/shims"], "conventional");
        add_path(&mut dirs, environment, false, &mut result.coverage);
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut seen = HashSet::new();
        'directories: for (dir, _) in dirs {
            for name in spec.names {
                let path = pathx::join(&[&dir, name]);
                if !seen.insert(path.to_lowercase()) {
                    continue;
                }
                if result.coverage.checked_paths >= 1024 || Instant::now() >= deadline {
                    result.coverage.issue("SCAN_LIMIT", true);
                    break 'directories;
                }
                result.coverage.checked_paths += 1;
                let row = fs::symlink_metadata(Path::new(&path));
                if Instant::now() >= deadline {
                    result.coverage.issue("SCAN_TIMEOUT", true);
                    break 'directories;
                }
                match row {
                    Ok(stat) if stat.is_file() || stat.file_type().is_symlink() => {
                        let kind = if stat.file_type().is_symlink() {
                            "link"
                        } else if name.to_ascii_lowercase().ends_with(".exe") {
                            "executable"
                        } else {
                            "launcher"
                        };
                        result.entries.push(Entry {
                            path,
                            kind,
                            trust: "unverified",
                        });
                    }
                    Err(error) if !missing(&error) => {
                        result.coverage.issue("METADATA_UNAVAILABLE", true)
                    }
                    _ => {}
                }
            }
        }
    }
    result.checked_at = iso_from_ms(now_ms());
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    pub executable: String,
    pub origins: Vec<&'static str>,
    pub trust: &'static str,
    pub linked: bool,
    pub status: &'static str,
}

pub fn discover_antigravity(environment: &Environment) -> Value {
    let mut coverage = Coverage::new();
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut launchers = Vec::new();
    let mut desktops = Vec::new();
    let mut rejected = false;
    if environment.platform != "win32" {
        coverage.issue("PLATFORM_UNSUPPORTED", true);
    } else {
        let home = local(&environment.home, false);
        let app = local(&environment.local_app_data, false);
        let program = local(&environment.program_files, false);
        let program_x86 = local(&environment.program_files_x86, false);
        if home.is_none() || app.is_none() {
            coverage.issue("ROOT_UNAVAILABLE", true);
        }
        let mut dirs = Vec::new();
        add_suffixes(&mut dirs, app.as_deref(), &["agy/bin"], "official-default");
        add_suffixes(
            &mut dirs,
            home.as_deref(),
            &[".local/bin", ".antigravity/bin"],
            "conventional",
        );
        for root in [program.as_deref(), program_x86.as_deref()] {
            add_suffixes(&mut dirs, root, &["agy/bin"], "conventional");
        }
        add_suffixes(
            &mut dirs,
            app.as_deref(),
            &["Microsoft/WinGet/Links"],
            "conventional",
        );
        add_path(&mut dirs, environment, true, &mut coverage);
        let mut probes = Vec::new();
        for (dir, origin) in dirs {
            for (name, kind) in [
                ("agy.exe", "executable"),
                ("agy.cmd", "launcher"),
                ("agy.ps1", "launcher"),
            ] {
                probes.push((pathx::join(&[&dir, name]), origin, kind));
            }
        }
        for (root, relative) in [
            (app.as_ref(), "Programs/Antigravity/Antigravity.exe"),
            (program.as_ref(), "Antigravity/Antigravity.exe"),
            (program_x86.as_ref(), "Antigravity/Antigravity.exe"),
        ] {
            if let Some(root) = root {
                probes.push((pathx::join(&[root, relative]), "desktop-install", "desktop"));
            }
        }
        let mut seen = BTreeSet::new();
        let deadline = Instant::now() + Duration::from_secs(2);
        for (path, origin, kind) in probes {
            if coverage.checked_paths >= 512 {
                coverage.issue("PROBE_LIMIT", true);
                break;
            }
            if !seen.insert(path.to_lowercase()) {
                continue;
            }
            coverage.checked_paths += 1;
            if Instant::now() >= deadline {
                coverage.issue("SCAN_TIMEOUT", true);
                break;
            }
            let stat = fs::symlink_metadata(&path);
            if Instant::now() >= deadline {
                coverage.issue("SCAN_TIMEOUT", true);
                break;
            }
            let stat = match stat {
                Ok(stat) if stat.is_file() || stat.file_type().is_symlink() => stat,
                Err(error) if !missing(&error) => {
                    coverage.issue("METADATA_UNAVAILABLE", true);
                    continue;
                }
                _ => continue,
            };
            if kind == "desktop" {
                desktops.push(
                    json!({"path":path,"origin":origin,"capability":"desktop-presence-only"}),
                );
                continue;
            }
            if kind == "launcher" {
                launchers
                    .push(json!({"path":path,"origin":origin,"status":"unsupported-launcher"}));
                continue;
            }
            let resolve = fs::canonicalize(&path);
            if Instant::now() >= deadline {
                coverage.issue("SCAN_TIMEOUT", true);
                break;
            }
            let resolved = match resolve {
                Ok(value) => value,
                Err(error) if missing(&error) => continue,
                Err(_) => {
                    coverage.issue("METADATA_UNAVAILABLE", true);
                    continue;
                }
            };
            let resolved = resolved.to_string_lossy();
            let standard = resolved.strip_prefix(r"\\?\").unwrap_or(&resolved);
            let target = local(standard, false)
                .filter(|value| pathx::basename(value).eq_ignore_ascii_case("agy.exe"));
            let Some(target) = target else {
                rejected = true;
                coverage.issue("CANDIDATE_TARGET_REJECTED", false);
                continue;
            };
            match fs::symlink_metadata(&target) {
                Ok(target_stat)
                    if target_stat.is_file() && !target_stat.file_type().is_symlink() =>
                {
                    if let Some(candidate) = candidates
                        .iter_mut()
                        .find(|candidate| candidate.executable.eq_ignore_ascii_case(&target))
                    {
                        if !candidate.origins.contains(&origin) {
                            candidate.origins.push(origin);
                        }
                    } else {
                        candidates.push(Candidate {
                            executable: target,
                            origins: vec![origin],
                            trust: "unverified",
                            linked: stat.file_type().is_symlink(),
                            status: "verification-required",
                        });
                    }
                }
                Ok(_) => {
                    rejected = true;
                    coverage.issue("CANDIDATE_TARGET_REJECTED", false);
                }
                Err(error) if !missing(&error) => coverage.issue("METADATA_UNAVAILABLE", true),
                Err(_) => {}
            }
            if Instant::now() >= deadline {
                coverage.issue("SCAN_TIMEOUT", true);
                break;
            }
        }
    }
    coverage.issues.sort_unstable();
    let (state, executable) = match (&candidates[..], coverage.complete && !rejected) {
        (_, false) => ("incomplete", None),
        ([], true) => ("none", None),
        ([candidate], true) => ("single-candidate", Some(candidate.executable.as_str())),
        (_, true) => ("ambiguous", None),
    };
    let status = if !coverage.complete {
        "partial"
    } else if rejected {
        "candidate-rejected"
    } else if !candidates.is_empty() {
        "candidates-found"
    } else if !desktops.is_empty() {
        "desktop-only"
    } else if !launchers.is_empty() {
        "launcher-only"
    } else {
        "not-found"
    };
    json!({
        "schemaVersion":"AntigravityDiscoveryV1", "provider":"antigravity", "checkedAt":iso_from_ms(now_ms()),
        "status":status,"candidates":candidates,"launchers":launchers,"desktops":desktops,
        "selection":{"state":state,"executable":executable,"verificationRequired":true},"coverage":coverage,"effects":effects()
    })
}
