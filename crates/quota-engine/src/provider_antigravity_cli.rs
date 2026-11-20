use crate::{
    account_cache::read_bounded,
    account_service::{AccountError, ReadResult},
    agent_install_engine::active_runtime,
    agent_runtime::{discover_antigravity, Environment},
    antigravity_resources::{from_antigravity, is_reviewed_version, CliError},
    provider_adapters::AdapterError,
    provider_cli_login::isolated_home,
    provider_http::ProviderHttpError,
    provider_observation::{Observation, ObservationError},
    provider_vault::{wipe, Secret},
    windows_job::{ExecutablePin, JobError, JobProcess, StartOptions},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::OsString,
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
    time::Duration,
};
use usage_engine::time::{iso_from_ms, now_ms};
use zeroize::Zeroizing;

pub(crate) const ADAPTER: &str = "antigravity-cli";
pub(crate) const PROFILE_CONTEXT: &str = "antigravityProfile";
const CREDENTIAL_FILE: &str = ".gemini/antigravity-cli/antigravity-oauth-token";
const MAX_AUTH_BYTES: usize = 12 * 1024;
const MAX_OUTPUT_BYTES: usize = 512 * 1024;

struct Invocation {
    pin: ExecutablePin,
    profile: tempfile::TempDir,
    environment: BTreeMap<OsString, OsString>,
}

impl Invocation {
    fn new(root: &Path, tools: &Path, canceled: &impl Fn() -> bool) -> Result<Self, AccountError> {
        if canceled() {
            return Err(AccountError::Canceled);
        }
        let pin = executable(tools)?;
        let (profile, mut environment) = isolated_home(root, "agy-login-")?;
        environment.extend([
            (
                "GEMINI_CLI_HOME".into(),
                profile.path().as_os_str().to_owned(),
            ),
            ("SSH_TTY".into(), "agentusage-scoped".into()),
            ("AGY_CLI_DISABLE_AUTO_UPDATE".into(), "true".into()),
        ]);
        Ok(Self {
            pin,
            profile,
            environment,
        })
    }

    fn options<'a>(&'a self, args: &'a [OsString]) -> StartOptions<'a> {
        StartOptions {
            cwd: self.profile.path(),
            arguments: args,
            environment: &self.environment,
        }
    }

    fn version(&self, canceled: &impl Fn() -> bool) -> Result<Zeroizing<String>, ObservationError> {
        let result = JobProcess::run(
            &self.pin,
            self.options(&["--version".into()]),
            Duration::from_secs(5),
            MAX_OUTPUT_BYTES,
            canceled,
        )
        .map_err(job_error)?;
        let stdout = Zeroizing::new(result.stdout);
        let version = std::str::from_utf8(&stdout)
            .ok()
            .filter(|version| is_reviewed_version(version))
            .filter(|_| result.code == 0)
            .ok_or(ObservationError::ClientUnsupported)?;
        Ok(Zeroizing::new(version.to_owned()))
    }

    fn report(
        &self,
        version: &str,
        canceled: &impl Fn() -> bool,
    ) -> Result<Value, ObservationError> {
        let output = JobProcess::run(
            &self.pin,
            self.options(
                &[
                    "-p",
                    "/usage",
                    "--output-format",
                    "json",
                    "--print-timeout",
                    "20s",
                ]
                .map(OsString::from),
            ),
            Duration::from_secs(30),
            MAX_OUTPUT_BYTES,
            canceled,
        )
        .map_err(job_error)?;
        let bytes = Zeroizing::new(output.stdout);
        let stdout = std::str::from_utf8(&bytes).map_err(|_| ProviderHttpError::ResponseInvalid)?;
        let quota = from_antigravity(stdout, &json!(iso_from_ms(now_ms())), version)
            .map_err(report_error)?;
        if output.code != 0 {
            return Err(ProviderHttpError::RequestFailed.into());
        }
        Ok(quota)
    }

