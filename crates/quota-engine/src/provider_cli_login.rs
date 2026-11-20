use crate::{
    account_cache::read_bounded,
    account_service::AccountError,
    agent_runtime::{self, Environment},
    provider_vault::{wipe, Secret},
    windows_job::{ExecutablePin, JobError, JobProcess, StartOptions},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use usage_engine::time::{iso_from_ms, now_ms};
use zeroize::Zeroizing;

const CLAUDE_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

fn authorization(raw: &Value, home_id: &str) -> Result<Secret, AccountError> {
    let auth = &raw["claudeAiOauth"];
    if auth["scopes"]
        .as_array()
        .is_some_and(|scopes| !scopes.iter().any(|scope| scope == "user:profile"))
    {
        return Err(AccountError::AuthRequired);
    }
    let expires = auth["expiresAt"].as_i64().filter(|at| {
        (0..=8_640_000_000_000_000).contains(at) && *at > now_ms().saturating_add(30_000)
    });
    if expires.is_none() && !auth["expiresAt"].is_null() {
        return Err(AccountError::AuthRequired);
    }
    let expires_at = expires.map(iso_from_ms);
    let token = auth["accessToken"]
        .as_str()
        .ok_or(AccountError::AuthRequired)?;
    let mut context = json!({"clientHome":home_id});
    if let (Some(refresh), Some(at)) = (auth["refreshToken"].as_str(), &expires_at) {
        context["oauth"] =
            json!({"clientId":CLAUDE_CLIENT_ID,"refreshToken":refresh,"expiresAt":at});
    }
    Secret::new("claude-oauth", token, context, expires_at).map_err(|_| AccountError::AuthRequired)
}

fn input_path(root: &Path) -> Result<PathBuf, AccountError> {
    let candidates = agent_runtime::discover("claude", &Environment::current())
        .map_err(|_| AccountError::ClientUnavailable)?
        .entries
        .into_iter()
        .filter(|entry| entry.kind == "executable")
        .map(|entry| PathBuf::from(entry.path))
        .filter(|path| {
            path.file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("claude.exe"))
        })
        .collect::<BTreeSet<_>>();
    if candidates.len() != 1 {
        return Err(AccountError::ClientUnavailable);
    }
    // Caller supplies only the application's own profile.
    if !root.is_absolute() {
        return Err(AccountError::Action);
    }
    candidates
        .into_iter()
        .next()
        .ok_or(AccountError::ClientUnavailable)
}

fn job_failure(error: JobError) -> AccountError {
    match error {
        JobError::Canceled => AccountError::Canceled,
        JobError::TimedOut => AccountError::LoginTimeout,
        _ => AccountError::ClientUnavailable,
    }
}

pub fn claude(root: &Path, canceled: impl Fn() -> bool) -> Result<Secret, AccountError> {
    if canceled() {
        return Err(AccountError::Canceled);
    }
    let executable = input_path(root)?;
    let pin = ExecutablePin::new(&executable).map_err(job_failure)?;
    let (profile, mut environment) = isolated_home(root, "claude-login-")?;
    let home = profile.path();
    environment.extend([
        (
            "CLAUDE_CONFIG_DIR".into(),
            home.join(".claude").into_os_string(),
        ),
        ("DISABLE_AUTOUPDATER".into(), "1".into()),
        ("DISABLE_TELEMETRY".into(), "1".into()),
        ("DISABLE_ERROR_REPORTING".into(), "1".into()),
    ]);
    let version = JobProcess::run(
        &pin,
        StartOptions {
            cwd: home,
            arguments: &["--version".into()],
            environment: &environment,
        },
        Duration::from_secs(10),
        16_384,
        &canceled,
    )
    .map_err(job_failure)?;
    if version.code != 0 {
        return Err(AccountError::ClientUnavailable);
    }
    let mut login = JobProcess::run(
        &pin,
        StartOptions {
            cwd: home,
            arguments: &["auth".into(), "login".into(), "--claudeai".into()],
            environment: &environment,
        },
        Duration::from_secs(600),
        512 * 1024,
        &canceled,
    )
    .map_err(job_failure)?;
    use zeroize::Zeroize;
    login.stdout.zeroize();
    if canceled() {
        return Err(AccountError::Canceled);
    }
    if login.code != 0 {
        return Err(AccountError::LoginFailed);
    }
    let bytes = Zeroizing::new(
        read_bounded(&home.join(".claude/.credentials.json"), 256 * 1024)
            .map_err(|_| AccountError::AuthRequired)?
            .ok_or(AccountError::AuthRequired)?,
    );
    let mut raw = serde_json::from_slice::<Value>(&bytes).map_err(|_| AccountError::Response)?;
    // This identifier records that the grant came from an app-owned CLI session.
    // Renewal uses the DPAPI-sealed token and needs no files from this home.
    let result = authorization(&raw, &uuid::Uuid::new_v4().to_string());
    wipe(&mut raw);
    drop(bytes);
    profile.close().map_err(|_| AccountError::Unavailable)?;
    result
}

pub(super) fn isolated_home(
    root: &Path,
    prefix: &str,
) -> Result<(tempfile::TempDir, BTreeMap<OsString, OsString>), AccountError> {
    check_root(root)?;
    let profile = tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(root)
        .map_err(|_| AccountError::Unavailable)?;
    let home = profile.path();
    let roamed = home.join("AppData/Roaming");
    let local = home.join("AppData/Local");
    for dir in [&roamed, &local] {
        fs::create_dir_all(dir).map_err(|_| AccountError::Unavailable)?;
    }
    let system = std::env::var_os("SystemRoot").ok_or(AccountError::ClientUnavailable)?;
    let environment: BTreeMap<OsString, OsString> = [
        ("SystemRoot", system.clone()),
        ("WINDIR", system.clone()),
        ("HOME", home.as_os_str().to_owned()),
        ("USERPROFILE", home.as_os_str().to_owned()),
        ("APPDATA", roamed.into_os_string()),
        ("LOCALAPPDATA", local.into_os_string()),
        ("TEMP", home.as_os_str().to_owned()),
        ("TMP", home.as_os_str().to_owned()),
        (
            "PATH",
            PathBuf::from(system).join("System32").into_os_string(),
        ),
    ]
    .into_iter()
    .map(|(key, value)| (key.into(), value))
    .collect();
    Ok((profile, environment))
}

fn check_root(root: &Path) -> Result<(), AccountError> {
    use std::os::windows::fs::MetadataExt;
    if !root.is_absolute() {
        return Err(AccountError::Action);
    }
    for part in root.ancestors() {
        match fs::symlink_metadata(part) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_attributes() & 0x400 != 0 => {
                return Err(AccountError::Unavailable);
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(AccountError::Unavailable),
        }
    }
    fs::create_dir_all(root).map_err(|_| AccountError::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_owned_profile_grant_with_profile_scope_is_renewable() -> Result<(), AccountError> {
        let raw = json!({"claudeAiOauth":{"accessToken":"synthetic-bearer","refreshToken":"synthetic-renewal",
            "expiresAt":now_ms() + 120_000,"scopes":["user:profile"],"private":"not-kept"}});
        let id = "44444444-2222-4333-8444-555555555555";
        let secret = authorization(&raw, id)?;
        assert!(secret.can_renew("claude-oauth"));
        assert!(!secret.context.to_string().contains("not-kept"));
        let mut wrong = raw;
        wrong["claudeAiOauth"]["scopes"] = json!(["user:inference"]);
        assert!(authorization(&wrong, id).is_err());
        Ok(())
    }
}
