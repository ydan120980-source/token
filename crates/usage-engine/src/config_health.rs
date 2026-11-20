use crate::config_health_project::{project, row};
use crate::js_json::ordered_keys;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
};

pub const FILE_LIMIT: u64 = 262_144;
const FRONTMATTER_LIMIT: usize = 16_384;
const TOTAL_LIMIT: u64 = 2 * 1024 * 1024;
const SKILL_LIMIT: usize = 64;

type ScanResult<T> = Result<T, &'static str>;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigAudit {
    pub files_read: u64,
    pub bytes_read: u64,
}

#[derive(PartialEq, Eq)]
struct Version {
    volume: u64,
    identity: u64,
    length: u64,
    modified: i128,
    changed: i128,
    links: u32,
}

fn reason(error: io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::NotFound => "ENOENT",
        io::ErrorKind::PermissionDenied => "EACCES",
        _ => "READ_UNAVAILABLE",
    }
}

fn comparable(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if cfg!(windows) {
        let value = value.strip_prefix(r"\\?\").unwrap_or(&value);
        PathBuf::from(value.to_lowercase())
    } else {
        path.to_owned()
    }
}

pub fn guard(path: &Path) -> ScanResult<()> {
    for current in path.ancestors() {
        let metadata = fs::symlink_metadata(current).map_err(reason)?;
        if metadata.file_type().is_symlink() {
            return Err("PATH_REJECTED");
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return Err("PATH_REJECTED");
            }
        }
        let resolved = fs::canonicalize(current).map_err(reason)?;
        if comparable(&resolved)
            .components()
            .ne(comparable(current).components())
        {
            return Err("PATH_REJECTED");
        }
    }
    Ok(())
}

pub fn selected(path: &Path) -> ScanResult<PathBuf> {
    let name = path.to_string_lossy();
    if !path.is_absolute()
        || name.starts_with("//")
        || name.starts_with(r"\\")
        || path.parent().is_none()
    {
        return Err("ROOT_REQUIRED");
    }
    let path = std::path::absolute(path).map_err(reason)?;
    guard(&path)?;
    if !fs::symlink_metadata(&path).map_err(reason)?.is_dir() || path.parent().is_none() {
        return Err("ROOT_REQUIRED");
    }
    Ok(path)
}

fn open(path: &Path, metadata_only: bool) -> ScanResult<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
        };
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        if metadata_only {
            options.access_mode(FILE_READ_ATTRIBUTES);
        }
    }
    #[cfg(not(windows))]
    let _ = metadata_only;
    options.open(path).map_err(reason)
}

#[cfg(windows)]
fn version(file: &File) -> ScanResult<Version> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileBasicInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_BASIC_INFO,
    };
    let mut identity = BY_HANDLE_FILE_INFORMATION::default();
    let mut dates = FILE_BASIC_INFO::default();
    // SAFETY: File owns the handle throughout both calls. Both typed output buffers
    // are initialized, writable and have the exact sizes required by these classes.
    let success = unsafe {
        GetFileInformationByHandle(file.as_raw_handle(), &mut identity) != 0
            && GetFileInformationByHandleEx(
                file.as_raw_handle(),
                FileBasicInfo,
                (&mut dates as *mut FILE_BASIC_INFO).cast(),
                std::mem::size_of::<FILE_BASIC_INFO>() as u32,
            ) != 0
    };
    if !success {
        return Err(reason(io::Error::last_os_error()));
    }
    if identity.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || identity.nNumberOfLinks != 1
    {
        return Err("FILE_TYPE");
    }
    Ok(Version {
        volume: u64::from(identity.dwVolumeSerialNumber),
        identity: u64::from(identity.nFileIndexHigh) << 32 | u64::from(identity.nFileIndexLow),
        length: u64::from(identity.nFileSizeHigh) << 32 | u64::from(identity.nFileSizeLow),
        modified: i128::from(dates.LastWriteTime),
        changed: i128::from(dates.ChangeTime),
        links: identity.nNumberOfLinks,
    })
}

#[cfg(unix)]
fn version(file: &File) -> ScanResult<Version> {
    use std::os::unix::fs::MetadataExt;
    let value = file.metadata().map_err(reason)?;
    if !value.is_file() || value.nlink() != 1 {
        return Err("FILE_TYPE");
    }
    Ok(Version {
        volume: value.dev(),
        identity: value.ino(),
        length: value.len(),
        modified: i128::from(value.mtime()) * 1_000_000_000 + i128::from(value.mtime_nsec()),
        changed: i128::from(value.ctime()) * 1_000_000_000 + i128::from(value.ctime_nsec()),
        links: 1,
    })
}

