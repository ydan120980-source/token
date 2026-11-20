use quota_engine::{
    account_service::{
        message, AccountError, AccountService, ManualConnect, ReadAccount, ReadResult,
        RefreshOutcome,
    },
    provider_adapters::{from_provider, AdapterOptions},
    provider_antigravity_cli,
    provider_catalog::routes,
    provider_device_login,
    provider_http::{ProviderHttp, ProviderHttpError},
    provider_oauth,
    provider_observation::{observe_provider, Observation, ObservationError},
    provider_vault::Secret,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::{watch, Notify};
use usage_engine::time::{iso_from_ms, now_ms};
use crate::quiet_refresh::{Attempt, QuietRefresh};

pub struct QuotaHost {
    pub accounts: AccountService,
    pub(crate) codex: crate::codex_host::CodexHost,
    http: OnceLock<Result<ProviderHttp, ProviderHttpError>>,
    pub(crate) probe: bool,
    cadence: watch::Sender<Cadence>,
    refreshing_all: AtomicBool,
    batches: Mutex<RecentBatches>,
    login: Mutex<Option<ActiveLogin>>,
    root: PathBuf,
    passive_changed: Notify,
    pub(crate) quiet: QuietRefresh,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Cadence {
    Off,
    At(i64),
    Closed,
}

const INTERVAL: i64 = 60_000;
const REFRESH_SETTINGS_FILE: &str = "quota-refresh.json";

impl Cadence {
    fn parse(value: &str, now: i64) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "1min" => Some(Self::At(now.saturating_add(INTERVAL))),
            _ => None,
        }
    }

    fn load(root: &Path, now: i64) -> Self {
        let path = root.join(REFRESH_SETTINGS_FILE);
        let saved = (|| {
            let metadata = fs::symlink_metadata(&path).ok()?;
            use std::os::windows::fs::MetadataExt;
            if !metadata.is_file()
                || metadata.file_attributes() & 0x400 != 0
                || metadata.len() > 1024
            {
                return None;
            }
            let mut bytes = Vec::new();
            File::open(&path)
                .ok()?
                .take(1025)
                .read_to_end(&mut bytes)
                .ok()?;
            if bytes.len() > 1024 {
                return None;
            }
            let data: Value = serde_json::from_slice(&bytes).ok()?;
            Self::parse(data["autoRefresh"].as_str()?, now)
        })();
        saved.unwrap_or(Self::Off)
    }
}

impl QuotaHost {
    pub fn open(root: &Path, probe: bool) -> Result<Self, AccountError> {
        Ok(Self {
            accounts: AccountService::open(root)?,
            codex: crate::codex_host::CodexHost::open(root, probe),
            http: OnceLock::new(),
            probe,
            cadence: watch::channel(Cadence::load(root, now_ms())).0,
            refreshing_all: AtomicBool::new(false),
            batches: Mutex::new(RecentBatches::default()),
            login: Mutex::new(None),
            root: root.to_owned(),
            passive_changed: Notify::new(),
            quiet: QuietRefresh::default(),
        })
    }

