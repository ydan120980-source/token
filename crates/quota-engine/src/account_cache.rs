use crate::{
    codex_resources,
    provider_catalog::routes,
    resource_contract::{instant, project_resources},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fmt,
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};

const STORAGE_LIMIT: usize = 32 * 1024 * 1024;
const ACCOUNT_LIMIT: usize = 20;
pub(crate) const SECRET_LIMIT: usize = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheError {
    Invalid,
    Storage,
    Profile,
    Full,
}

impl fmt::Display for CacheError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Invalid => "PROVIDER_CACHE_INVALID",
            Self::Storage => "PROVIDER_STORAGE_FAILED",
            Self::Profile => "LEGACY_PROFILE_REJECTED",
            Self::Full => "PROVIDER_ACTION_INVALID",
        })
    }
}
impl std::error::Error for CacheError {}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredAccount {
    pub id: String,
    pub adapter: Option<String>,
    pub provider: String,
    pub alias: String,
    pub plan: Option<String>,
    pub quota: Option<Value>,
    pub last_attempt: Option<String>,
    pub error_code: Option<String>,
    pub next_refresh_at: Option<String>,
    pub sealed_credential: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cache {
    schema_version: String,
    accounts: Vec<StoredAccount>,
    experimental_enabled: bool,
}

pub struct AccountCache {
    file: PathBuf,
    pub accounts: Vec<StoredAccount>,
    pub experimental_enabled: bool,
    pub recovered: Option<Value>,
    writable: bool,
}

impl AccountCache {
    pub fn open(root: &Path) -> Self {
        let file = root.join("quota-accounts.json");
        let mut result = Self {
            file,
            accounts: Vec::new(),
            recovered: None,
            experimental_enabled: false,
            writable: true,
        };
        match read_bounded(&result.file, STORAGE_LIMIT) {
            Ok(None) => {}
            Ok(Some(bytes)) => match decode_cache(&bytes) {
                Ok(cache) => {
                    result.accounts = cache.accounts;
                    result.experimental_enabled = cache.experimental_enabled;
                }
                Err(_) => {
                    let target = root.join("quarantine");
                    let recovery = tempfile::Builder::new()
                        .prefix("quota-cache-")
                        .tempdir_in(&target)
                        .or_else(|error| {
                            if error.kind() != io::ErrorKind::NotFound {
                                return Err(error);
                            }
                            fs::create_dir_all(&target)?;
                            tempfile::Builder::new()
                                .prefix("quota-cache-")
                                .tempdir_in(&target)
                        })
                        .and_then(|directory| {
                            fs::rename(&result.file, directory.path().join("quota-accounts.json"))?;
                            Ok(directory.keep())
                        });
                    result.writable = recovery.is_ok();
                    let quarantined = recovery.ok().and_then(|directory| {
                        Some(format!(
                            "quarantine/{}/quota-accounts.json",
                            directory.file_name()?.to_str()?
                        ))
                    });
                    result.recovered = Some(json!({"file":"quota-accounts.json",
                        "quarantined":quarantined,
                        "code": if result.writable { "QUOTA_CACHE_INVALID" } else { "QUARANTINE_FAILED" }}));
                }
            },
            Err(_) => {
                result.writable = false;
                result.recovered = Some(
                    json!({"file":"quota-accounts.json","quarantined":null,"code":"QUARANTINE_FAILED"}),
                );
            }
        }
        result
    }

