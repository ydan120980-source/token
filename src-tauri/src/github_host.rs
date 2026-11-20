use crate::{desktop_io, reader};
use quota_engine::{
    dpapi,
    github_api::{
        self, Device, GithubApi, Poll, Result, Token, User, AUTH_REQUIRED, REPOSITORY_INVALID,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env, fs,
    future::Future,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::{
    sync::{watch, Notify},
    time::Instant,
};
use usage_engine::{
    store_io::atomic,
    time::{iso_from_ms, now_ms},
};
use uuid::Uuid;
use zeroize::Zeroizing;

const EVENT: &str = "github:update";
const FAILED: &str = "GITHUB_REQUEST_FAILED";
const STORAGE: &str = "GITHUB_SECURE_STORAGE_REQUIRED";
const BUSY: &str = "GITHUB_BUSY";
const NOT_CONFIGURED: &str = "GITHUB_NOT_CONFIGURED";
const NOT_CONNECTED: &str = "GITHUB_NOT_CONNECTED";
const CANCELED: &str = "GITHUB_CANCELED";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    user: User,
    connected_at: String,
    expired: bool,
    cipher: Vec<u8>,
}

#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncPreferences {
    enabled: bool,
    repository: Option<String>,
    last_success: Option<String>,
    days: Option<usize>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    account: Option<Account>,
    sync: SyncPreferences,
    device: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyncRequest {
    pub enabled: bool,
    pub repository: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicDevice {
    pub user_code: String,
    pub verification_uri: &'static str,
    pub expires_at: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Job {
    Connect,
    List,
    Sync,
}

struct Active {
    job: Job,
    stop: watch::Sender<bool>,
}

#[derive(Default)]
struct State {
    saved: Saved,
    active: Option<Active>,
    device: Option<PublicDevice>,
    connect_error: Option<&'static str>,
    sync_error: Option<&'static str>,
    repositories: Option<Vec<String>>,
    closed: bool,
}

struct Inner {
    file: PathBuf,
    api: Option<GithubApi>,
    install_url: Option<String>,
    state: Mutex<State>,
    idle: Notify,
}

#[derive(Clone)]
pub(crate) struct GithubHost(Arc<Inner>);

struct Work {
    host: GithubHost,
    app: AppHandle,
    stop: watch::Receiver<bool>,
}

impl Drop for Work {
    fn drop(&mut self) {
        if let Ok(mut state) = self.host.state() {
            state.active = None;
            state.device = None;
        }
        self.host.0.idle.notify_one();
        changed(&self.app);
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit_to("main", EVENT, ());
}

async fn cancellable<T>(
    mut stop: watch::Receiver<bool>,
    action: impl Future<Output = Result<T>>,
) -> Result<T> {
    tokio::select! {
        biased;
        _ = stop.wait_for(|stop| *stop) => Err(CANCELED),
        result = action => result,
    }
}

fn entropy(login: &str) -> Vec<u8> {
    [b"QuotaDock/GitHub device grant/v1/", login.as_bytes()].concat()
}

fn seal(login: &str, entry: &Token) -> Result<Vec<u8>> {
    let bytes = Zeroizing::new(serde_json::to_vec(entry).map_err(|_| STORAGE)?);
    dpapi::protect(&bytes, &entropy(login)).map_err(|_| STORAGE)
}

fn unseal(login: &str, cipher: &[u8]) -> Result<Token> {
    let bytes = dpapi::unprotect(cipher, &entropy(login)).map_err(|_| AUTH_REQUIRED)?;
    serde_json::from_slice(bytes.as_ref()).map_err(|_| AUTH_REQUIRED)
}

fn read_saved(file: &Path) -> Option<Saved> {
    use std::os::windows::fs::MetadataExt;
    const LIMIT: u64 = 1024 * 1024;
    let metadata = fs::symlink_metadata(file).ok()?;
    if !metadata.is_file() || metadata.file_attributes() & 0x400 != 0 || metadata.len() > LIMIT {
        return None;
    }
    let mut buf = Vec::new();
    fs::File::open(file)
        .ok()?
        .take(LIMIT + 1)
        .read_to_end(&mut buf)
        .ok()?;
    if buf.len() as u64 > LIMIT {
        return None;
    }
    serde_json::from_slice(&buf).ok()
}

impl GithubHost {
    pub(crate) fn open(dir: &Path, fixture: bool) -> Self {
        let api = (!fixture)
            .then(|| {
                env::var("AGENT_USAGE_GITHUB_CLIENT_ID")
                    .ok()
                    .or_else(|| option_env!("AGENT_USAGE_GITHUB_CLIENT_ID").map(str::to_owned))
            })
            .flatten()
            .and_then(|client| GithubApi::new(client).ok());
        let install_url = api
            .as_ref()
            .and_then(|_| {
                env::var("AGENT_USAGE_GITHUB_APP_SLUG")
                    .ok()
                    .or_else(|| option_env!("AGENT_USAGE_GITHUB_APP_SLUG").map(str::to_owned))
            })
            .and_then(|slug| github_api::install_url(&slug));
        let file = dir.join("github.json");
        let saved = read_saved(&file).unwrap_or_default();
        Self(Arc::new(Inner {
            file,
            api,
            install_url,
            state: Mutex::new(State {
                saved,
                ..State::default()
            }),
            idle: Notify::new(),
        }))
    }

    fn state(&self) -> Result<MutexGuard<'_, State>> {
        self.0.state.lock().map_err(|_| FAILED)
    }

    fn api(&self) -> Result<&GithubApi> {
        self.0.api.as_ref().ok_or(NOT_CONFIGURED)
    }

    fn save(&self, saved: &Saved) -> Result<()> {
        let value = serde_json::to_value(saved).map_err(|_| FAILED)?;
        atomic(&self.0.file, &value, false).map_err(|_| STORAGE)
    }

    fn view(&self) -> Result<Value> {
        let state = self.state()?;
        let account = state.saved.account.as_ref();
        let sync = &state.saved.sync;
        let job = state.active.as_ref().map(|task| task.job);
        Ok(json!({
            "schemaVersion": "GithubStateV1",
            "configured": self.0.api.is_some(),
            "connection": {
                "status": if state.device.is_some() { "pending" } else if account.is_some_and(|a| a.expired) { "expired" } else if account.is_some() { "connected" } else { "none" },
                "login": account.map(|a| &a.user.login),
                "name": account.and_then(|a| a.user.name.as_ref()),
                "avatar": account.and_then(|a| a.user.avatar.as_ref()),
                "connectedAt": account.map(|a| &a.connected_at),
                "device": state.device,
                "error": state.connect_error,
            },
            "sync": {
                "enabled": sync.enabled, "repository": sync.repository,
                "status": if job == Some(Job::Sync) { "syncing" } else if state.sync_error.is_some() { "error" } else if sync.last_success.is_some() { "ok" } else { "idle" },
                "lastSuccess": sync.last_success, "days": sync.days, "error": state.sync_error,
                "device": state.saved.device,
            },
            "repositories": state.repositories,
            "repositoriesLoading": job == Some(Job::List),
            "installUrl": self.0.install_url,
        }))
    }

    fn begin(&self, app: &AppHandle, job: Job) -> Result<Work> {
        let mut state = self.state()?;
        if state.closed {
            return Err(NOT_CONFIGURED);
        }
        if state.active.is_some() {
            return Err(BUSY);
        }
        let (stop, receiver) = watch::channel(false);
        state.active = Some(Active { job, stop });
        drop(state);
        changed(app);
        Ok(Work {
            host: self.clone(),
            app: app.clone(),
            stop: receiver,
        })
    }

    fn auth(&self) -> Result<(String, Token)> {
        let state = self.state()?;
        let account = state.saved.account.as_ref().ok_or(NOT_CONNECTED)?;
        if account.expired {
            return Err(AUTH_REQUIRED);
        }
        Ok((
            account.user.login.clone(),
            unseal(&account.user.login, &account.cipher)?,
        ))
    }

    async fn credential(&self) -> Result<(String, Token)> {
        let (login, token) = self.auth()?;
        let now = now_ms();
        if token
            .expires_at
            .is_some_and(|expires| expires <= now + 60_000)
        {
            if let Some(refresh) = token.refresh_token.as_deref() {
                let next = self.api()?.refresh(refresh).await?;
                let cipher = seal(&login, &next)?;
                let mut state = self.state()?;
                if state.closed {
                    return Err(CANCELED);
                }
                let account = state.saved.account.as_mut().ok_or(NOT_CONNECTED)?;
                let previous = std::mem::replace(&mut account.cipher, cipher);
                if let Err(error) = self.save(&state.saved) {
                    if let Some(account) = state.saved.account.as_mut() {
                        account.cipher = previous;
                    }
                    return Err(error);
                }
                return Ok((login, next));
            }
            if token.expires_at.is_some_and(|expires| expires <= now) {
                return Err(AUTH_REQUIRED);
            }
        }
        Ok((login, token))
    }

    fn record_error(&self, state: &mut State, error: &'static str) {
        if error == CANCELED {
            return;
        }
        if error == AUTH_REQUIRED {
            if let Some(account) = state.saved.account.as_mut() {
                account.expired = true;
            }
            let _ = self.save(&state.saved);
        }
        state.sync_error = Some(error);
    }

    pub(crate) async fn close(&self) {
        loop {
            {
                let Ok(mut state) = self.state() else { return };
                state.closed = true;
                let Some(task) = &state.active else { return };
                let _ = task.stop.send(true);
            }
            self.0.idle.notified().await;
        }
    }
}

fn guard(window: &WebviewWindow) -> std::result::Result<AppHandle, String> {
    if window.label() != "main" {
        return Err("IPC_SENDER_REJECTED".to_owned());
    }
    Ok(window.app_handle().clone())
}

fn reply(result: Result<Value>) -> Value {
    match result {
        Ok(state) => json!({"ok": true, "state": state}),
        Err(error) => json!({"ok": false, "error": error}),
    }
}

impl Work {
    fn store_device(&self, device: &Device) -> Result<()> {
        let mut state = self.host.state()?;
        if state.closed || *self.stop.borrow() {
            return Err(CANCELED);
        }
        state.device = Some(PublicDevice {
            user_code: device.user_code.clone(),
            verification_uri: github_api::DEVICE_PAGE,
            expires_at: iso_from_ms(now_ms() + device.expires_in as i64 * 1000),
        });
        drop(state);
        changed(&self.app);
        Ok(())
    }

    fn commit_account(&self, user: User, token: &Token) -> Result<()> {
        let cipher = seal(&user.login, token)?;
        let mut state = self.host.state()?;
        if state.closed || *self.stop.borrow() {
            return Err(CANCELED);
        }
        let different = state
            .saved
            .account
            .as_ref()
            .is_none_or(|account| !account.user.login.eq_ignore_ascii_case(&user.login));
        let previous_sync = different.then(|| std::mem::take(&mut state.saved.sync));
        let previous = state.saved.account.replace(Account {
            user,
            cipher,
            connected_at: iso_from_ms(now_ms()),
            expired: false,
        });
        if let Err(error) = self.host.save(&state.saved) {
            state.saved.account = previous;
            if let Some(previous) = previous_sync {
                state.saved.sync = previous;
            }
            return Err(error);
        }
        if different {
            state.repositories = None;
            state.sync_error = None;
        }
        Ok(())
    }

    async fn poll(self, device: Device) {
        let result = self.authorize(&device).await;
        if let Err(error) = result {
            if error != CANCELED {
                if let Ok(mut state) = self.host.state() {
                    if !state.closed && !*self.stop.borrow() {
                        state.connect_error = Some(error);
                    }
                }
            }
        }
    }

    async fn authorize(&self, device: &Device) -> Result<()> {
        let api = self.host.api()?;
        let deadline = Instant::now() + Duration::from_secs(device.expires_in);
        let flow = async {
            let mut interval = device.interval;
            loop {
                tokio::time::sleep(Duration::from_secs(interval)).await;
                match api.poll_device(device).await? {
                    Poll::Pending => {}
                    Poll::SlowDown => interval += 5,
                    Poll::Authorized(token) => {
                        let user = api.user(&token.token).await?;
                        return Ok((user, token));
                    }
                }
            }
        };
        let (user, token) = cancellable(self.stop.clone(), async {
            tokio::time::timeout_at(deadline, flow)
                .await
                .map_err(|_| "GITHUB_CODE_EXPIRED")?
        })
        .await?;
        self.commit_account(user, &token)
    }
}

async fn connect(app: &AppHandle) -> Result<Value> {
    let host = app.state::<GithubHost>();
    let api = host.api()?;
    let work = host.begin(app, Job::Connect)?;
    host.state()?.connect_error = None;
    let device = match cancellable(work.stop.clone(), api.start_device()).await {
        Err(CANCELED) => {
            drop(work);
            return host.view();
        }
        result => result?,
    };
    work.store_device(&device)?;
    let view = host.view()?;
    tauri::async_runtime::spawn(work.poll(device));
    Ok(view)
}

fn cancel(host: &GithubHost) -> Result<Value> {
    let mut state = host.state()?;
    if let Some(task) = state
        .active
        .as_ref()
        .filter(|task| task.job == Job::Connect)
    {
        let _ = task.stop.send(true);
    }
    state.device = None;
    state.connect_error = None;
    drop(state);
    host.view()
}

fn disconnect(host: &GithubHost) -> Result<Value> {
    let mut state = host.state()?;
    if state.closed {
        return Err(NOT_CONFIGURED);
    }
    if let Some(task) = &state.active {
        if task.job != Job::Connect || state.device.is_none() {
            return Err(BUSY);
        }
        let _ = task.stop.send(true);
    }
    let next = Saved {
        device: state.saved.device.clone(),
        ..Saved::default()
    };
    host.save(&next)?;
    state.saved = next;
    state.device = None;
    state.connect_error = None;
    state.sync_error = None;
    state.repositories = None;
    drop(state);
    host.view()
}

fn set_sync(host: &GithubHost, request: SyncRequest) -> Result<Value> {
    let mut state = host.state()?;
    if state.closed {
        return Err(NOT_CONFIGURED);
    }
    if state.active.is_some() {
        return Err(BUSY);
    }
    let account = state
        .saved
        .account
        .as_ref()
        .filter(|account| !account.expired)
        .ok_or(NOT_CONNECTED)?;
    if request
        .repository
        .as_ref()
        .is_some_and(|name| !github_api::owned_repository(name, &account.user.login))
        || request.enabled
            && request.repository.as_ref().is_none_or(|name| {
                state
                    .repositories
                    .as_ref()
                    .is_some_and(|repos| !repos.contains(name))
            })
    {
        return Err(REPOSITORY_INVALID);
    }
    let preserve = state.saved.sync.repository == request.repository;
    let mut next = if preserve {
        state.saved.sync.clone()
    } else {
        SyncPreferences::default()
    };
    next.enabled = request.enabled;
    next.repository = request.repository;
    let previous = std::mem::replace(&mut state.saved.sync, next);
    if let Err(error) = host.save(&state.saved) {
        state.saved.sync = previous;
        return Err(error);
    }
    state.sync_error = None;
    drop(state);
    host.view()
}

async fn list(app: &AppHandle) -> Result<Value> {
    let host = app.state::<GithubHost>();
    let work = host.begin(app, Job::List)?;
    let result = cancellable(work.stop.clone(), async {
        let api = host.api()?;
        let (login, token) = host.credential().await?;
        api.repositories(&token.token, &login).await
    })
    .await;
    {
        let mut state = host.state()?;
        match result {
            Ok(repos) => {
                state.repositories = Some(repos);
                state.sync_error = None;
            }
            Err(error) => {
                state.repositories = None;
                host.record_error(&mut state, error);
            }
        }
    }
    drop(work);
    host.view()
}

async fn sync(app: &AppHandle) -> Result<Value> {
    let host = app.state::<GithubHost>();
    let work = host.begin(app, Job::Sync)?;
    let (repository, device) = {
        let mut state = host.state()?;
        if state.closed {
            return Err(NOT_CONFIGURED);
        }
        let sync = &state.saved.sync;
        let repository = sync
            .repository
            .as_ref()
            .filter(|_| sync.enabled)
            .ok_or(REPOSITORY_INVALID)?
            .clone();
        let device = match state
            .saved
            .device
            .as_deref()
            .and_then(|saved| Uuid::parse_str(saved).ok())
        {
            Some(value) => value,
            None => {
                let device = Uuid::new_v4();
                let previous = state.saved.device.replace(device.to_string());
                if let Err(error) = host.save(&state.saved) {
                    state.saved.device = previous;
                    return Err(error);
                }
                device
            }
        };
        (repository, device)
    };
    host.state()?.sync_error = None;
    let at = iso_from_ms(now_ms());
    let result = cancellable(work.stop.clone(), async {
        let api = host.api()?;
        let (login, token) = host.credential().await?;
        let (payload, days) = reader::github_sync_body(app.clone(), device.to_string(), at.clone())
            .await
            .map_err(|_| FAILED)?;
        api.put(&token.token, &login, &repository, device, &payload)
            .await?;
        Ok(days)
    })
    .await;
    {
        let mut state = host.state()?;
        match result {
            Ok(days) => {
                let previous = state.saved.sync.clone();
                state.saved.sync.last_success = Some(at);
                state.saved.sync.days = Some(days);
                if let Err(error) = host.save(&state.saved) {
                    state.saved.sync = previous;
                    host.record_error(&mut state, error);
                }
            }
            Err(error) => host.record_error(&mut state, error),
        }
    }
    drop(work);
    host.view()
}

#[tauri::command]
pub(crate) fn github_get(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    Ok(reply(app.state::<GithubHost>().view()))
}

#[tauri::command]
pub(crate) async fn github_connect(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    Ok(reply(connect(&app).await))
}

#[tauri::command]
pub(crate) fn github_cancel(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    let result = cancel(&app.state::<GithubHost>());
    changed(&app);
    Ok(reply(result))
}

#[tauri::command]
pub(crate) fn github_disconnect(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    let result = disconnect(&app.state::<GithubHost>());
    changed(&app);
    Ok(reply(result))
}

#[tauri::command]
pub(crate) async fn github_repositories(
    window: WebviewWindow,
) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    Ok(reply(list(&app).await))
}

#[tauri::command]
pub(crate) fn github_set_sync(
    window: WebviewWindow,
    request: SyncRequest,
) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    let result = set_sync(&app.state::<GithubHost>(), request);
    changed(&app);
    Ok(reply(result))
}

#[tauri::command]
pub(crate) async fn github_sync_now(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = guard(&window)?;
    Ok(reply(sync(&app).await))
}

#[tauri::command]
pub(crate) async fn github_copy_code(window: WebviewWindow) -> std::result::Result<bool, String> {
    let app = guard(&window)?;
    let code = app
        .state::<GithubHost>()
        .state()
        .map_err(str::to_owned)?
        .device
        .as_ref()
        .map(|device| device.user_code.clone());
    let Some(code) = code else { return Ok(false) };
    desktop_io::clipboard(app, code).await.map(|_| true)
}

#[tauri::command]
pub(crate) fn github_open(window: WebviewWindow, url: String) -> std::result::Result<bool, String> {
    let app = guard(&window)?;
    if reader::is_probe(&app)
        || !github_api::openable(&url, app.state::<GithubHost>().0.install_url.as_deref())
    {
        return Ok(false);
    }
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map(|_| true)
        .map_err(|_| FAILED.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_settings_and_dpapi_credential_survive_restart_without_leaking(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let host = GithubHost::open(root.path(), true);
        let grant = Token {
            token: "synthetic-github-grant".to_owned(),
            refresh_token: Some("synthetic-github-refresh".to_owned()),
            expires_at: Some(now_ms() + 60_000),
        };
        let account = Account {
            user: User {
                login: "fixture-user".to_owned(),
                name: None,
                avatar: None,
            },
            connected_at: iso_from_ms(now_ms()),
            expired: false,
            cipher: seal("fixture-user", &grant)?,
        };
        assert!(unseal("other-user", &account.cipher).is_err());
        host.state()?.saved.account = Some(account);
        assert_eq!(
            set_sync(
                &host,
                SyncRequest {
                    enabled: true,
                    repository: Some("other-user/test".into())
                }
            ),
            Err(REPOSITORY_INVALID)
        );
        set_sync(
            &host,
            SyncRequest {
                enabled: true,
                repository: Some("fixture-user/synthetic".into()),
            },
        )?;
        let bytes = fs::read(root.path().join("github.json"))?;
        assert!(!String::from_utf8_lossy(&bytes).contains(&grant.token));
        let reopened = GithubHost::open(root.path(), true);
        assert_eq!(reopened.auth()?.1.token, grant.token);
        let view = reopened.view()?;
        assert_eq!(view["connection"]["status"], "connected");
        assert_eq!(view["sync"]["repository"], "fixture-user/synthetic");
        assert!(!view.to_string().contains(&grant.token));
        assert!(view["connection"].get("cipher").is_none());
        assert_eq!(disconnect(&reopened)?["connection"]["status"], "none");
        assert!(matches!(
            GithubHost::open(root.path(), true).auth(),
            Err(NOT_CONNECTED)
        ));
        Ok(())
    }
}