    fn set_cadence(&self, value: &str, now: i64) -> Result<(), &'static str> {
        let next = Cadence::parse(value, now).ok_or("CANCELED")?;
        let mut result = Ok(());
        self.cadence.send_if_modified(|current| {
            if *current == Cadence::Closed {
                result = Err("CANCELED");
                return false;
            }
            let persisted = usage_engine::store_io::atomic(
                &self.root.join(REFRESH_SETTINGS_FILE),
                &json!({"autoRefresh":value}),
                false,
            );
            if persisted.is_err() {
                result = Err("PROVIDER_STORAGE_FAILED");
                return false;
            }
            *current = next;
            true
        });
        result
    }

    async fn observe(&self, mut request: ReadAccount) -> Result<ReadResult, ObservationError> {
        if self.probe {
            let raw = match (request.adapter.as_str(), request.secret.credential.as_str()) {
                ("deepseek-api", "synthetic-fixture-key") => json!({"is_available":true,
                    "balance_infos":[{"currency":"USD","total_balance":"9007199254740993.125"}]}),
                ("workbuddy-credit", "synthetic-workbuddy-api-token") => json!({
                    "total_capacity_size":"100","total_capacity_used":"25"
                }),
                ("workbuddy-web", "quotaFixture=synthetic-workbuddy-cookie")
                    if request.secret.context["userAgent"] == "QuotaDock synthetic WebView2" =>
                {
                    json!({"code":0,"data":{"Packages":[{
                        "CapacityUnit":"credits","CycleTotalCapacity":"9007199254740993.125",
                        "CycleRemainCapacity":"20.125","CycleFrozenCapacity":"1.1"
                    }]}})
                }
                _ => return Err(ProviderHttpError::AuthRequired.into()),
            };
            let resources = from_provider(
                &request.adapter,
                &raw,
                &json!(iso_from_ms(now_ms())),
                AdapterOptions::default(),
            )?;
            return Ok(ReadResult {
                observation: Observation {
                    resources,
                    identity_context: None,
                },
                renewed: None,
            });
        }
        if request.adapter == "antigravity-cli" {
            let (profiles, tools) = self.cli_paths().ok_or(ProviderHttpError::ActionInvalid)?;
            return tauri::async_runtime::spawn_blocking(move || {
                provider_antigravity_cli::observe(&profiles, &tools, &request.secret, || {
                    *request.cancellation.borrow() || request.cancellation.has_changed().is_err()
                })
            })
            .await
            .map_err(|_| ObservationError::ClientUnsupported)?;
        }
        let http = self
            .http
            .get_or_init(ProviderHttp::new)
            .as_ref()
            .map_err(|err| *err)?;
        let renewed = if request.secret.needs_renewal(&request.adapter, now_ms()) {
            Some(
                provider_oauth::renew(
                    http,
                    &request.adapter,
                    &request.secret,
                    &mut request.cancellation,
                )
                .await?,
            )
        } else {
            None
        };
        let secret = renewed.as_ref().unwrap_or(&request.secret);
        let observation = observe_provider(
            http,
            &request.adapter,
            &secret.credential,
            Some(&secret.context),
            &mut request.cancellation,
        )
        .await?;
        Ok(ReadResult {
            observation,
            renewed,
        })
    }

    fn cli_paths(&self) -> Option<(PathBuf, PathBuf)> {
        let state = self.root.parent()?;
        Some((
            self.root.join("client-login"),
            state.join("usage").join("agent-tools"),
        ))
    }

    pub(crate) fn quota_state(&self, version_two: bool) -> Result<Value, String> {
        let mut state = self
            .accounts
            .quota_state(version_two, now_ms())
            .map_err(|error| error.to_string())?;
        if let Cadence::At(due) = *self.cadence.borrow() {
            state["autoRefresh"] = json!("1min");
            state["nextAutoAt"] = json!(iso_from_ms(due));
        }
        {
            let batches = self.batches.lock().map_err(|_| "PROVIDER_STORAGE_FAILED")?;
            state["lastBatch"] = json!(batches.codex);
            state["lastProviderBatch"] = json!(batches.providers);
        }
        self.codex.enrich(&mut state)?;
        if let Some(capabilities) = state.get_mut("providerCapabilities") {
            workbuddy_capability(capabilities);
        }
        Ok(state)
    }

    pub async fn close(&self) -> Result<(), AccountError> {
        self.cadence.send_replace(Cadence::Closed);
        self.passive_changed.notify_one();
        let login = {
            let pending = self.login.lock().map_err(|_| AccountError::Unavailable)?;
            pending.as_ref().map(|login| {
                login.abort.send_replace(true);
                login.done.subscribe()
            })
        };
        if let Some(mut login) = login {
            let _ = login.wait_for(|done| *done).await;
        }
        self.codex
            .close()
            .await
            .map_err(|_| AccountError::Unavailable)?;
        self.accounts.close().await
    }

    pub(crate) async fn wait_for_quiet_retry(&self) -> bool {
        let mut cadence = self.cadence.subscribe();
        tokio::select! {
            biased;
            _ = cadence.wait_for(|cadence| *cadence == Cadence::Closed) => false,
            _ = tokio::time::sleep(Duration::from_secs(8)) => true,
        }
    }
}

struct Batch<'a>(&'a AtomicBool);

impl Drop for Batch<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct BatchCounts {
    pub success: usize,
    pub failed: usize,
    pub skipped: usize,
}

#[derive(Default)]
struct RecentBatches {
    codex: Option<BatchCounts>,
    providers: Option<BatchCounts>,
}

async fn refresh_batch(app: &AppHandle, automatic: bool) -> Result<(), String> {
    let host = app.state::<QuotaHost>();
    if *host.cadence.borrow() == Cadence::Closed
        || host
            .refreshing_all
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
    {
        return Ok(());
    }
    let _batch = Batch(&host.refreshing_all);
    let codex = refresh_codex_batch(&host, app, automatic);
    let providers = async {
        if automatic {
            refresh_provider_batch(&host, app).await.map(Some)
        } else {
            Ok(None)
        }
    };
    let (codex, providers) = tokio::join!(codex, providers);
    *host.batches.lock().map_err(|_| "PROVIDER_STORAGE_FAILED")? = RecentBatches {
        codex: Some(codex?),
        providers: providers?,
    };
    changed(app);
    Ok(())
}