    pub fn save(
        &self,
        accounts: &[StoredAccount],
        experimental_enabled: bool,
    ) -> Result<(), CacheError> {
        if !self.writable {
            return Err(CacheError::Invalid);
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Output<'a> {
            schema_version: &'static str,
            accounts: &'a [StoredAccount],
            experimental_enabled: bool,
        }
        let bytes = serde_json::to_vec(&Output {
            schema_version: "QuotaAccountsV1",
            accounts,
            experimental_enabled,
        })
        .map_err(|_| CacheError::Storage)?;
        if bytes.len() > STORAGE_LIMIT {
            return Err(CacheError::Storage);
        }
        let parent = self.file.parent().ok_or(CacheError::Storage)?;
        let save = || -> io::Result<()> {
            fs::create_dir_all(parent)?;
            let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
            temporary.write_all(&bytes)?;
            temporary.as_file().sync_all()?;
            temporary.persist(&self.file).map_err(|error| error.error)?;
            Ok(())
        };
        save().map_err(|_| CacheError::Storage)
    }
}

fn decode_cache(bytes: &[u8]) -> Result<Cache, CacheError> {
    let mut cache: Cache = serde_json::from_slice(bytes).map_err(|_| CacheError::Invalid)?;
    if cache.schema_version != "QuotaAccountsV1" {
        return Err(CacheError::Invalid);
    }
    check_accounts(&cache.accounts)?;
    for account in &mut cache.accounts {
        if let Some(quota) = &account.quota {
            account.quota = Some(
                project_resources(quota)
                    .filter(|quota| quota["provider"] == account.provider)
                    .ok_or(CacheError::Invalid)?,
            );
        }
        account.error_code = account.error_code.take().filter(|code| safe_code(code));
    }
    Ok(cache)
}

pub(crate) fn check_accounts(accounts: &[StoredAccount]) -> Result<(), CacheError> {
    let codex = accounts
        .iter()
        .filter(|account| account.adapter.is_none())
        .count();
    if codex > ACCOUNT_LIMIT || accounts.len().saturating_sub(codex) > ACCOUNT_LIMIT {
        return Err(CacheError::Full);
    }
    let routes = routes().map_err(|_| CacheError::Invalid)?;
    let mut ids = HashSet::new();
    for account in accounts {
        let route_valid = match &account.adapter {
            Some(adapter) => routes.get(adapter).is_some_and(|route| {
                route["provider"] == account.provider
                    && (route["kind"] != "passive" || account.sealed_credential.is_none())
            }),
            None => account.provider == "codex" && account.sealed_credential.is_none(),
        };
        if !valid_id(&account.id)
            || !ids.insert(&account.id)
            || !route_valid
            || !valid_alias(
                &account.alias,
                if account.adapter.is_some() { 48 } else { 160 },
            )
            || account
                .sealed_credential
                .as_ref()
                .is_some_and(|blob| blob.is_empty() || blob.len() > SECRET_LIMIT)
        {
            return Err(CacheError::Invalid);
        }
    }
    Ok(())
}

pub(crate) fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value) || value == b'-')
}

pub(crate) fn valid_alias(alias: &str, length: usize) -> bool {
    alias.encode_utf16().count() <= length && !alias.bytes().any(|byte| byte < 0x20)
}

