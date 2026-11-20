use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use usage_engine::{
    config_health::{guard, guard_existing_parent, management_read, selected, FILE_LIMIT},
    config_health_syntax as syntax,
    js_json::{ordered_keys, stringify},
};

pub(super) type Result<T> = std::result::Result<T, &'static str>;

pub(super) fn read(path: &Path, limit: u64) -> Result<Option<Vec<u8>>> {
    management_read(path, limit).map_err(|error| match error {
        "FILE_CHANGED" => "CONFIG_CHANGED",
        "PATH_REJECTED" => "CONFIG_PATH_REJECTED",
        _ => "CONFIG_FILE_REJECTED",
    })
}

pub(super) fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn revision(bytes: Option<&[u8]>) -> Option<String> {
    bytes.map(digest)
}

pub(super) fn check(path: &Path, expected: Option<&str>) -> Result<()> {
    if revision(read(path, FILE_LIMIT)?.as_deref()).as_deref() != expected {
        return Err("CONFIG_CHANGED");
    }
    Ok(())
}

pub(super) fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(super) fn checked_root(path: &Path) -> Result<()> {
    selected(path).map(drop).map_err(|_| "CONFIG_PATH_REJECTED")
}

pub(super) fn anchor(path: &Path) -> Result<()> {
    guard_existing_parent(path).map_err(|_| "CONFIG_PATH_REJECTED")
}

pub(super) fn parent(path: &Path) -> Result<&Path> {
    let parent = path.parent().ok_or("CONFIG_PATH_REJECTED")?;
    anchor(parent)?;
    fs::create_dir_all(parent).map_err(|_| "CONFIG_FILE_REJECTED")?;
    guard(parent).map_err(|_| "CONFIG_PATH_REJECTED")?;
    Ok(parent)
}

pub(super) fn atomic(path: &Path, before: Option<&str>, bytes: &[u8]) -> Result<()> {
    check(path, before)?;
    let mut staged = NamedTempFile::new_in(parent(path)?).map_err(|_| "CONFIG_FILE_REJECTED")?;
    staged
        .write_all(bytes)
        .and_then(|_| staged.as_file().sync_all())
        .map_err(|_| "CONFIG_FILE_REJECTED")?;
    check(path, before)?;
    if before.is_none() {
        staged.persist_noclobber(path).map_err(|error| {
            if error.error.kind() == std::io::ErrorKind::AlreadyExists {
                "CONFIG_CHANGED"
            } else {
                "CONFIG_FILE_REJECTED"
            }
        })?;
    } else {
        staged.persist(path).map_err(|_| "CONFIG_FILE_REJECTED")?;
    }
    Ok(())
}

pub(super) fn utf8(bytes: &[u8]) -> Result<&str> {
    std::str::from_utf8(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes))
        .map_err(|_| "CONFIG_FORMAT_UNSUPPORTED")
}

fn is_toml(file: &Path) -> bool {
    file.extension()
        .is_some_and(|extension| extension == "toml")
}

pub(super) fn parse(file: &Path, bytes: Option<&[u8]>) -> Result<Value> {
    let Some(bytes) = bytes else {
        return Ok(Value::Object(Map::new()));
    };
    let text = utf8(bytes)?;
    let result = if is_toml(file) {
        syntax::toml(text)
    } else {
        syntax::json(text)
    };
    result
        .ok()
        .filter(Value::is_object)
        .ok_or("CONFIG_FORMAT_UNSUPPORTED")
}

fn toml_value(value: &Value) -> Result<String> {
    match value {
        Value::Array(items) => {
            let items = items.iter().map(toml_value).collect::<Result<Vec<_>>>()?;
            Ok(format!("[{}]", items.join(", ")))
        }
        Value::Object(map) => {
            let items = toml_pairs(map)?.join(", ");
            Ok(format!("{{ {items} }}"))
        }
        Value::Null => Err("CONFIG_FORMAT_UNSUPPORTED"),
        _ => Ok(stringify(value)),
    }
}

