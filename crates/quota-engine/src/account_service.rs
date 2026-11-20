use crate::{
    account_cache::{
        check_accounts, legacy_accounts, valid_alias, AccountCache, CacheError, StoredAccount,
    },
    codex_resources,
    connection_identities::ConnectionIdentities,
    provider_catalog::{capabilities, experimental, routes},
    provider_observation::{Observation, ObservationError},
    provider_vault::{self, Secret},
    refresh_scheduler::{Limits, RefreshPermit, RefreshScheduler, Scope},
    resource_contract::project_resources,
    resource_state::{date_millis, resource_view},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fmt,
    future::Future,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};
use tokio::sync::{watch, Notify};
use usage_engine::time::{iso_from_ms, now_ms};
use zeroize::Zeroizing;

#[derive(Debug)]
pub enum AccountError {
    Cache(CacheError),
    Vault(provider_vault::VaultError),
    Observation(ObservationError),
    Action,
    NotFound,
    ExperimentalOff,
    ClientUnavailable,
    LoginFailed,
    LoginTimeout,
    LoginBusy,
    BrowserFailed,
    FixtureBlocked,
    Canceled,
    AuthRequired,
    Unavailable,
    Response,
}

impl fmt::Display for AccountError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cache(error) => error.fmt(formatter),
            Self::Vault(error) => error.fmt(formatter),
            Self::Observation(error) => error.fmt(formatter),
            Self::Action => formatter.write_str("PROVIDER_ACTION_INVALID"),
            Self::NotFound => formatter.write_str("ACCOUNT_NOT_FOUND"),
            Self::ExperimentalOff => formatter.write_str("PROVIDER_EXPERIMENTAL_OFF"),
            Self::ClientUnavailable => formatter.write_str("PROVIDER_CLIENT_MISSING"),
            Self::LoginFailed => formatter.write_str("PROVIDER_LOGIN_FAILED"),
            Self::LoginTimeout => formatter.write_str("PROVIDER_LOGIN_TIMEOUT"),
            Self::LoginBusy => formatter.write_str("PROVIDER_LOGIN_BUSY"),
            Self::BrowserFailed => formatter.write_str("PROVIDER_BROWSER_FAILED"),
            Self::FixtureBlocked => formatter.write_str("PROVIDER_FIXTURE_BLOCKED"),
            Self::Canceled => formatter.write_str("PROVIDER_CANCELED"),
            Self::AuthRequired => formatter.write_str("PROVIDER_AUTH_REQUIRED"),
            Self::Unavailable => formatter.write_str("PROVIDER_STORAGE_FAILED"),
            Self::Response => formatter.write_str("PROVIDER_RESPONSE_INVALID"),
        }
    }
}
impl std::error::Error for AccountError {}
impl From<CacheError> for AccountError {
    fn from(error: CacheError) -> Self {
        Self::Cache(error)
    }
}
impl From<provider_vault::VaultError> for AccountError {
    fn from(error: provider_vault::VaultError) -> Self {
        Self::Vault(error)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualConnect {
    pub adapter: String,
    pub alias: String,
    pub credential: Option<String>,
    pub project: Option<String>,
    pub remember: Option<bool>,
    pub user_agent: Option<String>,
    pub organization: Option<String>,
    pub workspace: Option<String>,
}

impl Drop for ManualConnect {
    fn drop(&mut self) {
        if let Some(token) = self.credential.take() {
            drop(Zeroizing::new(token));
        }
    }
}

impl ManualConnect {
    fn secret(&self) -> Result<Secret, AccountError> {
        let scope = if let Some(project) = &self.project {
            if self.adapter != "gemini-code-assist"
                || self.user_agent.is_some()
                || self.organization.is_some()
                || self.workspace.is_some()
            {
                return Err(AccountError::Action);
            }
            json!(project)
        } else {
            let mut scope = serde_json::Map::new();
            for (name, value, allowed) in [
                (
                    "userAgent",
                    &self.user_agent,
                    self.adapter == "workbuddy-web",
                ),
                (
                    "organization",
                    &self.organization,
                    self.adapter == "claude-web",
                ),
                ("workspace", &self.workspace, self.adapter == "opencode-web"),
            ] {
                if let Some(value) = value {
                    if !allowed {
                        return Err(AccountError::Action);
                    }
                    scope.insert(name.to_owned(), json!(value));
                }
            }
            if scope.is_empty() {
                Value::Null
            } else {
                Value::Object(scope)
            }
        };
        if self.adapter == "gemini-code-assist" && self.project.is_none() {
            return Err(AccountError::Action);
        }
        Secret::new(
            &self.adapter,
            self.credential
                .as_deref()
                .ok_or(AccountError::AuthRequired)?,
            scope,
            None,
        )
        .map_err(|_| AccountError::Action)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub credentials_restored: usize,
    pub login_required: usize,
}

struct LiveCredential {
    secret: Arc<Secret>,
    remember: bool,
}

struct Job {
    sequence: u64,
    sender: watch::Sender<bool>,
}

struct Inner {
    cache: AccountCache,
    identities: ConnectionIdentities,
    credentials: HashMap<String, LiveCredential>,
    restore_failures: HashMap<String, &'static str>,
    ready: HashSet<String>,
    jobs: HashMap<String, Job>,
    sequence: u64,
    outstanding: usize,
    closed: bool,
}

pub struct AccountService {
    inner: Mutex<Inner>,
    scheduler: RefreshScheduler,
    drained: Notify,
}

struct Ticket<'a> {
    service: &'a AccountService,
    id: String,
    sequence: u64,
}

impl Drop for Ticket<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.service.inner.lock() {
            if state
                .jobs
                .get(&self.id)
                .is_some_and(|job| job.sequence == self.sequence)
            {
                state.jobs.remove(&self.id);
            }
            state.outstanding -= 1;
            if state.outstanding == 0 {
                self.service.drained.notify_waiters();
            }
        }
    }
}