async fn refresh_codex_batch(
    host: &QuotaHost,
    app: &AppHandle,
    automatic: bool,
) -> Result<BatchCounts, String> {
    let targets = host
        .accounts
        .codex_refreshable(now_ms())
        .map_err(|error| error.to_string())?;
    let mut batch = BatchCounts::default();
    for id in targets {
        if *host.cadence.borrow() == Cadence::Closed {
            batch.skipped += 1;
            continue;
        }
        match crate::codex_host::refresh(host, app, &id, automatic).await {
            Ok(RefreshOutcome::Published) => batch.success += 1,
            Ok(RefreshOutcome::Skipped) => batch.skipped += 1,
            Err(code)
                if matches!(
                    code.as_str(),
                    "CODEX_EXECUTABLE_REQUIRED"
                        | "LOGIN_REQUIRED"
                        | "RUNTIME_BUSY"
                        | "ACCOUNT_NOT_FOUND"
                        | "LOGIN_CANCELED"
                ) =>
            {
                batch.skipped += 1
            }
            _ => batch.failed += 1,
        }
    }
    Ok(batch)
}

async fn refresh_provider_batch(host: &QuotaHost, app: &AppHandle) -> Result<BatchCounts, String> {
    let mut reads = tokio::task::JoinSet::new();
    for id in host
        .accounts
        .refreshable_automatic(now_ms())
        .map_err(|error| error.to_string())?
    {
        let app = app.clone();
        reads.spawn(async move {
            let host = app.state::<QuotaHost>();
            refresh_provider(&host, &app, &id, true).await
        });
    }
    let mut batch = BatchCounts::default();
    while let Some(outcome) = reads.join_next().await {
        match outcome {
            Ok(Ok(RefreshOutcome::Published)) => batch.success += 1,
            Ok(
                Ok(RefreshOutcome::Skipped)
                | Err(AccountError::Canceled | AccountError::AuthRequired | AccountError::NotFound),
            ) => batch.skipped += 1,
            _ => batch.failed += 1,
        }
    }
    Ok(batch)
}

async fn refresh_provider(
    host: &QuotaHost,
    app: &AppHandle,
    id: &str,
    automatic: bool,
) -> Result<RefreshOutcome, AccountError> {
    if automatic && !host.quiet.program_due(id, now_ms()) {
        return Ok(RefreshOutcome::Skipped);
    }
    let first = if automatic { Attempt::Scheduled } else { Attempt::Manual };
    if let Some(result) = provider_attempt(host, app, id, first).await? {
        return Ok(result);
    }
    if !host.wait_for_quiet_retry().await {
        return Ok(RefreshOutcome::Skipped);
    }
    Ok(provider_attempt(host, app, id, Attempt::Retry).await?.unwrap_or(RefreshOutcome::Failed))
}

pub(crate) fn has_healthy_quota(state: &Value, id: &str) -> bool {
    state["accounts"].as_array().is_some_and(|rows| rows.iter().any(|row|
        row["id"] == id && row["errorCode"].is_null() && row["quota"]["fetchedAt"].is_string()
    ))
}

async fn provider_attempt(
    host: &QuotaHost,
    app: &AppHandle,
    id: &str,
    attempt: Attempt,
) -> Result<Option<RefreshOutcome>, AccountError> {
    let automatic = attempt.automatic();
    let result = match read_provider(host, id, attempt, |request| host.observe(request)).await {
        Ok(ProviderRead::Hidden(code)) => {
            crate::desktop_shell::record_quiet_read(app, id, &code);
            return Ok(None);
        }
        Ok(ProviderRead::Completed(outcome)) => Ok(outcome),
        Err(error) => Err(error),
    };
    match &result {
        Ok(RefreshOutcome::Published) => {
            crate::desktop_shell::record_read(app, id, None, automatic)
        }
        Ok(RefreshOutcome::Failed) => {
            let failure = host
                .accounts
                .read_error_code(id)?
                .unwrap_or_else(|| "PROVIDER_REQUEST_FAILED".to_owned());
            crate::desktop_shell::record_read(app, id, Some(&failure), automatic);
        }
        Err(AccountError::AuthRequired) if !automatic => {
            crate::desktop_shell::record_read(app, id, Some("PROVIDER_AUTH_REQUIRED"), false);
        }
        _ => {}
    }
    result.map(Some)
}

enum ProviderRead {
    Completed(RefreshOutcome),
    Hidden(String),
}

