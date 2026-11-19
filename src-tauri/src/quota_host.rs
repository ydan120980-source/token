use quota_engine::{
    account_service::{
        message, AccountError, AccountService, ManualConnect, ReadAccount, ReadResult,
        RefreshOutcome,
    },
    provider_adapters::{from_provider, AdapterOptions},
    provider_http::{ProviderHttp, ProviderHttpError},
    provider_oauth,
    provider_observation::{observe_provider, Observation, ObservationError},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::watch;
use usage_engine::time::{iso_from_ms, now_ms};

pub struct QuotaHost {
    pub accounts: AccountService,
    http: OnceLock<Result<ProviderHttp, ProviderHttpError>>,
    probe: bool,
    cadence: watch::Sender<Cadence>,
    refreshing_all: AtomicBool,
    last_batch: Mutex<Option<Value>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Cadence {
    Off,
    At(i64),
    Closed,
}

const INTERVAL: i64 = 60_000;

impl QuotaHost {
    pub fn open(root: &Path, probe: bool) -> Result<Self, AccountError> {
        Ok(Self {
            accounts: AccountService::open(root)?,
            http: OnceLock::new(),
            probe,
            cadence: watch::channel(Cadence::Off).0,
            refreshing_all: AtomicBool::new(false),
            last_batch: Mutex::new(None),
        })
    }

    async fn observe(&self, mut request: ReadAccount) -> Result<ReadResult, ObservationError> {
        if self.probe {
            if request.adapter != "deepseek-api"
                || request.secret.credential.as_str() != "synthetic-fixture-key"
            {
                return Err(ProviderHttpError::AuthRequired.into());
            }
            let resources = from_provider(
                "deepseek-api",
                &json!({"is_available":true,
                "balance_infos":[{"currency":"USD","total_balance":"9007199254740993.125"}]}),
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

    fn quota_state(&self, version_two: bool) -> Result<Value, String> {
        let mut state = self
            .accounts
            .quota_state(version_two, now_ms())
            .map_err(|error| error.to_string())?;
        if let Cadence::At(due) = *self.cadence.borrow() {
            state["autoRefresh"] = json!("1min");
            state["nextAutoAt"] = json!(iso_from_ms(due));
        }
        state["lastProviderBatch"] = json!(*self
            .last_batch
            .lock()
            .map_err(|_| "PROVIDER_STORAGE_FAILED")?);
        Ok(state)
    }

    pub async fn close(&self) -> Result<(), AccountError> {
        self.cadence.send_replace(Cadence::Closed);
        self.accounts.close().await
    }
}

struct Batch<'a>(&'a AtomicBool);

impl Drop for Batch<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

async fn refresh_batch(app: &AppHandle) -> Result<(), String> {
    let host = app.state::<QuotaHost>();
    if host
        .refreshing_all
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(());
    }
    let _batch = Batch(&host.refreshing_all);
    let mut reads = tokio::task::JoinSet::new();
    for id in host
        .accounts
        .refreshable()
        .map_err(|error| error.to_string())?
    {
        let app = app.clone();
        reads.spawn(async move {
            let host = app.state::<QuotaHost>();
            host.accounts
                .refresh(&id, |request| host.observe(request))
                .await
        });
    }
    let (mut success, mut failed, mut skipped) = (0, 0, 0);
    while let Some(outcome) = reads.join_next().await {
        match outcome {
            Ok(Ok(RefreshOutcome::Published)) => success += 1,
            Ok(
                Ok(RefreshOutcome::Skipped)
                | Err(AccountError::Canceled | AccountError::AuthRequired | AccountError::NotFound),
            ) => skipped += 1,
            _ => failed += 1,
        }
    }
    *host
        .last_batch
        .lock()
        .map_err(|_| "PROVIDER_STORAGE_FAILED")? = Some(json!({
        "success":success,"failed":failed,"skipped":skipped
    }));
    changed(app);
    Ok(())
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
            let _ = refresh_batch(&app).await;
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

fn guard(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("IPC_SENDER_REJECTED".to_owned())
    }
}

pub fn changed(app: &AppHandle) {
    let _ = app.emit_to("main", "quota:providerUpdate", ());
    let _ = app.emit_to("main", "quota:update", ());
    let _ = app.emit_to(crate::tray_card::CARD, "tray:update", ());
}

fn provider_reply(host: &QuotaHost, result: Result<(), AccountError>) -> Result<Value, String> {
    let state = host
        .accounts
        .provider_state(now_ms())
        .map_err(|error| error.to_string())?;
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
    let result = host
        .accounts
        .connect(request, |request| host.observe(request))
        .await;
    if result.is_ok() {
        changed(window.app_handle());
    }
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
        ProviderAction::Refresh { id } => host
            .accounts
            .refresh(&id, |request| host.observe(request))
            .await
            .map(|_| ()),
        ProviderAction::Cancel { id } => host.accounts.cancel(&id),
        ProviderAction::Remove { id } => host.accounts.remove(&id),
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
    refresh_batch(window.app_handle()).await?;
    quota_get(window, host, false)
}

#[tauri::command]
pub fn quota_set_auto_refresh(
    window: WebviewWindow,
    host: State<'_, QuotaHost>,
    value: String,
) -> Result<Value, String> {
    guard(&window)?;
    let cadence = match value.as_str() {
        "off" => Cadence::Off,
        "1min" => Cadence::At(now_ms().saturating_add(INTERVAL)),
        _ => {
            return Ok(json!({"ok":false,"errorCode":"CANCELED","state":host.quota_state(false)?}))
        }
    };
    let updated = host.cadence.send_if_modified(|current| {
        if *current == Cadence::Closed {
            return false;
        }
        *current = cadence;
        true
    });
    if updated {
        changed(window.app_handle());
    }
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
                "从所选目录复制账户和历史额度，并尝试恢复本 Windows 用户保存的 QuotaDock 凭据？",
            )
            .title("导入旧版 QuotaDock 账户")
            .buttons(MessageDialogButtons::OkCancel)
            .blocking_show();
        if !confirmed {
            return;
        }
        let text = match host.accounts.import(&source, now_ms()) {
            Ok(report) => {
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