pub struct ReadAccount {
    pub adapter: String,
    pub secret: Arc<Secret>,
    pub cancellation: watch::Receiver<bool>,
}

pub struct ReadResult {
    pub observation: Observation,
    pub renewed: Option<Secret>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefreshOutcome {
    Published,
    Failed,
    Skipped,
}

impl AccountService {
    pub fn open(root: &Path) -> Result<Self, AccountError> {
        let cache = AccountCache::open(root);
        let mut credentials = HashMap::new();
        let mut restore_failures = HashMap::new();
        for account in &cache.accounts {
            if let Some((adapter, blob)) = account
                .adapter
                .as_deref()
                .zip(account.sealed_credential.as_deref())
            {
                match provider_vault::open(&account.id, adapter, blob) {
                    Ok(secret)
                        if usable(&secret, adapter, now_ms())
                            && secret.credential.as_str() != "official-login-required" =>
                    {
                        credentials.insert(
                            account.id.clone(),
                            LiveCredential {
                                secret: Arc::new(secret),
                                remember: true,
                            },
                        );
                    }
                    Ok(_) => {}
                    Err(error) => {
                        restore_failures.insert(account.id.clone(), error.stage());
                    }
                }
            }
        }
        Ok(Self {
            inner: Mutex::new(Inner {
                cache,
                credentials,
                restore_failures,
                identities: ConnectionIdentities::new().map_err(|_| AccountError::Unavailable)?,
                ready: HashSet::new(),
                jobs: HashMap::new(),
                sequence: 0,
                outstanding: 0,
                closed: false,
            }),
            scheduler: RefreshScheduler::new(Limits::default())
                .map_err(|_| AccountError::Unavailable)?,
            drained: Notify::new(),
        })
    }

    fn state(&self) -> Result<MutexGuard<'_, Inner>, AccountError> {
        self.inner.lock().map_err(|_| AccountError::Unavailable)
    }

    pub fn import(&self, source: &Path, now: i64) -> Result<ImportReport, AccountError> {
        let source_accounts = legacy_accounts(source)?;
        let mut report = ImportReport {
            imported: 0,
            skipped: 0,
            credentials_restored: 0,
            login_required: 0,
        };
        let routes = routes().map_err(|_| AccountError::Unavailable)?;
        let existing: HashSet<_> = self
            .state()?
            .cache
            .accounts
            .iter()
            .map(|entry| entry.id.clone())
            .collect();
        let mut prepared = Vec::new();
        for mut account in source_accounts {
            if existing.contains(&account.id) {
                report.skipped += 1;
                continue;
            }
            let mut credential = None;
            if let Some(adapter) = account.adapter.as_deref() {
                let route = &routes[adapter];
                if route["kind"] != "passive" {
                    // The old vault reader also understands cookies for format compatibility.
                    // Product import restores portable app credentials only.
                    if route["websiteLogin"] != true && route["kind"] != "cookie" {
                        if let Ok(Some(secret)) =
                            provider_vault::import_legacy(source, &account.id, adapter)
                        {
                            if legacy_credential_portable(&secret, adapter, now) {
                                if let Ok(sealed) =
                                    provider_vault::seal(&account.id, adapter, &secret)
                                {
                                    account.sealed_credential = Some(sealed);
                                    credential = Some(secret);
                                }
                            }
                        }
                    }
                    if credential.is_none() {
                        account.error_code = Some("PROVIDER_AUTH_REQUIRED".to_owned());
                    }
                }
            }
            if account.adapter.is_none() {
                account.error_code = Some("LOGIN_REQUIRED".to_owned());
            }
            prepared.push((account, credential));
        }
        let mut state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        let first = state.cache.accounts.len();
        let mut credentials = Vec::new();
        for (account, secret) in prepared {
            if state
                .cache
                .accounts
                .iter()
                .any(|current| current.id == account.id)
            {
                report.skipped += 1;
                continue;
            }
            report.imported += 1;
            if let Some(secret) = secret {
                report.credentials_restored += 1;
                credentials.push((
                    account.id.clone(),
                    LiveCredential {
                        secret: Arc::new(secret),
                        remember: true,
                    },
                ));
            } else if account.adapter.is_none()
                || account.error_code.as_deref() == Some("PROVIDER_AUTH_REQUIRED")
            {
                report.login_required += 1;
            }
            state.cache.accounts.push(account);
        }
        if report.imported == 0 {
            return Ok(report);
        }
        if let Err(error) = check_accounts(&state.cache.accounts).and_then(|_| save(&state)) {
            state.cache.accounts.truncate(first);
            return Err(error.into());
        }
        state.credentials.extend(credentials);
        Ok(report)
    }