    fn close(self) -> Result<(), AccountError> {
        self.profile.close().map_err(|_| AccountError::Unavailable)
    }
}

fn executable(tools: &Path) -> Result<ExecutablePin, AccountError> {
    if let Some(runtime) = active_runtime(tools, "antigravity") {
        if runtime.js
            || !runtime
                .executable
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("agy.exe"))
        {
            return Err(AccountError::ClientUnavailable);
        }
        return ExecutablePin::from_sha256(&runtime.executable, &runtime.executable_hash)
            .map_err(|_| AccountError::ClientUnavailable);
    }
    let catalog = discover_antigravity(&Environment::current());
    let candidates: BTreeSet<_> = catalog["candidates"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry["executable"].as_str())
        .map(PathBuf::from)
        .collect();
    if candidates.len() != 1 {
        return Err(AccountError::ClientUnavailable);
    }
    let path = candidates.first().ok_or(AccountError::ClientUnavailable)?;
    ExecutablePin::new(path).map_err(|_| AccountError::ClientUnavailable)
}

pub(crate) fn profile_access_token(profile: &Value) -> Option<&str> {
    profile["token"]["access_token"].as_str().filter(|token| {
        (8..=MAX_AUTH_BYTES).contains(&token.len())
            && token.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    })
}

fn seal_input(home: &Path) -> Result<Secret, AccountError> {
    let bytes = Zeroizing::new(
        read_bounded(&home.join(CREDENTIAL_FILE), MAX_AUTH_BYTES)
            .map_err(|_| AccountError::AuthRequired)?
            .ok_or(AccountError::AuthRequired)?,
    );
    let mut profile: Value = serde_json::from_slice(&bytes).map_err(|_| AccountError::Response)?;
    let Some(token) = profile_access_token(&profile).map(|token| Zeroizing::new(token.to_owned()))
    else {
        wipe(&mut profile);
        return Err(AccountError::AuthRequired);
    };
    Secret::new(ADAPTER, &token, json!({(PROFILE_CONTEXT):profile}), None).map_err(Into::into)
}

fn restore(home: &Path, secret: &Secret) -> Result<(), ObservationError> {
    let profile = &secret.context[PROFILE_CONTEXT];
    if profile_access_token(profile) != Some(secret.credential.as_str()) {
        return Err(ProviderHttpError::AuthRequired.into());
    }
    let path = home.join(CREDENTIAL_FILE);
    fs::create_dir_all(path.parent().ok_or(ProviderHttpError::ActionInvalid)?)
        .map_err(|_| ProviderHttpError::RequestFailed)?;
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| ProviderHttpError::RequestFailed)?;
    serde_json::to_writer(file, profile).map_err(|_| ProviderHttpError::RequestFailed)?;
    Ok(())
}

fn job_error(error: JobError) -> ObservationError {
    match error {
        JobError::Canceled => ProviderHttpError::Canceled.into(),
        JobError::TimedOut => ProviderHttpError::Timeout.into(),
        JobError::OutputLimit => ProviderHttpError::OutputLimit.into(),
        JobError::Invalid | JobError::BinaryUnavailable | JobError::BinaryChanged => {
            ObservationError::ClientUnsupported
        }
        JobError::HostUnavailable | JobError::CleanupUnconfirmed => {
            ProviderHttpError::RequestFailed.into()
        }
    }
}

fn report_error(error: CliError) -> ObservationError {
    match error {
        CliError::VersionUnsupported => ObservationError::ClientUnsupported,
        CliError::OutputLimit => ProviderHttpError::OutputLimit.into(),
        CliError::ModelTurnDetected | CliError::NoTurnUnverified | CliError::ProtocolInvalid => {
            AdapterError::InvalidResponse.into()
        }
        CliError::RequestFailed => ProviderHttpError::RequestFailed.into(),
    }
}