async fn read_provider<F, Fut>(
    host: &QuotaHost,
    id: &str,
    attempt: Attempt,
    read: F,
) -> Result<ProviderRead, AccountError>
where
    F: FnOnce(ReadAccount) -> Fut,
    Fut: std::future::Future<Output = Result<ReadResult, ObservationError>>,
{
    let automatic = attempt.automatic();
    let prior = automatic && has_healthy_quota(&host.accounts.provider_state(now_ms())?, id);
    let mut hidden = None;
    let result = host.accounts.refresh(id, |request| {
        let hidden = &mut hidden;
        async move {
            let cancellation = request.cancellation.clone();
            let program_at = (request.adapter == "antigravity-cli").then(now_ms);
            let reading = read(request).await;
            if let Err(error) = &reading {
                let code = error.to_string();
                // Withdraw this failed observation before AccountService can
                // persist it. The read releases its scheduler permit normally.
                if host.quiet.can_hide(id, attempt, prior, &code)
                    && !*cancellation.borrow() && host.accounts.cancel(id).is_ok()
                {
                    *hidden = Some((code, program_at));
                }
            }
            reading
        }
    }).await;
    if let Some((code, program_at)) = hidden {
        if matches!(result, Err(AccountError::Canceled)) {
            host.quiet.hidden(id, attempt, program_at);
            return Ok(ProviderRead::Hidden(code));
        }
    }
    if matches!(&result, Ok(RefreshOutcome::Published | RefreshOutcome::Failed)) {
        host.quiet.forget(id);
    }
    result.map(ProviderRead::Completed)
}

pub fn start_timer(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let host = app.state::<QuotaHost>();
        let mut schedule = host.cadence.subscribe();
        loop {
            let cadence = *schedule.borrow_and_update();
            let due = match cadence {
                Cadence::Closed => return,
                Cadence::Off => {
                    if schedule.changed().await.is_err() {
                        return;
                    }
                    continue;
                }
                Cadence::At(due) => due,
            };
            let wait = Duration::from_millis(due.saturating_sub(now_ms()).max(0) as u64);
            tokio::select! {
                biased;
                _ = schedule.changed() => continue,
                _ = tokio::time::sleep(wait) => {}
            }
            if *schedule.borrow() != Cadence::At(due) {
                continue;
            }
            let _ = refresh_batch(&app, true).await;
            let updated = host.cadence.send_if_modified(|current| {
                if *current != Cadence::At(due) {
                    return false;
                }
                *current = Cadence::At(now_ms().saturating_add(INTERVAL));
                true
            });
            if updated {
                changed(&app);
            }
        }
    });
}

pub fn start_passive(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let host = app.state::<QuotaHost>();
        loop {
            if *host.cadence.borrow() == Cadence::Closed {
                break;
            }
            let Ok(ids) = host.accounts.passive_ids() else {
                break;
            };
            if ids.is_empty() {
                host.passive_changed.notified().await;
                continue;
            }
            let owned = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let host = owned.state::<QuotaHost>();
                let mut published = false;
                for id in ids {
                    published |= host
                        .accounts
                        .refresh_passive(&host.root, &id)
                        .unwrap_or(false);
                }
                if published {
                    changed(&owned);
                }
            })
            .await;
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                _ = host.passive_changed.notified() => {}
            }
        }
    });
}

pub(crate) fn guard(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("IPC_SENDER_REJECTED".to_owned())
    }
}

pub fn changed(app: &AppHandle) {
    crate::desktop_shell::changed(app);
    let _ = app.emit_to("main", "quota:providerUpdate", ());
    let _ = app.emit_to("main", "quota:update", ());
    let _ = app.emit_to(crate::tray_card::CARD, "tray:update", ());
}

fn workbuddy_capability(capabilities: &mut Value) {
    let Some(provider) = capabilities
        .as_array_mut()
        .and_then(|rows| rows.iter_mut().find(|row| row["provider"] == "workbuddy"))
    else {
        return;
    };
    if let Some(adapters) = provider["adapters"].as_array_mut() {
        adapters.retain(|route| route["id"] != "workbuddy-desktop");
    }
    provider["login"] = json!({
        "mode":"api-key",
        "label":"WorkBuddy 网站／官方 API",
        "note":"使用独立网页登录，或提供已授权的官方 API 凭据。桌面客户端会话复用请见迁移说明。"
    });
}

fn provider_reply(host: &QuotaHost, result: Result<(), AccountError>) -> Result<Value, String> {
    let mut state = host
        .accounts
        .provider_state(now_ms())
        .map_err(|error| error.to_string())?;
    if let Some(login) = host
        .login
        .lock()
        .map_err(|_| "PROVIDER_STORAGE_FAILED")?
        .as_ref()
    {
        state["pendingWebsiteLogin"] = json!({"adapter":login.adapter,"id":login.id});
    }
    workbuddy_capability(&mut state["capabilities"]);
    match result {
        Ok(()) => Ok(json!({"ok":true,"state":state})),
        Err(error) => {
            let code = error.to_string();
            let stage = match error {
                AccountError::Vault(error) => Some(error.stage()),
                _ => None,
            };
            Ok(json!({"ok":false,"errorCode":code,"error":message(&code),
                "errorStage":stage,"storageCode":null,"state":state}))
        }
    }
}

#[tauri::command]
pub fn quota_providers(window: WebviewWindow, host: State<'_, QuotaHost>) -> Result<Value, String> {
    guard(&window)?;
    provider_reply(&host, Ok(()))
}