    pub fn set_experimental(&self, enabled: bool) -> Result<(), AccountError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        state.cache.save(&state.cache.accounts, enabled)?;
        state.cache.experimental_enabled = enabled;
        Ok(())
    }

    pub fn has_accounts(&self) -> Result<bool, AccountError> {
        Ok(!self.state()?.cache.accounts.is_empty())
    }

    pub fn read_error_code(&self, id: &str) -> Result<Option<String>, AccountError> {
        let state = self.state()?;
        Ok(state.cache.accounts[index(&state, id)?].error_code.clone())
    }

    pub fn adapter(&self, id: &str) -> Result<String, AccountError> {
        let state = self.state()?;
        state.cache.accounts[index(&state, id)?]
            .adapter
            .clone()
            .ok_or(AccountError::Action)
    }

    pub fn add_passive(&self, request: &ManualConnect) -> Result<(), AccountError> {
        let route = routes()
            .ok()
            .and_then(|routes| routes.get(&request.adapter))
            .filter(|route| route["kind"] == "passive")
            .ok_or(AccountError::Action)?;
        if request.credential.is_some()
            || request.project.is_some()
            || request.user_agent.is_some()
            || request.organization.is_some()
            || request.workspace.is_some()
            || request.remember == Some(true)
        {
            return Err(AccountError::Action);
        }
        let account = new_provider_account(&request.adapter, &request.alias, route)?;
        let mut state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        state.cache.accounts.push(account);
        if let Err(error) = check_accounts(&state.cache.accounts).and_then(|_| save(&state)) {
            state.cache.accounts.pop();
            return Err(error.into());
        }
        Ok(())
    }

    pub fn refresh_passive(&self, root: &Path, id: &str) -> Result<bool, AccountError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        let index = index(&state, id)?;
        let account = &state.cache.accounts[index];
        if !matches!(
            account.adapter.as_deref(),
            Some("claude-statusline" | "antigravity-statusline")
        ) {
            return Err(AccountError::Action);
        }
        let Some(quota) = crate::provider_passive::observation(root, id, &account.provider)
            .map_err(|_| AccountError::Response)?
        else {
            return Ok(false);
        };
        if account.quota.as_ref() == Some(&quota) {
            return Ok(false);
        }
        let fetched = date_millis(&quota["fetchedAt"]).ok_or(AccountError::Response)?;
        if fetched > now_ms().saturating_add(60_000)
            || account
                .quota
                .as_ref()
                .and_then(|previous| date_millis(&previous["fetchedAt"]))
                .is_some_and(|previous| previous >= fetched)
        {
            return Err(AccountError::Response);
        }
        let mut updated = account.clone();
        updated.last_attempt = Some(iso_from_ms(fetched));
        updated.quota = Some(quota);
        updated.error_code = None;
        let old = std::mem::replace(&mut state.cache.accounts[index], updated);
        if let Err(error) = save(&state) {
            state.cache.accounts[index] = old;
            return Err(error.into());
        }
        state.ready.insert(id.to_owned());
        Ok(true)
    }

    pub fn passive_ids(&self) -> Result<Vec<String>, AccountError> {
        Ok(self
            .state()?
            .cache
            .accounts
            .iter()
            .filter(|row| {
                matches!(
                    row.adapter.as_deref(),
                    Some("claude-statusline" | "antigravity-statusline")
                )
            })
            .map(|row| row.id.clone())
            .collect())
    }

    pub async fn connect<F, Fut>(&self, request: ManualConnect, run: F) -> Result<(), AccountError>
    where
        F: FnOnce(ReadAccount) -> Fut,
        Fut: Future<Output = Result<ReadResult, ObservationError>>,
    {
        let route = routes()
            .ok()
            .and_then(|routes| routes.get(&request.adapter))
            .filter(|route| route["url"].is_string() && route["clientOnly"] != true)
            .ok_or(AccountError::Action)?;
        let account = new_provider_account(&request.adapter, &request.alias, route)?;
        let secret = Arc::new(request.secret()?);
        let (ticket, cancellation) = {
            let mut state = self.state()?;
            if experimental(route) && !state.cache.experimental_enabled {
                return Err(AccountError::ExperimentalOff);
            }
            if state
                .cache
                .accounts
                .iter()
                .filter(|entry| entry.adapter.is_some())
                .count()
                >= 20
            {
                return Err(AccountError::Action);
            }
            self.begin(&mut state, &account.id)?
        };
        self.read_and_commit(
            account,
            secret,
            request.remember == Some(true),
            ticket,
            cancellation,
            Mode::Connect,
            run,
        )
        .await
        .map(|_| ())
    }

    fn login_target(
        state: &Inner,
        adapter: &str,
        alias: &str,
        id: Option<&str>,
        capability: &str,
    ) -> Result<StoredAccount, AccountError> {
        if state.closed {
            return Err(AccountError::Canceled);
        }
        let route = routes()
            .ok()
            .and_then(|routes| routes.get(adapter))
            .filter(|route| route[capability] == true)
            .ok_or(AccountError::Action)?;
        if experimental(route) && !state.cache.experimental_enabled {
            return Err(AccountError::ExperimentalOff);
        }
        if let Some(id) = id {
            let existing = &state.cache.accounts[index(state, id)?];
            if existing.adapter.as_deref() != Some(adapter) || state.jobs.contains_key(id) {
                return Err(AccountError::Action);
            }
            Ok(existing.clone())
        } else {
            if state
                .cache
                .accounts
                .iter()
                .filter(|account| account.adapter.is_some())
                .count()
                >= 20
            {
                return Err(AccountError::Action);
            }
            new_provider_account(adapter, alias, route)
        }
    }

    pub fn check_login(
        &self,
        adapter: &str,
        alias: &str,
        id: Option<&str>,
        client: bool,
    ) -> Result<(), AccountError> {
        if alias.trim().is_empty() || !valid_alias(alias, 48) {
            return Err(AccountError::Action);
        }
        let state = self.state()?;
        Self::login_target(&state, adapter, alias, id, login_capability(client)).map(|_| ())
    }

    pub async fn verified_login<F, Fut>(
        &self,
        adapter: &str,
        alias: &str,
        id: Option<&str>,
        client: bool,
        secret: Secret,
        run: F,
    ) -> Result<(), AccountError>
    where
        F: FnOnce(ReadAccount) -> Fut,
        Fut: Future<Output = Result<ReadResult, ObservationError>>,
    {
        let (account, ticket, cancellation) = {
            let mut state = self.state()?;
            let account = Self::login_target(&state, adapter, alias, id, login_capability(client))?;
            let (ticket, cancellation) = self.begin(&mut state, &account.id)?;
            (account, ticket, cancellation)
        };
        let mode = if id.is_some() {
            Mode::Replace
        } else {
            Mode::Connect
        };
        self.read_and_commit(
            account,
            Arc::new(secret),
            true,
            ticket,
            cancellation,
            mode,
            run,
        )
        .await
        .map(|_| ())
    }

    pub async fn supply<F, Fut>(
        &self,
        id: &str,
        request: ManualConnect,
        run: F,
    ) -> Result<(), AccountError>
    where
        F: FnOnce(ReadAccount) -> Fut,
        Fut: Future<Output = Result<ReadResult, ObservationError>>,
    {
        let secret = Arc::new(request.secret()?);
        let (ticket, cancellation, account) = {
            let mut state = self.state()?;
            let account = state.cache.accounts[index(&state, id)?].clone();
            if account.adapter.as_deref() != Some(request.adapter.as_str()) {
                return Err(AccountError::Action);
            }
            if let Some(job) = state.jobs.remove(id) {
                let _ = job.sender.send(true);
            }
            let (ticket, cancellation) = self.begin(&mut state, id)?;
            (ticket, cancellation, account)
        };
        self.read_and_commit(
            account,
            secret,
            request.remember == Some(true),
            ticket,
            cancellation,
            Mode::Replace,
            run,
        )
        .await
        .map(|_| ())
    }

    pub async fn refresh<F, Fut>(&self, id: &str, run: F) -> Result<RefreshOutcome, AccountError>
    where
        F: FnOnce(ReadAccount) -> Fut,
        Fut: Future<Output = Result<ReadResult, ObservationError>>,
    {
        let (ticket, cancellation, account, secret, remember) = {
            let mut state = self.state()?;
            let account = &state.cache.accounts[index(&state, id)?];
            if state.jobs.contains_key(id)
                || date_millis(&json!(account.next_refresh_at)).is_some_and(|at| at > now_ms())
            {
                return Ok(RefreshOutcome::Skipped);
            }
            let auth = state
                .credentials
                .get(id)
                .filter(|value| {
                    usable(
                        &value.secret,
                        account.adapter.as_deref().unwrap_or_default(),
                        now_ms(),
                    )
                })
                .ok_or(AccountError::AuthRequired)?;
            let (secret, remember) = (Arc::clone(&auth.secret), auth.remember);
            let account = account.clone();
            let (ticket, cancellation) = self.begin(&mut state, id)?;
            (ticket, cancellation, account, secret, remember)
        };
        self.read_and_commit(
            account,
            secret,
            remember,
            ticket,
            cancellation,
            Mode::Refresh,
            run,
        )
        .await
    }

    async fn read_and_commit<F, Fut>(
        &self,
        mut account: StoredAccount,
        mut secret: Arc<Secret>,
        remember: bool,
        ticket: Ticket<'_>,
        mut cancellation: watch::Receiver<bool>,
        mode: Mode,
        run: F,
    ) -> Result<RefreshOutcome, AccountError>
    where
        F: FnOnce(ReadAccount) -> Fut,
        Fut: Future<Output = Result<ReadResult, ObservationError>>,
    {
        let adapter = account.adapter.clone().ok_or(AccountError::Action)?;
        let native_cli = adapter == crate::provider_antigravity_cli::ADAPTER;
        let permit = tokio::select! {
            biased;
            _ = cancellation.wait_for(|canceled| *canceled) => return Err(AccountError::Canceled),
            permit = self.scheduler.acquire(Scope { provider: account.provider.clone(), cli: native_cli, key: Some(account.id.clone()) }) =>
                permit.map_err(|_| AccountError::Unavailable)?,
        };
        let started = now_ms();
        let request = ReadAccount {
            adapter: adapter.clone(),
            secret: Arc::clone(&secret),
            cancellation: cancellation.clone(),
        };
        let outcome = if native_cli {
            // The local CLI consumes the same cancellation signal and owns a Job.
            // Await its cleanup before releasing the process slot or completing close.
            let outcome = run(request).await;
            if *cancellation.borrow() {
                return Err(AccountError::Canceled);
            }
            outcome
        } else {
            tokio::select! {
                biased;
                _ = cancellation.wait_for(|canceled| *canceled) => return Err(AccountError::Canceled),
                result = run(request) => result,
            }
        };
        drop(permit);
        account.last_attempt = Some(iso_from_ms(started));
        let mut evidence = None;
        let mut rotated = false;
        let success = match outcome {
            Ok(ReadResult {
                observation,
                renewed,
            }) => {
                account.quota = Some(checked_quota(&account, &observation, started)?);
                if let Some(renewed) = renewed {
                    secret = Arc::new(renewed);
                    rotated = true;
                }
                if remember
                    && (rotated || mode != Mode::Refresh || account.sealed_credential.is_none())
                {
                    account.sealed_credential =
                        Some(provider_vault::seal(&account.id, &adapter, &secret)?);
                } else if !remember {
                    account.sealed_credential = None;
                }
                account.error_code = None;
                account.next_refresh_at = None;
                evidence = observation.identity_context;
                true
            }
            Err(error) if remember && mode != Mode::Refresh => {
                return Err(AccountError::Observation(error))
            }
            Err(error) => {
                let code = error.to_string();
                let delay = if code == "PROVIDER_RATE_LIMITED" {
                    15 * 60_000
                } else {
                    60_000
                };
                account.error_code = Some(code);
                account.next_refresh_at = Some(iso_from_ms(now_ms().saturating_add(delay)));
                if mode == Mode::Replace {
                    account.sealed_credential = None;
                }
                false
            }
        };
        let rejected = matches!(
            account.error_code.as_deref(),
            Some("PROVIDER_AUTH_REQUIRED" | "PROVIDER_CLIENT_ACCOUNT_CHANGED")
        );
        if rejected {
            account.sealed_credential = None;
        }
        let mut state = self.state()?;
        if !live(&state, &ticket) {
            return Err(AccountError::Canceled);
        }
        if mode == Mode::Connect {
            state.cache.accounts.push(account);
            if let Err(error) = check_accounts(&state.cache.accounts).and_then(|_| save(&state)) {
                state.cache.accounts.pop();
                return Err(error.into());
            }
        } else {
            let index = index(&state, &ticket.id)?;
            let before = std::mem::replace(&mut state.cache.accounts[index], account);
            if let Err(error) = save(&state) {
                state.cache.accounts[index] = before;
                return Err(error.into());
            }
        }
        if rejected || mode == Mode::Replace {
            invalidate(&mut state, &ticket.id);
        }
        if !rejected && (mode != Mode::Refresh || rotated) {
            state.credentials.insert(
                ticket.id.clone(),
                LiveCredential {
                    secret: Arc::clone(&secret),
                    remember,
                },
            );
        }
        if success {
            state.ready.insert(ticket.id.clone());
            state.identities.observe(
                &ticket.id,
                &adapter,
                secret.credential.as_str(),
                evidence.as_ref().unwrap_or(&secret.context),
            );
        } else {
            state.ready.remove(&ticket.id);
        }
        Ok(if success {
            RefreshOutcome::Published
        } else {
            RefreshOutcome::Failed
        })
    }

    fn begin<'a>(
        &'a self,
        state: &mut Inner,
        id: &str,
    ) -> Result<(Ticket<'a>, watch::Receiver<bool>), AccountError> {
        if state.closed {
            return Err(AccountError::Canceled);
        }
        state.sequence = state
            .sequence
            .checked_add(1)
            .ok_or(AccountError::Unavailable)?;
        let (sender, receiver) = watch::channel(false);
        let sequence = state.sequence;
        state.jobs.insert(id.to_owned(), Job { sequence, sender });
        state.outstanding += 1;
        Ok((
            Ticket {
                service: self,
                id: id.to_owned(),
                sequence,
            },
            receiver,
        ))
    }

    pub fn cancel(&self, id: &str) -> Result<(), AccountError> {
        let mut state = self.state()?;
        index(&state, id)?;
        if let Some(job) = state.jobs.remove(id) {
            let _ = job.sender.send(true);
        }
        Ok(())
    }

    pub fn remove(&self, id: &str) -> Result<(), AccountError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        let index = index(&state, id)?;
        let account = state.cache.accounts.remove(index);
        if let Err(error) = save(&state) {
            state.cache.accounts.insert(index, account);
            return Err(error.into());
        }
        invalidate(&mut state, id);
        Ok(())
    }

    pub fn refreshable(&self) -> Result<Vec<String>, AccountError> {
        self.refreshable_ids(None)
    }

    pub fn refreshable_automatic(&self, now: i64) -> Result<Vec<String>, AccountError> {
        self.refreshable_ids(Some(now))
    }

    fn refreshable_ids(&self, automatic_at: Option<i64>) -> Result<Vec<String>, AccountError> {
        let state = self.state()?;
        Ok(state
            .cache
            .accounts
            .iter()
            .filter(|account| state.credentials.contains_key(&account.id))
            .filter(|account| {
                if account.adapter.as_deref() != Some(crate::provider_antigravity_cli::ADAPTER) {
                    return true;
                }
                automatic_at.is_none_or(|now| {
                    date_millis(&json!(account.last_attempt))
                        .is_none_or(|last| now.saturating_sub(last) >= 300_000)
                })
            })
            .map(|account| account.id.clone())
            .collect())
    }

    pub fn provider_state(&self, now: i64) -> Result<Value, AccountError> {
        let state = self.state()?;
        let accounts: Vec<_> = providers(&state, now);
        Ok(json!({"schemaVersion":"ProviderQuotaStateV1",
            "refreshConcurrency":self.scheduler.state().map_err(|_| AccountError::Unavailable)?,
            "capabilities":capabilities().map_err(|_| AccountError::Unavailable)?,
            "experimentalEnabled":state.cache.experimental_enabled,
            "cacheError":state.cache.recovered.as_ref().filter(|record| record["code"] == "QUARANTINE_FAILED").map(|_| "PROVIDER_CACHE_INVALID"),
            "cleanupError":null,"pendingWebsiteLogin":null,"accounts":accounts}))
    }

    pub fn codex_account(&self, id: &str) -> Result<String, AccountError> {
        let state = self.state()?;
        let account = &state.cache.accounts[index(&state, id)?];
        if account.adapter.is_some() {
            return Err(AccountError::NotFound);
        }
        Ok(account.alias.clone())
    }

    pub fn codex_refreshable(&self, now: i64) -> Result<Vec<String>, AccountError> {
        let state = self.state()?;
        Ok(state
            .cache
            .accounts
            .iter()
            .filter(|row| can_refresh_codex(row, now))
            .map(|entry| entry.id.clone())
            .collect())
    }

    pub fn codex_refresh_due(&self, id: &str, now: i64) -> Result<bool, AccountError> {
        let state = self.state()?;
        let row = &state.cache.accounts[index(&state, id)?];
        Ok(can_refresh_codex(row, now))
    }

    pub async fn acquire_codex_refresh(&self, id: &str) -> Result<RefreshPermit, AccountError> {
        self.scheduler
            .acquire(Scope {
                provider: "codex".to_owned(),
                cli: true,
                key: Some(id.to_owned()),
            })
            .await
            .map_err(|_| AccountError::Unavailable)
    }

    pub fn record_codex_failure(&self, id: &str, code: &str, at: i64) -> Result<(), AccountError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        let index = index(&state, id)?;
        let row = &state.cache.accounts[index];
        if row.adapter.is_some() {
            return Err(AccountError::NotFound);
        }
        let code = if crate::account_cache::safe_code(code) {
            code
        } else {
            "CODEX_REQUEST_FAILED"
        };
        let mut failed = row.clone();
        failed.error_code = Some(code.to_owned());
        failed.last_attempt = Some(iso_from_ms(at));
        let delay = if code == "RATE_LIMITED" {
            900_000
        } else {
            60_000
        };
        failed.next_refresh_at = Some(iso_from_ms(at.saturating_add(delay)));
        let before = std::mem::replace(&mut state.cache.accounts[index], failed);
        if let Err(error) = save(&state) {
            state.cache.accounts[index] = before;
            return Err(error.into());
        }
        state.ready.remove(id);
        Ok(())
    }

    pub fn can_add_codex(&self) -> Result<(), AccountError> {
        let state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        if state
            .cache
            .accounts
            .iter()
            .filter(|entry| entry.adapter.is_none())
            .count()
            >= 20
        {
            return Err(AccountError::Action);
        }
        Ok(())
    }

    pub fn publish_codex(
        &self,
        id: &str,
        alias: Option<&str>,
        quota: Value,
    ) -> Result<(), AccountError> {
        let mut state = self.state()?;
        if state.closed {
            return Err(AccountError::Canceled);
        }
        if quota["provider"] != "codex" {
            return Err(AccountError::Response);
        }
        let existing = if alias.is_none() {
            Some(index(&state, id)?)
        } else {
            None
        };
        let alias = alias
            .or_else(|| existing.map(|index| state.cache.accounts[index].alias.as_str()))
            .filter(|alias| !alias.is_empty() && valid_alias(alias, 48))
            .unwrap_or("Codex 账号");
        if existing.is_some_and(|index| state.cache.accounts[index].adapter.is_some())
            || existing.is_none() && state.cache.accounts.iter().any(|row| row.id == id)
        {
            return Err(AccountError::Action);
        }
        let row = StoredAccount {
            id: id.to_owned(),
            adapter: None,
            provider: "codex".to_owned(),
            alias: alias.to_owned(),
            plan: quota["entitlement"]["plan"].as_str().map(str::to_owned),
            last_attempt: quota["fetchedAt"].as_str().map(str::to_owned),
            quota: Some(quota),
            error_code: None,
            next_refresh_at: None,
            sealed_credential: None,
        };
        if let Some(index) = existing {
            let old = std::mem::replace(&mut state.cache.accounts[index], row);
            if let Err(error) = save(&state) {
                state.cache.accounts[index] = old;
                return Err(error.into());
            }
        } else {
            state.cache.accounts.push(row);
            if let Err(error) = check_accounts(&state.cache.accounts).and_then(|_| save(&state)) {
                state.cache.accounts.pop();
                return Err(error.into());
            }
        }
        state.ready.insert(id.to_owned());
        Ok(())
    }

    pub fn quota_state(&self, version_two: bool, now: i64) -> Result<Value, AccountError> {
        let state = self.state()?;
        let mut accounts: Vec<_> = state.cache.accounts.iter().filter(|account| account.adapter.is_none()).map(|account| {
            let status = match account.error_code.as_deref() {
                Some("LOGIN_REQUIRED") => "login-required",
                Some(_) => "error",
                None if state.ready.contains(&account.id) => "ready",
                None => "cached",
            };
            let mut view = json!({"id":account.id,"provider":"codex","alias":account.alias,"plan":account.plan,
                "status":status,"lastAttempt":account.last_attempt,"errorCode":account.error_code,
                "nextRefreshAt":account.next_refresh_at,"busy":false,"duplicateKnown":false,"duplicateAccountIds":[]});
            if version_two {
                view["identityStatus"] = json!("unknown");
                view["planMatchesObservation"] = json!(account.plan.as_deref().zip(account.quota.as_ref()
                    .and_then(|quota| quota["entitlement"]["plan"].as_str())).map(|(expected, actual)| expected == actual));
                view["quota"] = resource_view(account.quota.clone().unwrap_or_default(), &view, now);
            } else {
                view["quota"] = account.quota.as_ref().and_then(codex_resources::to_legacy).unwrap_or_default();
            }
            view
        }).collect();
        let mut result = json!({"schemaVersion":if version_two {"QuotaStateV2"} else {"QuotaStateV1"},
            "refreshConcurrency":self.scheduler.state().map_err(|_| AccountError::Unavailable)?,
            "executableAvailable":false,"autoRefresh":"off","nextAutoAt":null,
            "lastBatch":null,"lastProviderBatch":null,"operationBusy":!state.jobs.is_empty(),"recovered":state.cache.recovered,
            "pendingLogin":null});
        if version_two {
            let providers = providers(&state, now);
            accounts.extend(providers.iter().cloned());
            result["providerAccounts"] = json!(providers);
            result["providerCapabilities"] =
                json!(capabilities().map_err(|_| AccountError::Unavailable)?);
        }
        result["accounts"] = json!(accounts);
        Ok(result)
    }

    pub async fn close(&self) -> Result<(), AccountError> {
        {
            let mut state = self.state()?;
            state.closed = true;
            for (_, job) in state.jobs.drain() {
                let _ = job.sender.send(true);
            }
            state.credentials.clear();
            state.identities.clear();
        }
        loop {
            let wake = self.drained.notified();
            tokio::pin!(wake);
            wake.as_mut().enable();
            if self.state()?.outstanding == 0 {
                return Ok(());
            }
            wake.await;
        }
    }
}