fn bounded_frontmatter(file: &mut File, size: u64, audit: &mut ConfigAudit) -> ScanResult<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut line_start = 0;
    let mut lines = 0;
    let mut byte = [0];
    while bytes.len() < FRONTMATTER_LIMIT {
        if audit.bytes_read >= TOTAL_LIMIT {
            return Err("TOTAL_LIMIT");
        }
        if file.read(&mut byte).map_err(reason)? == 0 {
            break;
        }
        bytes.push(byte[0]);
        audit.bytes_read += 1;
        if byte[0] == b'\n' {
            let line = bytes[line_start..]
                .strip_suffix(b"\r\n")
                .or_else(|| bytes[line_start..].strip_suffix(b"\n"));
            if lines == 0 && line != Some(b"---") {
                return Err("FRONTMATTER_MISSING");
            }
            if lines > 0 && line == Some(b"---") {
                return Ok(bytes);
            }
            lines += 1;
            line_start = bytes.len();
        }
    }
    if lines > 0 && &bytes[line_start..] == b"---" && bytes.len() as u64 == size {
        return Ok(bytes);
    }
    Err(if bytes.len() == FRONTMATTER_LIMIT {
        "FRONTMATTER_LIMIT"
    } else {
        "FRONTMATTER_MISSING"
    })
}

fn read(path: &Path, kind: &str, audit: &mut ConfigAudit) -> ScanResult<(Option<String>, u64)> {
    guard(path)?;
    if !fs::symlink_metadata(path).map_err(reason)?.is_file() {
        return Err("FILE_TYPE");
    }
    let before = version(&open(path, true)?)?;
    if kind == "instruction" {
        return Ok((None, before.length));
    }
    if kind != "skill" && before.length > FILE_LIMIT {
        return Err("FILE_LIMIT");
    }
    let mut file = open(path, false)?;
    guard(path)?;
    if version(&file)? != before {
        return Err("FILE_CHANGED");
    }
    let body = if kind == "skill" {
        bounded_frontmatter(&mut file, before.length, audit)?
    } else {
        if audit.bytes_read + before.length > TOTAL_LIMIT {
            return Err("TOTAL_LIMIT");
        }
        let mut bytes = Vec::with_capacity(before.length as usize);
        let result = (&mut file).take(before.length).read_to_end(&mut bytes);
        audit.bytes_read += bytes.len() as u64;
        result.map_err(reason)?;
        if bytes.len() as u64 != before.length {
            return Err("FILE_CHANGED");
        }
        bytes
    };
    guard(path)?;
    if version(&file)? != before || version(&open(path, true)?)? != before {
        return Err("FILE_CHANGED");
    }
    audit.files_read += 1;
    let text = String::from_utf8(body).map_err(|_| "READ_UNAVAILABLE")?;
    let text = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(&text);
    Ok((Some(text.to_owned()), before.length))
}

/// A bounded explicit management read, with the same path and identity checks as a scan.
pub fn management_read(path: &Path, limit: u64) -> ScanResult<Option<Vec<u8>>> {
    if !path.is_absolute() || path.to_string_lossy().starts_with(r"\\") {
        return Err("PATH_REJECTED");
    }
    match guard(path) {
        Err("ENOENT") => {
            guard_existing_parent(path)?;
            return Ok(None);
        }
        result => result?,
    }
    let before = version(&open(path, true)?)?;
    if before.length > limit {
        return Err("FILE_LIMIT");
    }
    let file = open(path, false)?;
    guard(path)?;
    if version(&file)? != before {
        return Err("FILE_CHANGED");
    }
    let mut bytes = Vec::with_capacity(before.length as usize);
    (&file)
        .take(before.length)
        .read_to_end(&mut bytes)
        .map_err(reason)?;
    guard(path)?;
    if bytes.len() as u64 != before.length
        || version(&file)? != before
        || version(&open(path, true)?)? != before
    {
        return Err("FILE_CHANGED");
    }
    Ok(Some(bytes))
}

pub fn guard_existing_parent(path: &Path) -> ScanResult<()> {
    for current in path.ancestors() {
        match fs::symlink_metadata(current) {
            Ok(_) => return guard(current),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(reason(error)),
        }
    }
    Err("PATH_REJECTED")
}