fn toml_pairs(map: &Map<String, Value>) -> Result<Vec<String>> {
    ordered_keys(map)
        .into_iter()
        .map(|key| {
            Ok(format!(
                "{} = {}",
                stringify(&Value::String(key.clone())),
                toml_value(&map[key])?
            ))
        })
        .collect()
}

pub(super) fn serialize(file: &Path, value: &Value) -> Result<Vec<u8>> {
    let mut output = if is_toml(file) {
        toml_pairs(value.as_object().ok_or("CONFIG_FORMAT_UNSUPPORTED")?)?.join("\n")
    } else {
        serde_json::to_string_pretty(value).map_err(|_| "CONFIG_FORMAT_UNSUPPORTED")?
    };
    output.push('\n');
    let bytes = output.into_bytes();
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("CONFIG_FILE_REJECTED");
    }
    if parse(file, Some(&bytes))? != *value {
        return Err("CONFIG_FORMAT_UNSUPPORTED");
    }
    Ok(bytes)
}

pub(super) fn skill_parts(bytes: &[u8]) -> Result<(Value, &str)> {
    let text = utf8(bytes)?;
    let mut lines = text.split_inclusive('\n');
    let first = lines.next().ok_or("CONFIG_FORMAT_UNSUPPORTED")?;
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return Err("CONFIG_FORMAT_UNSUPPORTED");
    }
    let mut end = first.len();
    for line in lines {
        end += line.len();
        if end > 16_386 {
            break;
        }
        if line.trim_end_matches(['\r', '\n']) == "---" {
            let header = text[..end].trim_end_matches(['\r', '\n']);
            if header.len() > 16_384 {
                break;
            }
            return Ok((
                syntax::frontmatter(header).map_err(|_| "CONFIG_FORMAT_UNSUPPORTED")?,
                &text[end..],
            ));
        }
    }
    Err("CONFIG_FORMAT_UNSUPPORTED")
}

pub(super) fn skill_bytes(agent: &str, value: &Value, body: &str) -> Result<Vec<u8>> {
    let map = value.as_object().ok_or("CONFIG_FORMAT_UNSUPPORTED")?;
    let mut header = String::from("---\n");
    for key in ordered_keys(map) {
        header.push_str(&format!("{key}: {}\n", stringify(&map[key])));
    }
    header.push_str("---");
    let (checks, _) = usage_engine::config_health_project::project(agent, "skill", &header);
    if checks.iter().any(|row| row["state"] != "static-ok") {
        return Err("CONFIG_EDIT_INVALID");
    }
    let bytes = format!("{header}\n{body}").into_bytes();
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("CONFIG_FILE_REJECTED");
    }
    Ok(bytes)
}

pub(super) struct Tree {
    pub(super) files: Vec<(PathBuf, Vec<u8>)>,
    directories: Vec<PathBuf>,
    pub(super) revision: String,
}

fn private_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let name = lower.trim_start_matches('.');
    lower == ".git"
        || lower == ".claude.json"
        || [
            "auth",
            "credentials",
            "token",
            "tokens",
            "secret",
            "secrets",
            "env",
        ]
        .iter()
        .any(|prefix| {
            name.strip_prefix(prefix)
                .is_some_and(|rest| rest.is_empty() || rest.starts_with(['.', '_', '-']))
        })
}

impl Tree {
    pub(super) fn read(path: &Path) -> Result<Self> {
        checked_root(path)?;
        let mut bundle = Self {
            files: Vec::new(),
            directories: Vec::new(),
            revision: String::new(),
        };
        let mut digest = Sha256::new();
        bundle.visit(path, Path::new(""), &mut digest, 0, &mut 0)?;
        bundle.revision = format!("{:x}", digest.finalize());
        Ok(bundle)
    }