fn save(state: &Inner) -> Result<(), CacheError> {
    state
        .cache
        .save(&state.cache.accounts, state.cache.experimental_enabled)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Connect,
    Refresh,
    Replace,
}

fn checked_quota(
    account: &StoredAccount,
    observation: &Observation,
    start: i64,
) -> Result<Value, AccountError> {
    let quota = project_resources(&observation.resources)
        .filter(|quota| quota["provider"] == account.provider)
        .ok_or(AccountError::Response)?;
    let fetched = date_millis(&quota["fetchedAt"]).ok_or(AccountError::Response)?;
    if fetched < start.saturating_sub(60_000) || fetched > now_ms().saturating_add(60_000) {
        return Err(AccountError::Response);
    }
    Ok(quota)
}

fn index(state: &Inner, id: &str) -> Result<usize, AccountError> {
    state
        .cache
        .accounts
        .iter()
        .position(|account| account.id == id)
        .ok_or(AccountError::NotFound)
}

fn live(state: &Inner, ticket: &Ticket<'_>) -> bool {
    !state.closed
        && state
            .jobs
            .get(&ticket.id)
            .is_some_and(|job| job.sequence == ticket.sequence)
}

fn invalidate(state: &mut Inner, id: &str) {
    if let Some(job) = state.jobs.remove(id) {
        let _ = job.sender.send(true);
    }
    state.ready.remove(id);
    state.credentials.remove(id);
    state.restore_failures.remove(id);
    state.identities.forget(id);
}