fn file_row(agent: &str, scope: &str, kind: &str, checks: Vec<Value>) -> Value {
    json!({"agent":agent,"scope":scope,"kind":kind,"checks":checks})
}

struct Scan {
    audit: ConfigAudit,
    files: Vec<Value>,
}

impl Scan {
    fn inspect(
        &mut self,
        agent: &str,
        scope: &str,
        root: &Path,
        relative: &Path,
        kind: &str,
        index: Option<usize>,
    ) -> Option<String> {
        let (checks, observed) = match read(&root.join(relative), kind, &mut self.audit) {
            Ok((Some(text), _)) => project(agent, kind, &text),
            Ok((None, bytes)) => (
                vec![row(
                    "instruction",
                    "static-ok",
                    "METADATA_ONLY",
                    json!({"bytes":bytes}),
                )],
                None,
            ),
            Err(reason) => (vec![row("file", "unchecked", reason, Value::Null)], None),
        };
        let mut file = file_row(agent, scope, kind, checks);
        if let Some(index) = index {
            file["index"] = json!(index);
        }
        self.files.push(file);
        observed
    }

    fn skills(
        &mut self,
        agent: &str,
        scope: &str,
        root: &Path,
        canceled: &impl Fn() -> bool,
    ) -> ScanResult<()> {
        let relative = Path::new(if agent == "codex" {
            ".agents/skills"
        } else {
            ".claude/skills"
        });
        let directory = root.join(relative);
        let entries = guard(&directory).and_then(|_| {
            if !fs::symlink_metadata(&directory).map_err(reason)?.is_dir() {
                return Err("FILE_TYPE");
            }
            fs::read_dir(&directory).map_err(reason)
        });
        let mut count = 0;
        let mut names = HashMap::new();
        let mut directory_check = None;
        match entries {
            Ok(entries) => {
                for (at, entry) in entries.enumerate() {
                    if canceled() {
                        return Err("CONFIG_CHECK_CANCELLED");
                    }
                    if at >= SKILL_LIMIT {
                        directory_check = Some(row(
                            "skills",
                            "unchecked",
                            "ENTRY_LIMIT",
                            json!({"omittedAtLeast":1}),
                        ));
                        break;
                    }
                    let entry = match entry {
                        Ok(entry) => entry,
                        Err(error) => {
                            directory_check =
                                Some(row("skills", "unchecked", reason(error), Value::Null));
                            break;
                        }
                    };
                    if !entry
                        .file_type()
                        .is_ok_and(|kind| kind.is_dir() || kind.is_symlink())
                    {
                        continue;
                    }
                    count += 1;
                    let at = self.files.len();
                    let path = relative.join(entry.file_name()).join("SKILL.md");
                    if let Some(name) =
                        self.inspect(agent, scope, root, &path, "skill", Some(count))
                    {
                        if let Some(&previous) = names.get(&name) {
                            for index in [previous, at] {
                                self.files[index]["checks"][0]["state"] = json!("issue");
                                self.files[index]["checks"][0]["reason"] =
                                    json!("DUPLICATE_SKILL_NAME");
                            }
                        } else {
                            names.insert(name, at);
                        }
                    }
                }
            }
            Err(error) => directory_check = Some(row("skills", "unchecked", error, Value::Null)),
        }
        if let Some(check) = directory_check {
            self.files
                .push(file_row(agent, scope, "skill-directory", vec![check]));
        }
        if count == 0
            && self.files.last().is_none_or(|file| {
                file["kind"] != "skill-directory" || file["checks"][0]["reason"] == "ENTRY_LIMIT"
            })
        {
            self.files.push(file_row(
                agent,
                scope,
                "skill-directory",
                vec![row("skills", "static-ok", "NO_ENTRIES", Value::Null)],
            ));
        }
        Ok(())
    }
}

fn counts<'a>(checks: impl Iterator<Item = &'a Value>) -> Value {
    let mut counts = json!({"static-ok":0,"issue":0,"unchecked":0,"not-applicable":0});
    for check in checks {
        if let Some(state) = check["state"].as_str() {
            let count = counts[state].as_u64().unwrap_or_default();
            counts[state] = json!(count + 1);
        }
    }
    counts
}

fn part(file: &Value, check: &Value, kind: &str) -> bool {
    if check["kind"] == kind || kind == "skills" && check["kind"] == "skill-overrides" {
        return true;
    }
    if check["kind"] != "file" {
        return false;
    }
    match file["kind"].as_str().unwrap_or_default() {
        "codex-config" => true,
        "codex-hooks" | "claude-settings" | "claude-settings-local" => kind == "hooks",
        "claude-mcp" | "mixed-account-mcp" => kind == "mcp",
        "skill" | "skill-directory" => kind == "skills",
        _ => false,
    }
}