fn safe_code(code: &str) -> bool {
    code.len() <= 64
        && (code.starts_with("PROVIDER_")
            || code.starts_with("CODEX_")
            || matches!(code, "RATE_LIMITED" | "CANCELED"))
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

/// The caller supplies an explicitly selected app-owned Electron directory.
pub fn legacy_accounts(root: &Path) -> Result<Vec<StoredAccount>, CacheError> {
    if !root.is_absolute() || !root.is_dir() {
        return Err(CacheError::Profile);
    }
    #[cfg(windows)]
    if !matches!(root.components().next(), Some(std::path::Component::Prefix(prefix))
        if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err(CacheError::Profile);
    }
    let codex = read_legacy_json(&root.join("quota-cache.json"), 16 * 1024 * 1024)?;
    let providers = read_legacy_json(
        &root.join("provider-quotas/connections.json"),
        4 * 1024 * 1024,
    )?;
    if codex.is_none() && providers.is_none() {
        return Err(CacheError::Profile);
    }
    let mut accounts = Vec::new();
    if let Some(value) = codex {
        if value.get("schemaVersion").is_some() && value["schemaVersion"] != "QuotaCacheV2" {
            return Err(CacheError::Invalid);
        }
        let rows = value["accounts"]
            .as_array()
            .filter(|rows| rows.len() <= ACCOUNT_LIMIT)
            .ok_or(CacheError::Invalid)?;
        for row in rows {
            let Some(id) = row["id"].as_str().filter(|id| valid_id(id)) else {
                continue;
            };
            if row["provider"] != "codex" {
                continue;
            }
            let saved = row
                .get("resourceQuota")
                .filter(|quota| !quota.is_null())
                .unwrap_or(&row["quota"]);
            let quota = (!saved.is_null())
                .then(|| {
                    codex_resources::restore_quota(saved, &row["plan"]).ok_or(CacheError::Invalid)
                })
                .transpose()?;
            accounts.push(StoredAccount {
                id: id.to_owned(),
                adapter: None,
                provider: "codex".to_owned(),
                alias: row["alias"]
                    .as_str()
                    .filter(|alias| valid_alias(alias, 160))
                    .unwrap_or("Codex 账号")
                    .to_owned(),
                plan: row["plan"]
                    .as_str()
                    .filter(|plan| plan.encode_utf16().count() <= 160)
                    .map(str::to_owned),
                quota,
                last_attempt: instant(&row["lastAttempt"]),
                error_code: row["errorCode"]
                    .as_str()
                    .filter(|code| safe_code(code))
                    .map(str::to_owned),
                next_refresh_at: instant(&row["nextRefreshAt"]),
                sealed_credential: None,
            });
        }
    }
    if let Some(value) = providers {
        if value["schemaVersion"] != "ProviderQuotaCacheV1" {
            return Err(CacheError::Invalid);
        }
        let rows = value["connections"]
            .as_array()
            .filter(|rows| rows.len() <= ACCOUNT_LIMIT)
            .ok_or(CacheError::Invalid)?;
        let routes = routes().map_err(|_| CacheError::Invalid)?;
        for row in rows {
            let adapter = row["adapter"].as_str().ok_or(CacheError::Invalid)?;
            let provider = routes
                .get(adapter)
                .and_then(|route| route["provider"].as_str())
                .ok_or(CacheError::Invalid)?;
            let quota = match row.get("quota") {
                Some(Value::Null) => None,
                Some(quota) => Some(
                    project_resources(quota)
                        .filter(|quota| quota["provider"] == provider)
                        .ok_or(CacheError::Invalid)?,
                ),
                None => return Err(CacheError::Invalid),
            };
            accounts.push(StoredAccount {
                id: row["id"].as_str().ok_or(CacheError::Invalid)?.to_owned(),
                adapter: Some(adapter.to_owned()),
                provider: provider.to_owned(),
                alias: row["alias"].as_str().ok_or(CacheError::Invalid)?.to_owned(),
                plan: None,
                quota,
                last_attempt: None,
                error_code: None,
                next_refresh_at: None,
                sealed_credential: None,
            });
        }
    }
    check_accounts(&accounts)?;
    Ok(accounts)
}

fn read_legacy_json(file: &Path, limit: usize) -> Result<Option<Value>, CacheError> {
    read_bounded(file, limit)
        .map_err(|_| CacheError::Profile)?
        .map(|bytes| serde_json::from_slice(&bytes).map_err(|_| CacheError::Invalid))
        .transpose()
}

pub(crate) fn read_bounded(file: &Path, limit: usize) -> io::Result<Option<Vec<u8>>> {
    for path in file.ancestors().filter(|part| !part.as_os_str().is_empty()) {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if metadata.file_type().is_symlink() {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err(io::ErrorKind::PermissionDenied.into());
            }
        }
    }
    let handle = match File::open(file) {
        Ok(handle) => handle,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let metadata = handle.metadata()?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut bytes = Vec::new();
    handle.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(io::ErrorKind::InvalidData.into());
    }
    Ok(Some(bytes))
}