fn output(resources: Value, renewed: Option<Secret>) -> ReadResult {
    ReadResult {
        observation: Observation {
            resources,
            identity_context: None,
        },
        renewed,
    }
}

pub fn login(
    root: &Path,
    tools: &Path,
    canceled: impl Fn() -> bool,
) -> Result<(Secret, ReadResult), AccountError> {
    let run = Invocation::new(root, tools, &canceled)?;
    let result = (|| {
        let version = run.version(&canceled).map_err(AccountError::Observation)?;
        let code = JobProcess::run_console(
            &run.pin,
            run.options(&[]),
            Duration::from_secs(600),
            &canceled,
        )
        .map_err(|error| match error {
            JobError::Canceled => AccountError::Canceled,
            JobError::TimedOut => AccountError::LoginTimeout,
            _ => AccountError::Observation(job_error(error)),
        })?;
        if code != 0 {
            return Err(AccountError::LoginFailed);
        }
        // Confirm the interactive login wrote its own grant before running /usage.
        drop(seal_input(run.profile.path())?);
        let resources = run
            .report(&version, &canceled)
            .map_err(AccountError::Observation)?;
        if canceled() {
            return Err(AccountError::Canceled);
        }
        let secret = seal_input(run.profile.path())?;
        Ok((secret, output(resources, None)))
    })();
    run.close()?;
    result
}

pub fn observe(
    root: &Path,
    tools: &Path,
    current: &Secret,
    canceled: impl Fn() -> bool,
) -> Result<ReadResult, ObservationError> {
    let run = Invocation::new(root, tools, &canceled).map_err(|error| match error {
        AccountError::ClientUnavailable => ObservationError::ClientUnsupported,
        AccountError::Canceled => ProviderHttpError::Canceled.into(),
        _ => ProviderHttpError::RequestFailed.into(),
    })?;
    let result = (|| {
        let version = run.version(&canceled)?;
        restore(run.profile.path(), current)?;
        let resources = run.report(&version, &canceled)?;
        if canceled() {
            return Err(ProviderHttpError::Canceled.into());
        }
        let fresh = seal_input(run.profile.path()).map_err(|_| ProviderHttpError::AuthRequired)?;
        let rotated = (fresh.context != current.context).then_some(fresh);
        Ok(output(resources, rotated))
    })();
    run.close().map_err(|_| ProviderHttpError::RequestFailed)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider_vault::{open, seal};

    #[test]
    fn only_an_app_owned_grant_round_trips_through_dpapi_and_a_removed_profile(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let (profile, _) = isolated_home(root.path(), "agy-login-")?;
        let home = profile.path().to_owned();
        let file = home.join(CREDENTIAL_FILE);
        fs::create_dir_all(
            file.parent()
                .ok_or(std::io::Error::other("credential directory"))?,
        )?;
        fs::write(&file, br#"{"token":{"access_token":"synthetic-access","refresh_token":"synthetic-refresh","expiry":"9999-12-31T00:00:00Z"}}"#)?;
        let secret = seal_input(&home)?;
        let id = "12345678-1234-1234-1234-123456789abc";
        let sealed = seal(id, ADAPTER, &secret)?;
        assert!(!sealed
            .windows(b"synthetic-access".len())
            .any(|bytes| bytes == b"synthetic-access"));
        profile.close()?;
        assert!(!home.exists());
        let (restored, _) = isolated_home(root.path(), "agy-login-")?;
        let opened = open(id, ADAPTER, &sealed)?;
        restore(restored.path(), &opened)?;
        let restored_secret = seal_input(restored.path())?;
        assert_eq!(restored_secret.context, secret.context);
        let marker = Secret::new(ADAPTER, "official-owned-login", Value::Null, None)?;
        assert!(matches!(
            restore(restored.path(), &marker),
            Err(ObservationError::Http(ProviderHttpError::AuthRequired))
        ));
        restored.close()?;
        Ok(())
    }
}