fn checks(file: &Value) -> impl Iterator<Item = &Value> {
    file["checks"].as_array().into_iter().flatten()
}

pub fn summary(files: &[Value]) -> Value {
    ["mcp", "hooks", "skills"]
        .into_iter()
        .map(|kind| {
            let found: Vec<_> = files
                .iter()
                .filter(|file| checks(file).any(|check| part(file, check, kind)))
                .collect();
            let counts = counts(
                found
                    .iter()
                    .flat_map(|file| checks(file).filter(move |check| part(file, check, kind))),
            );
            let state = if counts["issue"].as_u64().unwrap_or(0) > 0 {
                "issue"
            } else if counts["unchecked"].as_u64().unwrap_or(0) > 0 || found.is_empty() {
                "unchecked"
            } else {
                "static-ok"
            };
            (
                kind.to_owned(),
                json!({"state":state,"files":found.len(),"counts":counts,"runtimeVerified":false}),
            )
        })
        .collect::<Map<String, Value>>()
        .into()
}

/// Read only known local files below the caller's explicit selections.
pub fn scan(selection: &Value, agents: &[&str], canceled: impl Fn() -> bool) -> ScanResult<Value> {
    if agents.is_empty()
        || agents.len() > 2
        || agents.iter().enumerate().any(|(at, agent)| {
            !matches!(*agent, "codex" | "claude") || agents[..at].contains(agent)
        })
    {
        return Err("AGENT_REQUIRED");
    }
    let selection = selection
        .as_object()
        .filter(|map| !map.is_empty())
        .ok_or("ROOT_REQUIRED")?;
    let mut scopes = Vec::new();
    for scope in ordered_keys(selection) {
        if !matches!(scope.as_str(), "home" | "project") {
            return Err("ROOT_REQUIRED");
        }
        let path = selection[scope].as_str().ok_or("ROOT_REQUIRED")?;
        scopes.push((scope.as_str(), selected(Path::new(path))?));
    }
    let mut scan = Scan {
        audit: ConfigAudit::default(),
        files: Vec::new(),
    };
    for (scope, root) in &scopes {
        for &agent in agents {
            if canceled() {
                return Err("CONFIG_CHECK_CANCELLED");
            }
            scan.files.push(file_row(
                agent,
                scope,
                "client-compatibility",
                vec![row(
                    "compatibility",
                    "unchecked",
                    "CLIENT_VERSION_UNVERIFIED",
                    Value::Null,
                )],
            ));
            let candidates: &[(&str, &str)] = if agent == "codex" {
                &[
                    (".codex/config.toml", "codex-config"),
                    (".codex/hooks.json", "codex-hooks"),
                    ("AGENTS.md", "instruction"),
                ]
            } else if *scope == "project" {
                &[
                    (".claude/settings.json", "claude-settings"),
                    ("CLAUDE.md", "instruction"),
                    (".claude/settings.local.json", "claude-settings-local"),
                    (".mcp.json", "claude-mcp"),
                ]
            } else {
                &[
                    (".claude/settings.json", "claude-settings"),
                    ("CLAUDE.md", "instruction"),
                ]
            };
            for (relative, kind) in candidates {
                if canceled() {
                    return Err("CONFIG_CHECK_CANCELLED");
                }
                scan.inspect(agent, scope, root, Path::new(relative), kind, None);
            }
            if agent == "claude" {
                scan.files.push(file_row(
                    agent,
                    scope,
                    "mixed-account-mcp",
                    vec![row(
                        "mcp",
                        "unchecked",
                        "MIXED_ACCOUNT_FILE_EXCLUDED",
                        Value::Null,
                    )],
                ));
            }
            scan.skills(agent, scope, root, &canceled)?;
        }
    }
    Ok(json!({
        "schemaVersion":"ConfigHealthV1","contract":"codex-claude-static/20261022-events",
        "state":"unchecked","reason":"PARTIAL_STATIC_SCOPE","clientVersionVerified":false,"runtimeVerified":false,
        "scopes":scopes.iter().map(|(scope,_)| *scope).collect::<Vec<_>>(),
        "files":scan.files,"counts":counts(scan.files.iter().flat_map(checks)),"summary":summary(&scan.files),"audit":scan.audit
    }))
}
