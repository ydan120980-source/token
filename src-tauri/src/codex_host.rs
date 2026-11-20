use crate::quota_host::{changed, guard, QuotaHost};
use quota_engine::account_service::RefreshOutcome;
use quota_engine::{
    codex_rpc::{CodexRpc, Error},
    windows_job::ExecutablePin,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::watch;
use usage_engine::time::now_ms;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Runtime {
    pub executable: PathBuf,
    pub sha256: String,
}

pub struct CodexHost {
    root: PathBuf,
    state: Mutex<Inner>,
}

struct Inner {
    runtime: Option<Runtime>,
    active: Option<Operation>,
    closed: bool,
}

struct Operation {
    id: Option<String>,
    alias: Option<String>,
    canceled: watch::Sender<bool>,
    done: watch::Sender<bool>,
}

struct Ticket<'a> {
    host: &'a CodexHost,
    app: &'a AppHandle,
}

const REQUIRED: &str = "CODEX_EXECUTABLE_REQUIRED";

impl CodexHost {
    pub fn open(root: &Path, probe: bool) -> Self {
        let runtime = if probe {
            None
        } else {
            read_runtime(&root.join("codex-runtime.json"))
        };
        Self {
            root: root.to_path_buf(),
            state: Mutex::new(Inner {
                runtime,
                active: None,
                closed: false,
            }),
        }
    }

    pub fn enrich(&self, state: &mut Value) -> Result<(), String> {
        let inner = self.state.lock().map_err(|_| "PROVIDER_STORAGE_FAILED")?;
        state["executableAvailable"] = json!(inner.runtime.is_some());
        state["operationBusy"] = json!(inner.active.is_some() || state["operationBusy"] == true);
        if let Some(operation) = &inner.active {
            if let Some(id) = &operation.id {
                let rows = state["accounts"]
                    .as_array_mut()
                    .ok_or("CODEX_PROTOCOL_INVALID")?;
                if let Some(alias) = &operation.alias {
                    state["pendingLogin"] = json!({"accountId":id});
                    state["accounts"].as_array_mut().ok_or("CODEX_PROTOCOL_INVALID")?.push(json!({
                        "id":id,"alias":alias,"provider":"codex","status":"connecting","busy":true,
                        "quota":null,"plan":null,"lastAttempt":null,"errorCode":null,"nextRefreshAt":null
                    }));
                } else if let Some(row) = rows.iter_mut().find(|row| row["id"] == *id) {
                    row["busy"] = json!(true);
                }
            }
        }
        Ok(())
    }

    fn begin<'a>(
        &'a self,
        app: &'a AppHandle,
        id: Option<&str>,
        alias: Option<&str>,
        needs_runtime: bool,
    ) -> Result<(Ticket<'a>, Option<ExecutablePin>, watch::Receiver<bool>), String> {
        let mut inner = self.state.lock().map_err(|_| "PROVIDER_STORAGE_FAILED")?;
        if inner.closed || inner.active.is_some() {
            return Err("RUNTIME_BUSY".to_owned());
        }
        let pin = if needs_runtime {
            let runtime = inner.runtime.as_ref().ok_or(REQUIRED)?;
            Some(
                ExecutablePin::from_sha256(&runtime.executable, &runtime.sha256)
                    .map_err(|_| REQUIRED)?,
            )
        } else {
            None
        };
        let (canceled, receiver) = watch::channel(false);
        inner.active = Some(Operation {
            id: id.map(str::to_owned),
            alias: alias.map(str::to_owned),
            canceled,
            done: watch::channel(false).0,
        });
        drop(inner);
        changed(app);
        Ok((Ticket { host: self, app }, pin, receiver))
    }

    pub async fn close(&self) -> Result<(), String> {
        let pending = {
            let mut state = self.state.lock().map_err(|_| "PROVIDER_STORAGE_FAILED")?;
            state.closed = true;
            state.active.as_ref().map(|operation| {
                operation.canceled.send_replace(true);
                operation.done.subscribe()
            })
        };
        if let Some(mut pending) = pending {
            let _ = pending.wait_for(|done| *done).await;
        }
        Ok(())
    }

    fn home(&self, id: &str) -> Result<PathBuf, String> {
        if uuid::Uuid::parse_str(id).is_err() {
            return Err("ACCOUNT_NOT_FOUND".to_owned());
        }
        let home = self.root.join("codex-homes").join(id);
        check_path(&home).map_err(|_| "PROVIDER_STORAGE_FAILED".to_owned())?;
        Ok(home)
    }
}