fn providers(state: &Inner, now: i64) -> Vec<Value> {
    state
        .cache
        .accounts
        .iter()
        .filter(|account| account.adapter.is_some())
        .map(|account| provider_row(state, account, now))
        .collect()
}

fn provider_row(state: &Inner, account: &StoredAccount, now: i64) -> Value {
    let passive = account
        .adapter
        .as_ref()
        .and_then(|adapter| routes().ok().and_then(|routes| routes.get(adapter)))
        .is_some_and(|route| route["kind"] == "passive");
    let busy = state.jobs.contains_key(&account.id);
    let credential = state.credentials.get(&account.id).filter(|value| {
        usable(
            &value.secret,
            account.adapter.as_deref().unwrap_or_default(),
            now,
        )
    });
    let restore_error = state.restore_failures.get(&account.id);
    let error = if restore_error.is_some() {
        Some("PROVIDER_SECRET_STORAGE_FAILED")
    } else if account.sealed_credential.is_some() && credential.is_none() && !state.closed {
        Some("PROVIDER_AUTH_REQUIRED")
    } else {
        account.error_code.as_deref()
    };
    let status = if busy {
        "refreshing"
    } else if error == Some("PROVIDER_AUTH_REQUIRED") {
        "login-required"
    } else if error.is_some() {
        "error"
    } else if state.ready.contains(&account.id) {
        "ready"
    } else {
        "cached"
    };
    let identity = state.identities.view(&account.id);
    let mut view = json!({"id":account.id,"adapter":account.adapter,"provider":account.provider,"alias":account.alias,
        "status":status,"lastAttempt":account.last_attempt,"errorCode":error,"nextRefreshAt":account.next_refresh_at,
        "remembered":account.sealed_credential.is_some(),"credentialExpiresAt":credential.and_then(|value| value.secret.expires_at.as_deref()),
        "passive":passive,"errorMessage":error.map(message),"credentialReady":passive || credential.is_some(),
        "credentialRetryable":restore_error.is_some(),"credentialRestoreFailure":restore_error,"busy":busy,
        "identityStatus":identity.identity_status,"duplicateKnown":identity.duplicate_known,
        "duplicateAccountIds":identity.duplicate_account_ids});
    view["quota"] = resource_view(account.quota.clone().unwrap_or_default(), &view, now);
    view
}