#[tauri::command]
pub fn quota_get(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    version_two: bool,
) -> Result<Value, String> {
    guard(&window)?;
    let state = host.quota_state(version_two)?;
    Ok(json!({"ok":true,"state":state}))
}

#[tauri::command]
pub async fn quota_provider_experimental(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    enabled: bool,
) -> Result<Value, String> {
    guard(&window)?;
    let result = host.accounts.set_experimental(enabled);
    if result.is_ok() {
        changed(window.app_handle());
    }
    provider_reply(&host, result)
}

#[tauri::command]
pub async fn quota_provider_connect(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    request: ManualConnect,
) -> Result<Value, String> {
    guard(&window)?;
    let result = if matches!(
        request.adapter.as_str(),
        "claude-statusline" | "antigravity-statusline"
    ) {
        let result = host.accounts.add_passive(&request);
        if result.is_ok() {
            host.passive_changed.notify_one();
        }
        result
    } else {
        host.accounts
            .connect(request, |request| host.observe(request))
            .await
    };
    if result.is_ok() {
        changed(window.app_handle());
    }
    provider_reply(&host, result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRequest {
    pub adapter: String,
    pub alias: String,
    pub id: Option<String>,
    pub consent: bool,
    #[serde(default)]
    pub fresh: bool,
}

struct ActiveLogin {
    adapter: String,
    id: Option<String>,
    abort: watch::Sender<bool>,
    done: watch::Sender<bool>,
}

struct LoginGuard<'a> {
    host: &'a QuotaHost,
    app: &'a AppHandle,
}

impl Drop for LoginGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.host.login.lock() {
            if let Some(login) = pending.take() {
                login.done.send_replace(true);
            }
        }
        changed(self.app);
    }
}

impl QuotaHost {
    fn start_login<'a>(
        &'a self,
        app: &'a AppHandle,
        request: &LoginRequest,
        client: bool,
    ) -> Result<(LoginGuard<'a>, watch::Sender<bool>, watch::Receiver<bool>), AccountError> {
        if !request.consent || !client && request.fresh {
            return Err(AccountError::Action);
        }
        if self.probe {
            return Err(AccountError::FixtureBlocked);
        }
        if *self.cadence.borrow() == Cadence::Closed {
            return Err(AccountError::Canceled);
        }
        self.accounts.check_login(
            &request.adapter,
            &request.alias,
            request.id.as_deref(),
            client,
        )?;
        let (abort, canceled) = watch::channel(false);
        {
            let mut pending = self.login.lock().map_err(|_| AccountError::Unavailable)?;
            if *self.cadence.borrow() == Cadence::Closed {
                return Err(AccountError::Canceled);
            }
            if pending.is_some() {
                return Err(AccountError::LoginBusy);
            }
            *pending = Some(ActiveLogin {
                adapter: request.adapter.clone(),
                id: request.id.clone(),
                abort: abort.clone(),
                done: watch::channel(false).0,
            });
        }
        changed(app);
        Ok((LoginGuard { host: self, app }, abort, canceled))
    }

    async fn finish_login(
        &self,
        request: &LoginRequest,
        client: bool,
        secret: Secret,
    ) -> Result<(), AccountError> {
        self.accounts
            .verified_login(
                &request.adapter,
                &request.alias,
                request.id.as_deref(),
                client,
                secret,
                |read| self.observe(read),
            )
            .await
    }
}

async fn website_login(
    host: &QuotaHost,
    app: &AppHandle,
    request: &LoginRequest,
) -> Result<(), AccountError> {
    let (_guard, abort, mut canceled) = host.start_login(app, request, false)?;
    let login = {
        let app = app.clone();
        let adapter = request.adapter.clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::website_login::LoginWindow::open(&app, &adapter, abort)
        })
        .await
        .map_err(|_| AccountError::BrowserFailed)??
    };
    let result = tokio::select! {
        biased;
        _ = canceled.wait_for(|cancel| *cancel) => Err(AccountError::Canceled),
        result = async {
            let secret = login.credential(&request.adapter).await?;
            host.finish_login(request, false, secret).await
        } => result,
    };
    tauri::async_runtime::spawn_blocking(move || drop(login))
        .await
        .map_err(|_| AccountError::BrowserFailed)?;
    result
}

#[tauri::command]
pub async fn quota_provider_website_login(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    request: LoginRequest,
) -> Result<Value, String> {
    guard(&window)?;
    let result = website_login(&host, window.app_handle(), &request).await;
    provider_reply(&host, result)
}