impl Drop for Ticket<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.host.state.lock() {
            if let Some(active) = state.active.take() {
                active.done.send_replace(true);
            }
        }
        changed(self.app);
    }
}

fn check_path(path: &Path) -> std::io::Result<()> {
    for part in path.ancestors() {
        match fs::symlink_metadata(part) {
            Ok(meta) if meta.file_attributes() & 0x400 != 0 => {
                return Err(std::io::ErrorKind::PermissionDenied.into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn read_runtime(file: &Path) -> Option<Runtime> {
    check_path(file).ok()?;
    let handle = OpenOptions::new().read(true).open(file).ok()?;
    if !handle.metadata().ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    handle.take(32768).read_to_end(&mut bytes).ok()?;
    let selected: Runtime = serde_json::from_slice(&bytes).ok()?;
    let _ = ExecutablePin::from_sha256(&selected.executable, &selected.sha256).ok()?;
    selected.executable.is_file().then_some(selected)
}

fn reply(host: &QuotaHost, result: Result<(), String>) -> Result<Value, String> {
    let state = host.quota_state(false)?;
    if let Err(code) = result {
        let error = match code.as_str() {
            REQUIRED => "请先选择官方 Codex CLI 的 codex.exe。",
            "LOGIN_REQUIRED" => "需要在官方窗口重新完成 Codex 登录，历史额度仍保留。",
            "SYSTEM_CREDENTIAL_STORE_REQUIRED" => "Codex 未确认使用系统凭据库，连接已停止。",
            "LOGIN_CANCELED" => "已取消本次连接。",
            _ => "Codex 操作未完成，请检查 CLI 后重试。",
        };
        Ok(json!({"ok":false,"state":state,"errorCode":code,"error":error}))
    } else {
        Ok(json!({"ok":true,"state":state}))
    }
}

async fn run_login(host: &QuotaHost, app: &AppHandle, alias: &str) -> Result<(), String> {
    if host.probe {
        return Err("PROVIDER_FIXTURE_BLOCKED".to_owned());
    }
    if alias.encode_utf16().count() > 48 || alias.chars().any(char::is_control) {
        return Err("ALIAS_INVALID".to_owned());
    }
    host.accounts
        .can_add_codex()
        .map_err(|error| error.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let home = host.codex.home(&id)?;
    let alias = alias.trim();
    let (_ticket, pin, canceled) = host.codex.begin(app, Some(&id), Some(alias), true)?;
    let pin = pin.ok_or(REQUIRED)?;
    let read = tauri::async_runtime::spawn_blocking(move || {
        let _ = fs::create_dir_all(home.parent().ok_or(Error::Unavailable)?)
            .map_err(|_| Error::Unavailable)?;
        fs::create_dir(&home).map_err(|_| Error::Unavailable)?;
        let result = (|| {
            let canceled = || *canceled.borrow();
            let mut session = CodexRpc::launch(&pin, &home, &canceled)?;
            session.login(&canceled, |url| {
                tauri_plugin_opener::open_url(url.as_str(), None::<&str>)
                    .map_err(|_| Error::Browser)
            })?;
            let report = session.refresh(&canceled);
            if report.is_err() && !canceled() {
                let _ = session.logout(&canceled);
            }
            report
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&home);
        }
        result
    })
    .await
    .map_err(|_| "CODEX_PROCESS_UNAVAILABLE".to_owned())?;
    let quota = read.map_err(|error| error.to_string())?;
    host.accounts
        .publish_codex(&id, Some(alias), quota)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn quota_login(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    alias: String,
) -> Result<Value, String> {
    guard(&window)?;
    let result = run_login(&host, window.app_handle(), &alias).await;
    reply(&host, result)
}

#[tauri::command]
pub async fn quota_cancel(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
) -> Result<Value, String> {
    guard(&window)?;
    let pending = {
        let state = host
            .codex
            .state
            .lock()
            .map_err(|_| "PROVIDER_STORAGE_FAILED")?;
        state
            .active
            .as_ref()
            .filter(|op| op.alias.is_some())
            .map(|op| {
                op.canceled.send_replace(true);
                op.done.subscribe()
            })
    };
    if let Some(mut pending) = pending {
        let _ = pending.wait_for(|done| *done).await;
    }
    reply(&host, Ok(()))
}

pub async fn refresh(
    host: &QuotaHost,
    app: &AppHandle,
    id: &str,
    automatic: bool,
) -> Result<RefreshOutcome, String> {
    use crate::quiet_refresh::Attempt;
    let first = if automatic { Attempt::Scheduled } else { Attempt::Manual };
    if let Some(result) = refresh_once(host, app, id, first).await? {
        return Ok(result);
    }
    if !host.wait_for_quiet_retry().await {
        return Ok(RefreshOutcome::Skipped);
    }
    Ok(refresh_once(host, app, id, Attempt::Retry).await?.unwrap_or(RefreshOutcome::Failed))
}

async fn refresh_once(
    host: &QuotaHost,
    app: &AppHandle,
    id: &str,
    attempt: crate::quiet_refresh::Attempt,
) -> Result<Option<RefreshOutcome>, String> {
    let automatic = attempt.automatic();
    host.accounts
        .codex_account(id)
        .map_err(|error| error.to_string())?;
    let home = host.codex.home(id)?;
    if !home.is_dir() {
        return Err("LOGIN_REQUIRED".to_owned());
    }
    if !host
        .accounts
        .codex_refresh_due(id, now_ms())
        .map_err(|error| error.to_string())?
    {
        return Ok(Some(RefreshOutcome::Skipped));
    }
    let prior = automatic && crate::quota_host::has_healthy_quota(
        &host.accounts.quota_state(true, now_ms()).map_err(|error| error.to_string())?, id
    );
    let (_ticket, pin, mut canceled) = host.codex.begin(app, Some(id), None, true)?;
    let pin = pin.ok_or(REQUIRED)?;
    let permit = tokio::select! {
        biased;
        _ = canceled.wait_for(|value| *value) => return Ok(Some(RefreshOutcome::Skipped)),
        permit = host.accounts.acquire_codex_refresh(id) => permit.map_err(|error| error.to_string())?,
    };
    let at = now_ms();
    let cancel_check = canceled.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let canceled = || *cancel_check.borrow() || cancel_check.has_changed().is_err();
        CodexRpc::launch(&pin, &home, &canceled)?.refresh(&canceled)
    })
    .await
    .map_err(|_| "CODEX_PROCESS_UNAVAILABLE".to_owned())?;
    drop(permit);
    if *canceled.borrow() {
        return Ok(Some(RefreshOutcome::Skipped));
    }
    match outcome {
        Ok(quota) => {
            host.accounts
                .publish_codex(id, None, quota)
                .map_err(|error| error.to_string())?;
            host.quiet.forget(id);
            crate::desktop_shell::record_read(app, id, None, automatic);
            Ok(Some(RefreshOutcome::Published))
        }
        Err(error) => {
            let code = error.to_string();
            if host.quiet.can_hide(id, attempt, prior, &code) {
                host.quiet.hidden(id, attempt, None);
                crate::desktop_shell::record_quiet_read(app, id, &code);
                return Ok(None);
            }
            host.accounts
                .record_codex_failure(id, &code, at)
                .map_err(|error| error.to_string())?;
            host.quiet.forget(id);
            crate::desktop_shell::record_read(app, id, Some(&code), automatic);
            Err(code)
        }
    }
}

#[tauri::command]
pub async fn quota_refresh(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    id: String,
) -> Result<Value, String> {
    guard(&window)?;
    let result = refresh(&host, window.app_handle(), &id, false)
        .await
        .map(|_| ());
    reply(&host, result)
}

async fn remove(host: &QuotaHost, window: &WebviewWindow, id: &str) -> Result<(), String> {
    let alias = host
        .accounts
        .codex_account(id)
        .map_err(|error| error.to_string())?;
    let home = host.codex.home(id)?;
    let has_home = home.is_dir();
    let (_ticket, pin, canceled) =
        host.codex
            .begin(window.app_handle(), Some(id), None, has_home)?;
    let confirm = {
        let window = window.clone();
        tauri::async_runtime::spawn_blocking(move || {
            window
                .dialog()
                .message(format!("移除 {alias} 的独立连接及本应用的额度缓存？"))
                .buttons(MessageDialogButtons::OkCancel)
                .blocking_show()
        })
        .await
        .map_err(|_| "CODEX_PROCESS_UNAVAILABLE".to_owned())?
    };
    if !confirm || *canceled.borrow() {
        return Ok(());
    }
    if let Some(pin) = pin {
        tauri::async_runtime::spawn_blocking(move || {
            let canceled = || *canceled.borrow();
            CodexRpc::launch(&pin, &home, &canceled)?.logout(&canceled)?;
            fs::remove_dir_all(&home).map_err(|_| Error::Unavailable)
        })
        .await
        .map_err(|_| "CODEX_PROCESS_UNAVAILABLE".to_owned())?
        .map_err(|error| error.to_string())?;
    }
    host.accounts
        .remove(id)
        .map_err(|error| error.to_string())?;
    crate::desktop_shell::forget(window.app_handle(), id);
    Ok(())
}

#[tauri::command]
pub async fn quota_remove(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    id: String,
) -> Result<Value, String> {
    guard(&window)?;
    let result = remove(&host, &window, &id).await;
    reply(&host, result)
}

async fn choose(host: &QuotaHost, window: &WebviewWindow) -> Result<(), String> {
    if host.probe {
        return Err("PROVIDER_FIXTURE_BLOCKED".to_owned());
    }
    let (_ticket, _, canceled) = host.codex.begin(window.app_handle(), None, None, false)?;
    let window = window.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        let selected = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择官方 Codex CLI 的 codex.exe")
            .add_filter("Codex", &["exe"])
            .blocking_pick_file();
        let Some(executable) = selected.and_then(|file| file.into_path().ok()) else {
            return Ok(None);
        };
        if !executable
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("codex.exe"))
        {
            return Err(REQUIRED);
        }
        let pin = ExecutablePin::new(&executable).map_err(|_| REQUIRED)?;
        Ok(Some(Runtime {
            executable,
            sha256: pin.sha256(),
        }))
    })
    .await
    .map_err(|_| REQUIRED)??;
    if let Some(runtime) = selected.filter(|_| !*canceled.borrow()) {
        let data = serde_json::to_value(&runtime).map_err(|_| "PROVIDER_STORAGE_FAILED")?;
        usage_engine::store_io::atomic(&host.codex.root.join("codex-runtime.json"), &data, false)
            .map_err(|_| "PROVIDER_STORAGE_FAILED")?;
        host.codex
            .state
            .lock()
            .map_err(|_| "PROVIDER_STORAGE_FAILED")?
            .runtime = Some(runtime);
    }
    Ok(())
}

#[tauri::command]
pub async fn quota_choose_executable(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
) -> Result<Value, String> {
    guard(&window)?;
    let result = choose(&host, &window).await;
    reply(&host, result)
}