fn login_capability(client: bool) -> &'static str {
    if client {
        "clientLogin"
    } else {
        "websiteLogin"
    }
}

fn new_provider_account(
    adapter: &str,
    alias: &str,
    route: &Value,
) -> Result<StoredAccount, AccountError> {
    let alias = alias.trim();
    if alias.is_empty() || !valid_alias(alias, 48) {
        return Err(AccountError::Action);
    }
    Ok(StoredAccount {
        id: uuid::Uuid::new_v4().to_string(),
        adapter: Some(adapter.to_owned()),
        provider: route["provider"]
            .as_str()
            .ok_or(AccountError::Action)?
            .to_owned(),
        alias: alias.to_owned(),
        plan: None,
        quota: None,
        last_attempt: None,
        error_code: None,
        next_refresh_at: None,
        sealed_credential: None,
    })
}

fn legacy_credential_portable(secret: &Secret, adapter: &str, now: i64) -> bool {
    usable(secret, adapter, now)
        && secret.credential.as_str() != "official-login-required"
        && secret.context.get("deviceGrant").is_none()
        && secret.context.get("zcode").is_none()
        && secret.context.get("oauth").is_none()
        && secret.context.get("clientHome").is_none()
        && secret
            .context
            .get(crate::provider_antigravity_cli::PROFILE_CONTEXT)
            .is_none()
}