    fn visit(
        &mut self,
        root: &Path,
        prefix: &Path,
        hash: &mut Sha256,
        depth: usize,
        bytes: &mut usize,
    ) -> Result<()> {
        if depth > 8 {
            return Err("CONFIG_IMPORT_REJECTED");
        }
        let dir = root.join(prefix);
        guard(&dir).map_err(|_| "CONFIG_PATH_REJECTED")?;
        let entries = fs::read_dir(&dir).map_err(|_| "CONFIG_IMPORT_REJECTED")?;
        let mut entries = entries
            .take(129)
            .collect::<std::io::Result<Vec<_>>>()
            .map_err(|_| "CONFIG_IMPORT_REJECTED")?;
        if self.files.len() + self.directories.len() + entries.len() > 128 {
            return Err("CONFIG_IMPORT_REJECTED");
        }
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if self.files.len() + self.directories.len() >= 128 {
                return Err("CONFIG_IMPORT_REJECTED");
            }
            let name = entry.file_name();
            if name.to_str().is_none_or(private_name) {
                return Err("CONFIG_IMPORT_REJECTED");
            }
            let relative = prefix.join(name);
            let path = root.join(&relative);
            guard(&path).map_err(|_| "CONFIG_PATH_REJECTED")?;
            if entry
                .file_type()
                .map_err(|_| "CONFIG_IMPORT_REJECTED")?
                .is_dir()
            {
                hash.update(b"d:");
                hash.update(relative.as_os_str().as_encoded_bytes());
                hash.update([0]);
                self.directories.push(relative.clone());
                self.visit(root, &relative, hash, depth + 1, bytes)?;
            } else {
                let contents = read(&path, 1024 * 1024)?.ok_or("CONFIG_CHANGED")?;
                *bytes += contents.len();
                if *bytes > 4 * 1024 * 1024 {
                    return Err("CONFIG_IMPORT_REJECTED");
                }
                hash.update(b"f:");
                hash.update(relative.as_os_str().as_encoded_bytes());
                hash.update([0]);
                hash.update(&contents);
                self.files.push((relative, contents));
            }
        }
        Ok(())
    }

    pub(super) fn skill(&self) -> Result<&[u8]> {
        self.files
            .iter()
            .find(|(path, _)| path == Path::new("SKILL.md"))
            .map(|(_, bytes)| bytes.as_slice())
            .ok_or("CONFIG_IMPORT_REJECTED")
    }

    pub(super) fn install(self, destination: &Path) -> Result<()> {
        let stage =
            tempfile::tempdir_in(parent(destination)?).map_err(|_| "CONFIG_FILE_REJECTED")?;
        for path in self.directories {
            fs::create_dir_all(stage.path().join(path)).map_err(|_| "CONFIG_FILE_REJECTED")?;
        }
        for (path, bytes) in self.files {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(stage.path().join(path))
                .map_err(|_| "CONFIG_FILE_REJECTED")?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "CONFIG_FILE_REJECTED")?;
        }
        move_tree(stage.path(), destination)?;
        Ok(())
    }
}

pub(super) fn absent(path: &Path) -> Result<()> {
    anchor(path)?;
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Ok(_) => Err("CONFIG_IMPORT_COLLISION"),
        Err(_) => Err("CONFIG_FILE_REJECTED"),
    }
}

pub(super) fn move_tree(source: &Path, destination: &Path) -> Result<()> {
    guard(source).map_err(|_| "CONFIG_PATH_REJECTED")?;
    parent(destination)?;
    absent(destination)?;
    use std::os::windows::ffi::OsStrExt;
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::MoveFileW};
    let from: Vec<u16> = source.as_os_str().encode_wide().chain([0]).collect();
    let to: Vec<u16> = destination.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: Both buffers are live and NUL terminated. MoveFileW refuses
    // an existing destination, including one created after the preflight.
    unsafe { MoveFileW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr())) }.map_err(|_| "CONFIG_CHANGED")
}