async fn client_login(
    host: &QuotaHost,
    app: &AppHandle,
    request: &LoginRequest,
) -> Result<(), AccountError> {
    let (_guard, _abort, mut canceled) = host.start_login(app, request, true)?;
    if request.adapter == "workbuddy-desktop" {
        return Err(AccountError::Observation(
            ObservationError::ClientUnsupported,
        ));
    }
    if request.adapter == "antigravity-cli" {
        let (profiles, tools) = host.cli_paths().ok_or(AccountError::Unavailable)?;
        let job_canceled = canceled.clone();
        let (secret, quota) = tauri::async_runtime::spawn_blocking(move || {
            provider_antigravity_cli::login(&profiles, &tools, || {
                *job_canceled.borrow() || job_canceled.has_changed().is_err()
            })
        })
        .await
        .map_err(|_| AccountError::ClientUnavailable)??;
        if *canceled.borrow() {
            return Err(AccountError::Canceled);
        }
        return host
            .accounts
            .verified_login(
                &request.adapter,
                &request.alias,
                request.id.as_deref(),
                true,
                secret,
                move |_| async move { Ok(quota) },
            )
            .await;
    }
    if request.adapter == "claude-oauth" {
        let root = host.root.join("client-login");
        let job_canceled = canceled.clone();
        let secret = tauri::async_runtime::spawn_blocking(move || {
            quota_engine::provider_cli_login::claude(&root, || *job_canceled.borrow())
        })
        .await
        .map_err(|_| AccountError::ClientUnavailable)??;
        return tokio::select! {
            biased;
            _ = canceled.wait_for(|cancel| *cancel) => Err(AccountError::Canceled),
            result = host.finish_login(request, true, secret) => result,
        };
    }
    tokio::select! {
        biased;
        _ = canceled.wait_for(|cancel| *cancel) => Err(AccountError::Canceled),
        result = async {
            let secret = match request.adapter.as_str() {
                "opencode-zen" | "zcode-device" => {
                    let http = host.http.get_or_init(ProviderHttp::new).as_ref()
                        .map_err(|err| AccountError::Observation((*err).into()))?;
                    provider_device_login::login(http, &request.adapter, |url| {
                        tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|_| AccountError::BrowserFailed)
                    }).await?
                }
                _ => environment_key(&request.adapter)?,
            };
            host.finish_login(request, true, secret).await
        } => result,
    }
}

fn environment_key(adapter: &str) -> Result<Secret, AccountError> {
    let keys: &[&str] = match adapter {
        "deepseek-api" => &["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"],
        "opencode-go" => &["OPENCODE_API_KEY"],
        "zai-global" => &["Z_AI_API_KEY"],
        "zai-cn" => &[
            "BIGMODEL_API_KEY",
            "ZHIPU_API_KEY",
            "ZHIPUAI_API_KEY",
            "GLM_API_KEY",
        ],
        _ => return Err(AccountError::AuthRequired),
    };
    keys.iter()
        .filter_map(|name| std::env::var(name).ok().map(zeroize::Zeroizing::new))
        .find_map(|credential| Secret::new(adapter, &credential, Value::Null, None).ok())
        .ok_or(AccountError::AuthRequired)
}

#[tauri::command]
pub async fn quota_provider_client_login(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    request: LoginRequest,
) -> Result<Value, String> {
    guard(&window)?;
    let result = client_login(&host, window.app_handle(), &request).await;
    provider_reply(&host, result)
}

#[tauri::command]
pub fn quota_provider_website_cancel(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
) -> Result<Value, String> {
    guard(&window)?;
    let pending = host.login.lock().map_err(|_| "PROVIDER_STORAGE_FAILED")?;
    if let Some(login) = pending.as_ref() {
        login.abort.send_replace(true);
    }
    drop(pending);
    provider_reply(&host, Ok(()))
}

#[tauri::command]
pub async fn quota_provider_guide(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    adapter: String,
) -> Result<Value, String> {
    guard(&window)?;
    if host.probe {
        return provider_reply(&host, Err(AccountError::FixtureBlocked));
    }
    let provider = routes()
        .ok()
        .and_then(|catalog| catalog.get(&adapter))
        .and_then(|route| route["provider"].as_str());
    let url = match (adapter.as_str(), provider) {
        ("opencode-zen", _) => Some("https://opencode.ai/console"),
        ("opencode-go", _) => Some("https://opencode.ai/auth"),
        (_, Some("claude")) => Some("https://code.claude.com/docs/en/statusline"),
        (_, Some("antigravity")) => Some("https://antigravity.google/docs/cli/statusline/"),
        (_, Some("workbuddy")) => Some("https://open.workbuddy.cn/en/docs/third-party-app"),
        (_, Some("deepseek")) => Some("https://platform.deepseek.com/api_keys"),
        (_, Some("opencode")) => Some("https://opencode.ai/go"),
        (_, Some("gemini")) => Some("https://geminicli.com/docs/resources/quota-and-pricing/"),
        (_, Some("mimo")) => Some("https://platform.xiaomimimo.com"),
        (_, Some("cursor")) => Some("https://cursor.com/dashboard"),
        ("zai-cn", _) => Some("https://bigmodel.cn/coding-plan/personal/usage"),
        (_, Some(_)) => Some("https://z.ai/manage-apikey/coding-plan/personal/my-plan"),
        _ => None,
    };
    let result = match url {
        None => Err(AccountError::Action),
        Some(url) => tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|_| AccountError::BrowserFailed),
    };
    provider_reply(&host, result)
}