pub fn message(code: &str) -> &'static str {
    match code {
        "PROVIDER_EXPERIMENTAL_OFF" => "这是试验性路线。如需使用，请先在设置的“额度”里打开。",
        "PROVIDER_CREDENTIAL_REQUIRED" => "请重新连接、复用官方客户端登录，或在本地提供此服务的有效凭据。",
        "PROVIDER_AUTH_REQUIRED" => "凭据已失效，请重新提供；历史额度保留。",
        "PROVIDER_ACCESS_DENIED" => "服务端拒绝访问，可能缺少授权范围或订阅资格；不能据此认定会员过期。",
        "PROVIDER_RATE_LIMITED" => "服务限流，15 分钟后可重试。",
        "PROVIDER_REDIRECT_REJECTED" => "额度接口发生重定向，已阻止凭据转发。",
        "PROVIDER_REQUEST_FAILED" => "额度读取失败，保留上次成功观测。",
        "PROVIDER_TIMEOUT" => "额度读取超时，保留上次成功观测。",
        "PROVIDER_OUTPUT_LIMIT" => "额度响应超出大小限制，未保存。",
        "PROVIDER_RESPONSE_INVALID" => "额度响应不符合已核对的合同，未替换历史结果。",
        "PROVIDER_QUOTA_UNAVAILABLE" => "服务未返回可识别的额度，不能当作零或无限。",
        "PROVIDER_CANCELED" => "已取消本次读取。",
        "PROVIDER_CACHE_INVALID" => "额度连接缓存损坏，原文件保留；请先检查应用数据目录。",
        "PROVIDER_STORAGE_FAILED" => "额度结果保存失败，未发布为新结果。",
        "PROVIDER_ACTION_INVALID" => "额度操作无效或状态已变化。",
        "PROVIDER_ORGANIZATION_REQUIRED" => "此账号需要明确选择组织／工作区；请填写官网额度请求对应的组织或工作区 ID 后重试。",
        "PROVIDER_CLIENT_UNSUPPORTED" => "此官方 CLI 版本尚未完成兼容核对；更新不一定能解决，请选择已支持版本或其他额度来源。",
        "PROVIDER_CLIENT_ACCOUNT_CHANGED" => "当前客户端登录账号已变化，请重新连接；历史额度保留，不会附到新账号。",
        "PROVIDER_SECRET_STORAGE_FAILED" => "本机登录凭据暂时无法保存或恢复，请先点击刷新重试；历史额度保留。若持续失败，再重新连接。",
        _ => "额度操作未完成，请重试。",
    }
}

fn can_refresh_codex(row: &StoredAccount, now: i64) -> bool {
    row.adapter.is_none()
        && row.error_code.as_deref() != Some("LOGIN_REQUIRED")
        && date_millis(&json!(row.next_refresh_at)).is_none_or(|due| due <= now)
}

fn usable(secret: &Secret, adapter: &str, now: i64) -> bool {
    !secret.expired(now) || secret.can_renew(adapter)
}