#[tauri::command]
pub async fn quota_provider_passive_guide(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    id: String,
) -> Result<Value, String> {
    guard(&window)?;
    let result = match host.accounts.adapter(&id) {
        Ok(adapter)
            if matches!(
                adapter.as_str(),
                "claude-statusline" | "antigravity-statusline"
            ) && id.len() == 36
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() || byte == b'-') =>
        {
            let command = std::env::current_exe().ok().and_then(|path| {
                let path = path.to_str()?;
                if path.contains(['"', '%', '!', '$', '`', '\r', '\n']) {
                    return None;
                }
                Some(format!(r#""{path}" --statusline {id}"#))
            });
            if let Some(command) = command {
                let contents =
                    json!({"statusLine":{"type":"command","command":command}}).to_string();
                crate::desktop_io::clipboard(window.app_handle().clone(), contents)
                    .await
                    .map(|_| ())
                    .map_err(|_| AccountError::Unavailable)
            } else {
                Err(AccountError::Unavailable)
            }
        }
        Ok(_) => Err(AccountError::Action),
        Err(error) => Err(error),
    };
    provider_reply(&host, result)
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ProviderAction {
    Refresh {
        id: String,
    },
    Cancel {
        id: String,
    },
    Remove {
        id: String,
    },
    Credential {
        id: String,
        credential: String,
        project: Option<String>,
        remember: Option<bool>,
        user_agent: Option<String>,
        organization: Option<String>,
        workspace: Option<String>,
    },
}

#[tauri::command]
pub async fn quota_provider_action(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    request: ProviderAction,
) -> Result<Value, String> {
    guard(&window)?;
    let result = match request {
        ProviderAction::Refresh { id } => match host.accounts.adapter(&id) {
            Ok(adapter)
                if matches!(
                    adapter.as_str(),
                    "claude-statusline" | "antigravity-statusline"
                ) =>
            {
                host.accounts.refresh_passive(&host.root, &id).map(|_| ())
            }
            Ok(_) => refresh_provider(&host, window.app_handle(), &id, false)
                .await
                .map(|_| ()),
            Err(error) => Err(error),
        },
        ProviderAction::Cancel { id } => host.accounts.cancel(&id),
        ProviderAction::Remove { id } => host.accounts.remove(&id).map(|()| {
            host.quiet.forget(&id);
            crate::desktop_shell::forget(window.app_handle(), &id);
        }),
        ProviderAction::Credential {
            id,
            credential,
            project,
            remember,
            user_agent,
            organization,
            workspace,
        } => {
            let mut draft = ManualConnect {
                alias: String::new(),
                adapter: String::new(),
                credential: Some(credential),
                project,
                remember,
                user_agent,
                organization,
                workspace,
            };
            match host.accounts.adapter(&id) {
                Ok(adapter) => {
                    draft.adapter = adapter;
                    host.accounts
                        .supply(&id, draft, |request| host.observe(request))
                        .await
                }
                Err(error) => Err(error),
            }
        }
    };
    if result.is_ok() {
        changed(window.app_handle());
    }
    provider_reply(&host, result)
}

#[tauri::command]
pub async fn quota_refresh_all(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
) -> Result<Value, String> {
    guard(&window)?;
    refresh_batch(window.app_handle(), false).await?;
    quota_get(window, host, false)
}

#[tauri::command]
pub async fn quota_set_auto_refresh(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    value: String,
) -> Result<Value, String> {
    guard(&window)?;
    let app = window.app_handle().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        app.state::<QuotaHost>().set_cadence(&value, now_ms())
    })
    .await
    .map_err(|_| "PROVIDER_STORAGE_FAILED")?;
    if let Err(error) = result {
        return Ok(json!({"ok":false,"errorCode":error,"state":host.quota_state(false)?}));
    }
    changed(window.app_handle());
    quota_get(window, host, false)
}

pub fn select_legacy(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let host = app.state::<QuotaHost>();
        if host.probe {
            return;
        }
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择旧 QuotaDock 应用数据目录")
            .blocking_pick_folder();
        let Some(source) = selected.and_then(|path| path.into_path().ok()) else {
            return;
        };
        let confirmed = window
            .dialog()
            .message(
                "从所选目录复制账户和历史额度，并尝试恢复可迁移的 QuotaDock 凭据？网页与设备登录授权需要重新建立。",
            )
            .title("导入旧版 QuotaDock 账户")
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show();
        if !confirmed {
            return;
        }
        let text = match host.accounts.import(&source, now_ms()) {
            Ok(report) => {
                host.passive_changed.notify_one();
                changed(&app);
                format!(
                    "导入 {} 个账户，跳过 {} 个重复账户。恢复 {} 份凭据，{} 个账户需要重新登录。",
                    report.imported,
                    report.skipped,
                    report.credentials_restored,
                    report.login_required
                )
            }
            Err(error) => match error {
                AccountError::Cache(quota_engine::account_cache::CacheError::Profile) => {
                    "所选目录不是可导入的 QuotaDock 数据目录。".to_owned()
                }
                _ => "无法导入所选目录中的旧账户，已保留当前账户。".to_owned(),
            },
        };
        window.dialog().message(text).title("导入结果").show(|_| {});
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn quota_cadence_persists_without_replaying_ticks_from_the_old_process(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let host = QuotaHost::open(root.path(), true)?;
        assert!(*host.cadence.borrow() == Cadence::Off);
        assert_eq!(host.set_cadence("5sec", 123), Err("CANCELED"));
        assert!(!root.path().join(REFRESH_SETTINGS_FILE).exists());

        host.set_cadence("1min", 123)?;
        assert!(*host.cadence.borrow() == Cadence::At(123 + INTERVAL));
        host.close().await?;
        assert_eq!(host.set_cadence("off", 123), Err("CANCELED"));
        assert!(Cadence::load(root.path(), 999_000) == Cadence::At(999_000 + INTERVAL));

        let restarted = QuotaHost::open(root.path(), true)?;
        restarted.set_cadence("off", 999_000)?;
        assert!(Cadence::load(root.path(), 1_000_000) == Cadence::Off);

        let blocked = tempfile::tempdir()?;
        fs::create_dir(blocked.path().join(REFRESH_SETTINGS_FILE))?;
        let host = QuotaHost::open(blocked.path(), true)?;
        assert_eq!(host.set_cadence("1min", 42), Err("PROVIDER_STORAGE_FAILED"));
        assert!(*host.cadence.borrow() == Cadence::Off);
        Ok(())
    }

    #[test]
    fn workbuddy_exposes_the_approved_website_and_api_routes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let caps = quota_engine::provider_catalog::capabilities()?;
        let mut projected = serde_json::to_value(caps)?;
        workbuddy_capability(&mut projected);
        let provider = projected
            .as_array()
            .into_iter()
            .flatten()
            .find(|row| row["provider"] == "workbuddy")
            .expect("provider");
        let ids: Vec<_> = provider["adapters"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|row| row["id"].as_str())
            .collect();
        assert!(ids.contains(&"workbuddy-web"));
        assert!(ids.contains(&"workbuddy-credit"));
        assert!(!ids.contains(&"workbuddy-desktop"));
        assert_eq!(provider["login"]["mode"], "api-key");
        Ok(())
    }
}
    #[tokio::test]
    async fn provider_quiet_failures_preserve_the_persisted_observation_until_the_third_retry(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let host = QuotaHost::open(root.path(), true)?;
        let request = ManualConnect {
            adapter: "deepseek-api".to_owned(),
            alias: "synthetic fixture".to_owned(),
            credential: Some("synthetic-fixture-key".to_owned()),
            project: None,
            remember: Some(true),
            user_agent: None,
            organization: None,
            workspace: None,
        };
        host.accounts.connect(request, |read| host.observe(read)).await?;
        let state = host.accounts.provider_state(now_ms())?;
        let id = state["accounts"][0]["id"].as_str().ok_or("fixture account missing")?;
        let cache = root.path().join("quota-accounts.json");
        let before = fs::read(&cache)?;
        let timeout = |_| async { Err(ProviderHttpError::Timeout.into()) };
        for _ in 0..2 {
            for attempt in [Attempt::Scheduled, Attempt::Retry] {
                assert!(matches!(read_provider(&host, id, attempt, timeout).await?,
                    ProviderRead::Hidden(code) if code == "PROVIDER_TIMEOUT"));
                assert!(host.accounts.read_error_code(id)?.is_none());
                assert_eq!(fs::read(&cache)?, before);
            }
        }
        assert!(matches!(read_provider(&host, id, Attempt::Scheduled, timeout).await?,
            ProviderRead::Hidden(_)));
        assert!(matches!(read_provider(&host, id, Attempt::Retry, timeout).await?,
            ProviderRead::Completed(RefreshOutcome::Failed)));
        assert_eq!(host.accounts.read_error_code(id)?.as_deref(), Some("PROVIDER_TIMEOUT"));
        assert_eq!(host.accounts.provider_state(now_ms())?["accounts"][0]["quota"]["fetchedAt"],
            state["accounts"][0]["quota"]["fetchedAt"]);
        Ok(())
    }
