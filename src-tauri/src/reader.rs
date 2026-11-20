use crate::{desktop_io, window_shell};
use serde_json::{json, Value};
use std::{
    env,
    error::Error,
    fs::{self, File},
    io::{self, BufRead, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use usage_engine::{
    custom_sources::{self, CustomSources},
    collection_diagnostic::{self, CollectionFailure},
    cost_export, local_snapshot, policy,
    session_labels::SessionLabels,
    session_list::{valid_key, SessionList},
    sources::{scan_sources, ScanOptions},
    store::Store,
    transcript::{FindRequest, MarkdownRequest, PartRequest},
    transcript_store::{FileHistoryRequest, SearchRequest, TranscriptRequest},
    transcript_tasks::TranscriptTasks,
};

#[cfg(windows)]
#[path = "config_host.rs"]
mod config_host;

#[cfg(windows)]
#[path = "agent_inventory_host.rs"]
mod agent_inventory_host;

#[cfg(windows)]
#[path = "agent_install_host.rs"]
mod agent_install_host;

#[cfg(windows)]
#[path = "agent_setup_host.rs"]
mod agent_setup_host;

#[path = "codex_maintenance_host.rs"]
mod codex_maintenance_host;

#[path = "price_sync.rs"]
mod price_sync;

const MAIN: &str = "main";

#[tauri::command]
async fn usage_export_statistics(
    window: WebviewWindow,
    app: AppHandle,
    payload: Value,
) -> Result<Value, String> {
    let (text, rows) = blocking(app, move |reader| {
        reader.with_store(|store| local_snapshot::serialize_statistics(&payload, &store.catalog()))
    })
    .await?;
    desktop_io::save(
        window,
        "导出统计",
        "AgentUsage-statistics.json".to_owned(),
        "JSON",
        "json",
        text,
        Some(rows),
    )
    .await
}

#[tauri::command]
async fn usage_export_cost(
    window: WebviewWindow,
    app: AppHandle,
    request: Value,
) -> Result<Value, String> {
    let result = blocking(app, move |reader| {
        reader.with_store(|store| {
            let snapshot =
                local_snapshot::select_snapshot(&store.snapshot()?, Some(&store.catalog()))?;
            cost_export::cost_export(&snapshot, &request).map_err(|error| error.to_string())
        })
    })
    .await?;
    desktop_io::save(
        window,
        "导出费用",
        result.file_name,
        "CSV",
        "csv",
        result.csv,
        Some(result.rows),
    )
    .await
}

#[tauri::command]
async fn usage_export_projects(
    window: WebviewWindow,
    app: AppHandle,
    selection: Option<Value>,
) -> Result<Value, String> {
    let (text, rows) = blocking(app, move |reader| {
        reader.with_store(|store| {
            let view = store.workbench(&selection.unwrap_or_else(|| json!({})))?;
            Ok((
                usage_engine::workbench::csv(&view),
                view["projects"].as_array().map_or(0, Vec::len),
            ))
        })
    })
    .await?;
    desktop_io::save(
        window,
        "导出项目用量",
        "AgentUsage-projects.csv".to_owned(),
        "CSV",
        "csv",
        text,
        Some(rows),
    )
    .await
}

async fn transcript_markdown(
    app: AppHandle,
    key: String,
    request: &Value,
) -> Result<String, String> {
    if !valid_key(&key) {
        return Err("TRANSCRIPT_NOT_FOUND".to_owned());
    }
    let request: MarkdownRequest = serde_json::from_value(json!({
        "stamp": request["stamp"], "from": request["from"], "to": request["to"],
        "plain": request["plain"] == true
    }))
    .map_err(|_| "TRANSCRIPT_PART_INVALID".to_owned())?;
    match read(app, key, TranscriptRequest::Markdown(request)).await? {
        Value::String(text) => Ok(text),
        _ => Err("TRANSCRIPT_UNREADABLE".to_owned()),
    }
}

#[tauri::command]
async fn usage_transcript_copy(
    app: AppHandle,
    key: String,
    request: Value,
) -> Result<Value, String> {
    let text = transcript_markdown(app.clone(), key, &request).await?;
    desktop_io::clipboard(app, text).await
}

#[tauri::command]
async fn usage_transcript_export(
    window: WebviewWindow,
    app: AppHandle,
    key: String,
    request: Value,
) -> Result<Value, String> {
    let name = desktop_io::transcript_name(request["name"].as_str());
    let text = transcript_markdown(app, key, &request).await?;
    desktop_io::save(window, "导出对话", name, "Markdown", "md", text, None).await
}

#[tauri::command]
async fn usage_copy_text(app: AppHandle, text: String) -> Result<Value, String> {
    desktop_io::clipboard(app, text).await
}

#[tauri::command]
async fn usage_copy_resume(app: AppHandle, key: String) -> Result<Value, String> {
    if !valid_key(&key) {
        return Err("SESSION_NOT_FOUND".to_owned());
    }
    let text = blocking(app.clone(), move |reader| {
        reader.with_store(|store| {
            store
                .resume(&key)
                .ok_or_else(|| "SESSION_NOT_RESUMABLE".to_owned())
        })
    })
    .await?;
    desktop_io::clipboard(app, text).await
}

#[tauri::command]
async fn usage_open_link(url: String) -> Result<Value, String> {
    let url = desktop_io::link(&url)?;
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|_| "LINK_OPEN_FAILED")?;
    Ok(json!({"opened": true}))
}

#[tauri::command]
async fn usage_open_folder(app: AppHandle, key: String) -> Result<Value, String> {
    if !valid_key(&key) {
        return Err("SESSION_NOT_FOUND".to_owned());
    }
    let directory = blocking(app, move |reader| {
        reader.with_store(|store| {
            store
                .directory(&key)
                .ok_or_else(|| "DIRECTORY_NOT_FOUND".to_owned())
        })
    })
    .await?;
    let path = usage_engine::pathx::std_path(&directory);
    if !path.is_dir() {
        return Err("DIRECTORY_MISSING".to_owned());
    }
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|_| "DIRECTORY_OPEN_FAILED")?;
    Ok(json!({"opened": true, "path": directory}))
}

#[derive(Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PerformanceState {
    pub worker_starts: u64,
    pub requests: u64,
    pub completed: u64,
    pub failed: u64,
    pub max_in_flight: u64,
    pub packed_snapshot_bytes: u64,
    pub in_flight: u64,
    pub worker_present: bool,
}

#[derive(Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StatisticsLifecycle {
    pub worker_failures: u64,
    pub timeouts: u64,
    pub rejected: u64,
}

#[derive(Default)]
struct StatisticsMetrics {
    requests: PerformanceState,
    lifecycle: StatisticsLifecycle,
}

struct StatisticsRequest<'a> {
    metrics: &'a Mutex<StatisticsMetrics>,
    ok: bool,
}

impl<'a> StatisticsRequest<'a> {
    fn begin(metrics: &'a Mutex<StatisticsMetrics>) -> Self {
        if let Ok(mut stats) = metrics.lock() {
            stats.requests.requests += 1;
            stats.requests.in_flight += 1;
            stats.requests.max_in_flight =
                stats.requests.max_in_flight.max(stats.requests.in_flight);
        }
        Self { metrics, ok: false }
    }
}

impl Drop for StatisticsRequest<'_> {
    fn drop(&mut self) {
        if let Ok(mut stats) = self.metrics.lock() {
            stats.requests.completed += 1;
            stats.requests.in_flight -= 1;
            if !self.ok {
                stats.requests.failed += 1;
            }
        }
    }
}

struct Reader {
    store: Mutex<Option<Store>>,
    statistics: Mutex<StatisticsMetrics>,
    collection_wake: tokio::sync::Notify,
    opening: Mutex<()>,
    pending_command: Mutex<Option<String>>,
    active: AtomicBool,
    shutdown_pending: AtomicBool,
    labels: Mutex<SessionLabels>,
    custom: Mutex<CustomSources>,
    codex_maintenance: Mutex<Option<usage_engine::store::CodexMaintenance>>,
    #[cfg(windows)]
    config: config_host::ConfigHost,
    #[cfg(windows)]
    inventory: agent_inventory_host::InventoryHost,
    #[cfg(windows)]
    installers: agent_install_host::InstallHost,
    #[cfg(windows)]
    agent_setup: agent_setup_host::SetupHost,
    custom_protected: Vec<String>,
    roots: Value,
    price_sync: price_sync::PriceSync,
    usage_dir: PathBuf,
    profile_dir: PathBuf,
    _ledger_lock: Option<File>,
    source_home: Option<PathBuf>,
    collection_failure: Mutex<Option<CollectionFailure>>,
    probe: bool,
    cold_tray_probe: bool,
    start_in_tray: bool,
    probe_reads: [AtomicUsize; 6],
    tasks: TranscriptTasks,
}

impl Reader {
    fn count_probe_read(&self, index: usize) {
        if self.cold_tray_probe {
            self.probe_reads[index].fetch_add(1, Ordering::Relaxed);
        }
    }

    fn directory_name(&self) -> Result<&str, String> {
        self.usage_dir
            .to_str()
            .ok_or_else(|| "READER_STORAGE_FAILED".to_owned())
    }

    fn with_store<T>(
        &self,
        read: impl FnOnce(&mut Store) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut request = StatisticsRequest::begin(&self.statistics);
        let result = self.read_store(read);
        request.ok = result.is_ok();
        result
    }

    fn read_store<T>(
        &self,
        read: impl FnOnce(&mut Store) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut owner = self.store.lock().map_err(|_| "READER_STORAGE_FAILED")?;
        if !self.can_run_collection() {
            return Err("READER_WINDOW_CLOSED".to_owned());
        }
        if owner.is_none() {
            let store = Store::new(self.directory_name()?, &self.roots);
            if let Ok(mut stats) = self.statistics.lock() {
                stats.requests.worker_starts += 1;
                stats.requests.worker_present = store.is_ok();
                if store.is_err() {
                    stats.lifecycle.worker_failures += 1;
                }
            }
            *owner = Some(store?);
            self.collection_wake.notify_one();
        }
        read(owner.as_mut().ok_or("READER_STORAGE_FAILED")?)
    }

    fn collect(&self) -> Result<Value, String> {
        self.collect_with_preferences(false)
    }

    fn collect_with_preferences(&self, require_enabled: bool) -> Result<Value, String> {
        let result = self.with_store(|store| {
            if require_enabled && store.settings["enabled"] == false {
                return self.usage_state(store);
            }
            self.collect_in_store(store)?;
            self.usage_state(store)
        });
        self.collection_wake.notify_one();
        result
    }

    fn collect_in_store(&self, store: &mut Store) -> Result<(), String> {
        let salt = store.state["salt"].as_str().ok_or("READER_STORAGE_FAILED")?;
        let scan = scan_sources(
            &store.source_roots(),
            salt,
            &mut policy::Audit::new(),
            ScanOptions { cache: None, prepared: None },
        );
        let outcome = custom_sources::collect(store, &self.custom_protected)
            .map_err(|error| (error, "custom-source"))
            .and_then(|custom| {
                store.ingest_collection(Some(&scan), &Value::Null, Some(&custom))
                    .map_err(|error| (error, "ingest"))
            });
        let failure = outcome.err().map(|(error, stage)| {
            collection_diagnostic::failure(&json!({"message": error}), stage, "COLLECTION_FAILED")
        });
        *self.collection_failure.lock().map_err(|_| "READER_STORAGE_FAILED")? = failure;
        Ok(())
    }

    fn can_run_collection(&self) -> bool {
        self.active.load(Ordering::Acquire) && !self.shutdown_pending.load(Ordering::Acquire)
    }

    fn scheduled_interval(&self) -> Result<Option<u64>, String> {
        if !self.can_run_collection() {
            return Ok(None);
        }
        let owner = self.store.lock().map_err(|_| "READER_STORAGE_FAILED")?;
        Ok(owner.as_ref()
            .filter(|store| store.settings["enabled"] != false)
            .map(Store::refresh_interval_ms)
            .filter(|interval| *interval != 0))
    }

    fn collect_scheduled(&self, interval: u64) -> Result<bool, String> {
        let Ok(mut owner) = self.store.try_lock() else { return Ok(false) };
        let Some(store) = owner.as_mut() else { return Ok(false) };
        if !self.can_run_collection() || store.settings["enabled"] == false
            || store.refresh_interval_ms() != interval
        {
            return Ok(false);
        }
        let mut request = StatisticsRequest::begin(&self.statistics);
        self.collect_in_store(store)?;
        request.ok = true;
        Ok(true)
    }

    fn usage_state(&self, store: &mut Store) -> Result<Value, String> {
        let snapshot = local_snapshot::select_snapshot(&store.snapshot()?, Some(&store.catalog()))?;
        let failure = self
            .collection_failure
            .lock()
            .map_err(|_| "READER_STORAGE_FAILED")?;
        Ok(json!({
            "snapshotRevision": snapshot["sequence"],
            "checkedAt": snapshot["collectedAt"],
            "snapshot": snapshot,
        "enabled": store.settings["enabled"] != false,
            "refreshIntervalMs": store.refresh_interval_ms(),
            "subscriptions": store.subscriptions(),
            "collecting": false,
            "error": failure.as_ref().map(|failure| failure.error),
            "diagnostic": failure.as_ref().map(|failure| &failure.diagnostic),
            "audit": null
        }))
    }
}

async fn blocking<T: Send + 'static>(
    app: AppHandle,
    read: impl FnOnce(&Reader) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || read(&app.state::<Reader>()))
        .await
        .map_err(|_| "READER_TASK_FAILED".to_owned())?
}

#[cfg(windows)]
pub(crate) fn is_probe(app: &AppHandle) -> bool {
    app.state::<Reader>().probe
}

#[cfg(windows)]
pub(crate) async fn github_sync_body(
    app: AppHandle,
    device: String,
    at: String,
) -> Result<(String, usize), String> {
    blocking(app, move |reader| {
        reader.with_store(|store| {
            let snapshot = local_snapshot::select_snapshot(&store.snapshot()?, Some(&store.catalog()))?;
            let payload = usage_engine::github_sync_payload::payload(&snapshot, &device, &at)?;
            let days = payload.days.iter().map(|row| row.date)
                .collect::<std::collections::HashSet<_>>().len();
            let value = serde_json::to_value(payload).map_err(|_| "GITHUB_SYNC_SNAPSHOT_INVALID")?;
            Ok((usage_engine::js_json::stringify(&value), days))
        })
    }).await
}

fn start_collection_timer(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let reader = app.state::<Reader>();
        loop {
            let interval = blocking(app.clone(), Reader::scheduled_interval).await;
            let wake = reader.collection_wake.notified();
            let Ok(Some(interval)) = interval else {
                wake.await;
                continue;
            };
            tokio::select! {
                biased;
                _ = wake => continue,
                _ = tokio::time::sleep(Duration::from_millis(interval)) => {}
            }
            if matches!(blocking(app.clone(), move |reader| reader.collect_scheduled(interval)).await, Ok(true)) {
                let _ = app.emit_to(MAIN, "usage:update", ());
            }
        }
    });
}

#[tauri::command]
fn usage_performance_state(window: WebviewWindow) -> Result<PerformanceState, String> {
    let app = main_window_app(&window)?;
    let reader = app.state::<Reader>();
    reader.statistics.lock()
        .map(|metrics| metrics.requests)
        .map_err(|_| "READER_STORAGE_FAILED".to_owned())
}

#[tauri::command]
async fn usage_statistics_diagnostics(window: WebviewWindow) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    blocking(app, |reader| {
        // An observation must never open a ledger or collect a source.
        let owner = reader.store.lock().map_err(|_| "READER_STORAGE_FAILED")?;
        let statistics = reader.statistics.lock().map_err(|_| "READER_STORAGE_FAILED")?;
        Ok(json!({
            "requests": statistics.requests,
            "lifecycle": statistics.lifecycle,
            "owner": owner.as_ref().map(|store| json!({
                "storage": store.diagnostics(),
                "collectionStages": null,
                "projection": null,
                "reader": null,
                "memory": null
            }))
        }))
    }).await
}

#[tauri::command]
async fn usage_set_refresh_interval(window: WebviewWindow, value: Value) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let state = blocking(app.clone(), move |reader| {
        reader.with_store(|store| {
            if let Err(error) = store.set_refresh_interval_ms(&value) {
                if error == "REFRESH_INTERVAL_INVALID" {
                    if let Ok(mut statistics) = reader.statistics.lock() {
                        statistics.lifecycle.rejected += 1;
                    }
                }
                return Err(error);
            }
            reader.collection_wake.notify_one();
            reader.usage_state(store)
        })
    }).await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    Ok(state)
}

#[tauri::command]
async fn usage_get(app: AppHandle) -> Result<Value, String> {
    app.state::<Reader>().count_probe_read(0);
    blocking(app, |reader| {
        reader.with_store(|store| reader.usage_state(store))
    })
    .await
}

#[tauri::command]
async fn usage_refresh(app: AppHandle) -> Result<Value, String> {
    app.state::<Reader>().count_probe_read(1);
    let state = blocking(app.clone(), Reader::collect).await?;
    app.emit_to(MAIN, "usage:update", ())
        .map_err(|_| "READER_EVENT_FAILED")?;
    Ok(state)
}

#[tauri::command]
async fn usage_sessions(app: AppHandle, selection: Option<Value>) -> Result<SessionList, String> {
    app.state::<Reader>().count_probe_read(2);
    blocking(app, move |reader| {
        reader.with_store(|store| store.session_list(&selection.unwrap_or_else(|| json!({}))))
    })
    .await
}

#[tauri::command]
async fn usage_session_summary(
    app: AppHandle,
    selection: Option<Value>,
) -> Result<usage_engine::SessionSummary, String> {
    blocking(app, move |reader| {
        reader.with_store(|store| store.session_summary(&selection.unwrap_or_else(|| json!({}))))
    })
    .await
}

#[tauri::command]
async fn usage_sources(app: AppHandle) -> Result<Value, String> {
    blocking(app, |reader| {
        reader.with_store(|store| {
            let app_data = if reader.probe { None } else { env::var("APPDATA").ok() };
            let local_app_data = if reader.probe { None } else { env::var("LOCALAPPDATA").ok() };
            let mut result = store.discover_with_places(usage_engine::agent_traces::Places {
                home: reader.source_home.as_deref().and_then(Path::to_str),
                app_data: app_data.as_deref(),
                local_app_data: local_app_data.as_deref(),
            });
            result["custom"] = json!(custom_sources::describe(store, &reader.custom_protected));
            Ok(result)
        })
    })
    .await
}

#[tauri::command]
async fn usage_connections(app: AppHandle) -> Result<Value, String> {
    connections(app, quota_engine::connection_state::project_connections).await
}

#[tauri::command]
async fn usage_connections_v2(app: AppHandle) -> Result<Value, String> {
    connections(
        app,
        quota_engine::resource_connections::project_resource_connections,
    )
    .await
}

async fn connections(
    app: AppHandle,
    project: fn(quota_engine::connection_state::Inputs<'_>) -> Value,
) -> Result<Value, String> {
    #[cfg(windows)]
    let quota = app
        .state::<crate::quota_host::QuotaHost>()
        .accounts
        .quota_state(true, usage_engine::time::now_ms())
        .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    let quota = Value::Null;
    blocking(app, move |reader| {
        reader.with_store(|store| {
            let collection = json!({
                "enabled": store.settings["enabled"] != false,
                "checkedAt": store.state["updatedAt"],
            });
            Ok(project(quota_engine::connection_state::Inputs {
                catalog: &store.catalog(),
                collection: &collection,
                statuses: &store.state["statuses"],
                disabled: &store.settings["sources"]["disabled"],
                custom: &store.state["customSources"],
                discovered: &Value::Null,
                quota: &quota,
                now: usage_engine::time::now_ms(),
            }))
        })
    })
    .await
}

#[tauri::command]
async fn usage_set_enabled(app: AppHandle, value: bool) -> Result<Value, String> {
    let state = blocking(app.clone(), move |reader| {
        let state = reader.with_store(|store| {
            store.set_enabled(value)?;
            reader.collection_wake.notify_one();
            reader.usage_state(store)
        })?;
        if value {
            reader.collect_with_preferences(true)
        } else {
            Ok(state)
        }
    })
    .await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    Ok(state)
}

#[tauri::command]
async fn usage_choose_source(
    window: WebviewWindow,
    app: AppHandle,
    agent: String,
) -> Result<Value, String> {
    if !usage_engine::agent_catalog::is_builtin(&agent) {
        return Err("SOURCE_REJECTED".to_owned());
    }
    let chosen = desktop_io::choose_source(window, agent == "cursor").await?;
    let saved = chosen.is_some();
    let state = blocking(app.clone(), move |reader| {
        reader.with_store(|store| {
            let Some(chosen) = chosen else {
                let mut state = reader.usage_state(store)?;
                state["sourceSaved"] = json!(false);
                return Ok(state);
            };
            store.choose_source(&agent, chosen.to_str().ok_or("SOURCE_PATH_REJECTED")?)?;
            let mut state = reader.usage_state(store)?;
            state["sourceSaved"] = json!(true);
            state["sourceSelection"] = json!(store.source_selection());
            Ok(state)
        })
    })
    .await?;
    if saved {
        let _ = app.emit_to(MAIN, "usage:update", ());
    }
    Ok(state)
}

#[tauri::command]
async fn usage_change_source(
    app: AppHandle,
    name: String,
    agent: Option<String>,
    value: Option<Value>,
) -> Result<Value, String> {
    let result = blocking(app.clone(), move |reader| reader.with_store(|store| {
        store.apply_source_selection(&name, agent.as_deref(), &value.unwrap_or(Value::Null))?;
        let selection = store.source_selection();
        let discovery = store.discover_selected_sources(reader.source_home.as_deref().and_then(|path| path.to_str()));
        let state = reader.usage_state(store)?;
        Ok(json!({"saved":true,"selection":selection,"discovery":discovery,"discoveryError":null,"state":state}))
    })).await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    if result["state"]["enabled"] == true {
        tauri::async_runtime::spawn(async move {
            if blocking(app.clone(), |reader| reader.collect_with_preferences(true))
                .await
                .is_ok()
            {
                let _ = app.emit_to(MAIN, "usage:update", ());
            }
        });
    }
    Ok(result)
}

#[tauri::command]
async fn usage_reveal_source(window: WebviewWindow, file: String) -> Result<Value, String> {
    blocking(main_window_app(&window)?, move |reader| {
        let known = reader.with_store(|store| {
            Ok(custom_sources::is_granted_root(store, &file, &reader.custom_protected) || store.source_selection().iter().any(|entry| {
                entry["paths"]
                    .as_array()
                    .is_some_and(|paths| paths.iter().any(|entry| entry["path"] == file.as_str()))
            }))
        })?;
        if !known {
            return Err("SOURCE_PATH_UNKNOWN".to_owned());
        }
        if !usage_engine::pathx::std_path(&file).exists() {
            return Err("DIRECTORY_MISSING".to_owned());
        }
        tauri_plugin_opener::reveal_item_in_dir(file).map_err(|_| "DIRECTORY_OPEN_FAILED")?;
        Ok(json!({"shown": true}))
    })
    .await
}

fn custom_store<T>(
    reader: &Reader,
    operation: impl FnOnce(&mut CustomSources, &mut Store) -> Result<T, String>,
) -> Result<T, String> {
    reader.with_store(|store| {
        let mut custom = reader.custom.lock().map_err(|_| "CUSTOM_BUSY")?;
        operation(&mut custom, store)
    })
}

#[tauri::command]
async fn usage_custom_draft(window: WebviewWindow, id: Option<String>) -> Result<Value, String> {
    blocking(main_window_app(&window)?, move |reader| {
        custom_store(reader, |custom, store| custom.draft(store, id.as_deref(), None))
    }).await
}

#[tauri::command]
async fn usage_custom_choose(window: WebviewWindow, token: String) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    blocking(app, move |reader| {
        custom_store(reader, |custom, _| custom.validate_token(&token))?;
        let folders = window.dialog().file().set_parent(&window)
            .set_title("选择自定义 Agent 用量目录").blocking_pick_folders();
        let Some(folders) = folders else { return Ok(json!({"canceled":true})); };
        let roots = folders.into_iter().map(|folder| {
            let folder = folder.into_path().map_err(|_| "SOURCE_PATH_REJECTED")?;
            policy::local_path(folder.to_str().ok_or("SOURCE_PATH_REJECTED")?)
        }).collect::<Result<Vec<_>, _>>()?;
        custom_store(reader, |custom, store| custom.choose(store, &token, roots, &reader.custom_protected))
    }).await
}

#[tauri::command]
async fn usage_custom_sample(window: WebviewWindow, token: String) -> Result<Value, String> {
    blocking(main_window_app(&window)?, move |reader| {
        custom_store(reader, |custom, store| custom.sample(store, &token, &reader.custom_protected))
    }).await
}

#[tauri::command]
async fn usage_custom_preview(window: WebviewWindow, token: String, config: Value) -> Result<custom_sources::CustomPreview, String> {
    blocking(main_window_app(&window)?, move |reader| {
        custom_store(reader, |custom, store| custom.preview(store, &token, &config, &reader.custom_protected))
    }).await
}

#[tauri::command]
async fn usage_custom_apply(window: WebviewWindow, id: String) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let reply = blocking(app.clone(), move |reader| {
        custom_store(reader, |custom, store| {
            let mut result = custom.apply(store, &id, &reader.custom_protected)?;
            result["state"] = reader.usage_state(store)?;
            Ok(result)
        })
    }).await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    Ok(reply)
}

#[tauri::command]
async fn usage_custom_change(window: WebviewWindow, id: String, action: String, value: Option<bool>) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let reply = blocking(app.clone(), move |reader| {
        custom_store(reader, |custom, store| {
            let mut result = custom.change(store, &id, &action, value, &reader.custom_protected)?;
            result["state"] = reader.usage_state(store)?;
            Ok(result)
        })
    }).await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    Ok(reply)
}

fn import_custom_definition(file: &Path) -> Result<Value, String> {
    const LIMIT: u64 = 1024 * 1024;
    let invalid = || "CUSTOM_CONFIG_INVALID".to_owned();
    policy::local_path(file.to_str().ok_or_else(invalid)?)?;
    let name = file.file_name().and_then(|name| name.to_str()).ok_or_else(invalid)?.to_ascii_lowercase();
    let leading = name.split(['.', '_', '-']).next().unwrap_or_default();
    if matches!(leading, "auth" | "credentials" | "config" | "settings" | "storage" | "token" | "tokens") {
        return Err(invalid());
    }
    let metadata = fs::symlink_metadata(file).map_err(|_| invalid())?;
    if !metadata.file_type().is_file() || metadata.len() > LIMIT {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    File::open(file).map_err(|_| invalid())?.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|_| invalid())?;
    if bytes.len() > LIMIT as usize {
        return Err(invalid());
    }
    serde_json::from_slice(&bytes).map_err(|_| invalid())
}

#[tauri::command]
async fn usage_custom_import(window: WebviewWindow) -> Result<Value, String> {
    blocking(main_window_app(&window)?, move |reader| {
        let picked = window.dialog().file().set_parent(&window)
            .set_title("导入 JSONL 解析配置").add_filter("解析配置", &["json"]).blocking_pick_file();
        let Some(picked) = picked else { return Ok(json!({"canceled":true})); };
        let file = picked.into_path().map_err(|_| "CUSTOM_CONFIG_INVALID")?;
        let config = import_custom_definition(&file)?;
        custom_store(reader, |custom, store| custom.draft(store, None, Some(&config)))
    }).await
}

#[tauri::command]
async fn usage_custom_export(window: WebviewWindow, id: String) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let config = blocking(app, move |reader| reader.with_store(|store| custom_sources::export(store, &id))).await?;
    let text = serde_json::to_string_pretty(&config).map_err(|_| "CUSTOM_CONFIG_INVALID")?;
    desktop_io::save(window, "导出解析配置", "AgentUsage-parser.json".to_owned(), "JSON", "json", text, None).await
}

#[tauri::command]
async fn usage_data_info(window: WebviewWindow) -> Result<Value, String> {
    if window.label() != MAIN {
        return Err("IPC_SENDER_REJECTED".to_owned());
    }
    let app = window.app_handle().clone();
    let version = app.package_info().version.to_string();
    blocking(app, move |reader| {
        Ok(json!({
            "version": version,
            "path": reader.directory_name()?,
            "bytes": desktop_io::data_directory_bytes(&reader.usage_dir),
        }))
    })
    .await
}

#[tauri::command]
async fn usage_open_data(window: WebviewWindow) -> Result<(), String> {
    if window.label() != MAIN {
        return Err("IPC_SENDER_REJECTED".to_owned());
    }
    blocking(window.app_handle().clone(), |reader| {
        fs::create_dir_all(&reader.usage_dir).map_err(|_| "DIRECTORY_OPEN_FAILED".to_owned())?;
        tauri_plugin_opener::open_path(&reader.usage_dir, None::<&str>)
            .map_err(|_| "DIRECTORY_OPEN_FAILED".to_owned())
    })
    .await
}

#[tauri::command]
async fn usage_workbench(app: AppHandle, selection: Option<Value>) -> Result<Value, String> {
    blocking(app, move |reader| {
        reader.with_store(|store| store.workbench(&selection.unwrap_or_else(|| json!({}))))
    })
    .await
}

#[tauri::command]
async fn usage_attention(app: AppHandle) -> Result<Value, String> {
    blocking(app, |reader| reader.with_store(|store| {
        let mut view = store.workbench(&json!({"period": "total", "project": "all"}))?;
        Ok(json!({"sources": [], "issues": view["issues"].take(),
            "omittedIssues": view["omittedIssues"].take(), "budgetOverview": view["budgetOverview"].take()}))
    })).await
}

#[tauri::command]
async fn usage_pricing(app: AppHandle, view: Option<String>) -> Result<Value, String> {
    blocking(app, move |reader| {
        reader.with_store(|store| {
            let mut result = store.pricing(view.as_deref())?;
            if view.as_deref() != Some("coverage") {
                result["sync"] = reader.price_sync.status(store)?;
            }
            Ok(result)
        })
    })
    .await
}

fn main_window_app(window: &WebviewWindow) -> Result<AppHandle, String> {
    if window.label() != MAIN {
        return Err("IPC_SENDER_REJECTED".to_owned());
    }
    Ok(window.app_handle().clone())
}

async fn mutate_usage(
    window: WebviewWindow,
    update: impl FnOnce(&mut Store) -> Result<Value, String> + Send + 'static,
) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let result = blocking(app.clone(), move |reader| reader.with_store(update)).await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    Ok(result)
}

#[tauri::command]
async fn usage_subscription(window: WebviewWindow, agent: String, fee: Option<Value>) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let state = blocking(app.clone(), move |reader| {
        reader.with_store(|store| {
            store.set_subscription(&agent, fee.as_ref().unwrap_or(&Value::Null))?;
            reader.usage_state(store)
        })
    }).await?;
    let _ = app.emit_to(MAIN, "usage:update", ());
    Ok(state)
}

#[tauri::command]
async fn usage_price_save(window: WebviewWindow, entry: Value) -> Result<Value, String> {
    mutate_usage(window, move |store| store.set_price(&entry, false)).await
}

#[tauri::command]
async fn usage_price_reset(window: WebviewWindow, entry: Value) -> Result<Value, String> {
    mutate_usage(window, move |store| store.set_price(&entry, true)).await
}

#[tauri::command]
async fn usage_billing_save(window: WebviewWindow, value: Value) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let result = mutate_usage(window, move |store| store.set_billing(&value)).await?;
    app.state::<Reader>().price_sync.reschedule();
    Ok(result)
}

#[tauri::command]
async fn usage_price_probe(window: WebviewWindow, entry: Value) -> Result<Value, String> {
    blocking(main_window_app(&window)?, move |reader| {
        reader.with_store(|store| store.probe(&entry))
    })
    .await
}

#[tauri::command]
async fn usage_price_try(window: WebviewWindow, request: Value) -> Result<Value, String> {
    blocking(main_window_app(&window)?, move |reader| {
        reader.with_store(|store| store.price_try(&request))
    })
    .await
}

#[tauri::command]
async fn usage_price_plan(window: WebviewWindow, request: Value) -> Result<Value, String> {
    blocking(main_window_app(&window)?, move |reader| {
        reader.with_store(|store| store.price_plan(&request))
    })
    .await
}

#[tauri::command]
async fn usage_reprice(window: WebviewWindow) -> Result<Value, String> {
    mutate_usage(window, move |store| store.reprice()).await
}

#[tauri::command]
async fn usage_workbench_save(window: WebviewWindow, value: Value) -> Result<Value, String> {
    mutate_usage(window, move |store| store.save_workbench(&value)).await
}

#[tauri::command]
fn usage_session_labels(state: State<'_, Reader>) -> Result<Value, String> {
    let labels = state.labels.lock().map_err(|_| "READER_STORAGE_FAILED")?;
    Ok(json!(labels.all()))
}

#[tauri::command]
async fn usage_session_label(app: AppHandle, key: String, patch: Value) -> Result<Value, String> {
    blocking(app, move |reader| {
        reader.with_store(|store| {
            if store.state["sessions"].get(&key).is_none() {
                return Err("SESSION_NOT_FOUND".to_owned());
            }
            let mut labels = reader.labels.lock().map_err(|_| "READER_STORAGE_FAILED")?;
            Ok(json!(labels
                .set(&key, &patch)
                .map_err(|error| error.to_string())?))
        })
    })
    .await
}

async fn read(app: AppHandle, key: String, request: TranscriptRequest) -> Result<Value, String> {
    let target = blocking(app.clone(), move |reader| {
        reader.with_store(|store| {
            store
                .transcript_target(&key)
                .map_err(|error| error.to_string())
        })
    })
    .await?;
    target
        .read(&app.state::<Reader>().tasks, request)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn usage_transcript(
    app: AppHandle,
    key: String,
    proof: Option<Value>,
) -> Result<Value, String> {
    app.state::<Reader>().count_probe_read(3);
    read(app, key, TranscriptRequest::Preview { proof }).await
}

#[tauri::command]
async fn usage_transcript_part(
    app: AppHandle,
    key: String,
    request: PartRequest,
) -> Result<Value, String> {
    app.state::<Reader>().count_probe_read(4);
    read(app, key, TranscriptRequest::Part(request)).await
}

#[tauri::command]
async fn usage_transcript_find(
    app: AppHandle,
    key: String,
    request: FindRequest,
) -> Result<Value, String> {
    read(app, key, TranscriptRequest::Find(request)).await
}

#[tauri::command]
async fn usage_transcript_stamp(app: AppHandle, key: String) -> Result<Value, String> {
    read(app, key, TranscriptRequest::Stamp).await
}

#[tauri::command]
async fn usage_transcript_facts(app: AppHandle, key: String) -> Result<Value, String> {
    app.state::<Reader>().count_probe_read(5);
    read(app, key, TranscriptRequest::Facts).await
}

#[tauri::command]
async fn usage_search_transcripts(app: AppHandle, request: SearchRequest) -> Result<Value, String> {
    let scan = blocking(app.clone(), |reader| {
        reader.with_store(|store| {
            store
                .transcript_search(request)
                .map_err(|error| error.to_string())
        })
    })
    .await?;
    scan.read(&app.state::<Reader>().tasks)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn usage_transcript_file_history(
    app: AppHandle,
    request: FileHistoryRequest,
) -> Result<Value, String> {
    let scan = blocking(app.clone(), |reader| {
        reader.with_store(|store| {
            store
                .transcript_file_history(request)
                .map_err(|error| error.to_string())
        })
    })
    .await?;
    scan.read(&app.state::<Reader>().tasks)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn usage_agent_use(window: WebviewWindow, request: Value) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let offset = match request.get("offset") {
        Some(value) => value.as_u64().and_then(|offset| usize::try_from(offset).ok()).ok_or("TRANSCRIPT_SEARCH_INVALID")?,
        None => 0,
    };
    let scan = blocking(app.clone(), move |reader| {
        reader.with_store(|store| Ok(store.transcript_agent_use(offset)))
    }).await?;
    scan.read(&app.state::<Reader>().tasks).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn probe_close(window: WebviewWindow) -> Result<(), String> {
    if !window.state::<Reader>().probe {
        return Err("READER_PROBE_DISABLED".to_owned());
    }
    window
        .close()
        .map_err(|_| "READER_WINDOW_FAILED".to_owned())
}

fn reader_roots(args: impl IntoIterator<Item = String>, fixture: bool) -> Result<Value, String> {
    let mut args = args.into_iter();
    if fixture {
        if args.next().is_some() {
            return Err("READER_ARGUMENT_INVALID".to_owned());
        }
        let home = env::temp_dir().join("home");
        let home = home.to_str().ok_or("READER_HOME_UNAVAILABLE")?;
        return Ok(policy::roots(home, &Default::default()));
    }
    let Some(flag) = args.next() else {
        return Ok(json!({}));
    };
    if flag != "--real-sources" {
        return Err("READER_ARGUMENT_INVALID".to_owned());
    }
    let selection = args.next().ok_or("READER_ARGUMENT_INVALID")?;
    if args.next().is_some() {
        return Err("READER_ARGUMENT_INVALID".to_owned());
    }
    let home = env::var("USERPROFILE").map_err(|_| "READER_HOME_UNAVAILABLE")?;
    let all = policy::roots(&home, &env::vars().collect());
    let mut roots = json!({});
    for name in selection.split(',') {
        if !matches!(name, "codex" | "claude") {
            return Err("READER_ARGUMENT_INVALID".to_owned());
        }
        roots[name] = all[name].clone();
    }
    Ok(roots)
}

fn browser_arguments(probe: bool) -> String {
    let mut arguments =
        "--js-flags=--max-old-space-size=128 --disable-features=msWebOOUI,msPdfOOUI".to_owned();
    if probe {
        arguments.push_str(" --remote-debugging-port=0 --remote-debugging-address=127.0.0.1");
    }
    arguments
}

fn open_main(app: &AppHandle) -> tauri::Result<()> {
    let reader = app.state::<Reader>();
    let Ok(_opening) = reader.opening.try_lock() else {
        return Ok(());
    };
    if let Some(window) = app.get_webview_window(MAIN) {
        if window.is_minimized()? {
            window.unminimize()?;
        }
        return window.set_focus();
    }
    reader.active.store(true, Ordering::Release);
    WebviewWindowBuilder::new(
        app,
        MAIN,
        WebviewUrl::App("design/desktop-reference/index.html".into()),
    )
    .title("QuotaDock · 额度台")
    .inner_size(1480.0, 960.0)
    .min_inner_size(800.0, 600.0)
    .decorations(false)
    .additional_browser_args(&browser_arguments(reader.probe))
    .data_directory(reader.profile_dir.join("WebView2"))
    .on_navigation(|url| {
        url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.path() == "/design/desktop-reference/index.html"
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .on_menu_event(window_shell::menu_event)
    .build()?;
    Ok(())
}

fn schedule_open(app: &AppHandle) {
    schedule_open_command(app, None);
}

pub(crate) fn schedule_open_command(app: &AppHandle, command: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(command) = command {
            let reader = app.state::<Reader>();
            if let Ok(mut pending) = reader.pending_command.lock() {
                *pending = Some(command);
            };
        }
        if open_main(&app).is_err() {
            eprintln!("READER_WINDOW_FAILED");
        } else {
            let _ = app.emit_to(MAIN, "window:openCommandPending", ());
        }
    });
}

#[tauri::command]
fn desktop_take_open_command(window: WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != MAIN {
        return Err("IPC_SENDER_REJECTED".to_owned());
    }
    window
        .state::<Reader>()
        .pending_command
        .lock()
        .map(|mut command| command.take())
        .map_err(|_| "READER_WINDOW_FAILED".to_owned())
}

fn release_store(app: &AppHandle) {
    let reader = app.state::<Reader>();
    reader.active.store(false, Ordering::Release);
    reader.collection_wake.notify_one();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let reader = app.state::<Reader>();
        let Ok(mut owner) = reader.store.lock() else {
            return;
        };
        if !reader.active.load(Ordering::Acquire) {
            owner.take();
            if let Ok(mut statistics) = reader.statistics.lock() {
                statistics.requests.worker_present = false;
            }
            if let Ok(mut slot) = reader.codex_maintenance.lock() { slot.take(); }
            drop(owner);
            #[cfg(windows)]
            reader.config.release_window();
            if let Ok(mut custom) = reader.custom.lock() {
                *custom = CustomSources::default();
            }
        }
    });
}

pub(crate) fn allow_exit_retry(app: &AppHandle) {
    let reader = app.state::<Reader>();
    reader.shutdown_pending.store(false, Ordering::Release);
    reader.collection_wake.notify_one();
}

pub(crate) fn prepare_shutdown(app: &AppHandle, _close_update: bool) -> Result<(), &'static str> {
    let reader = app.state::<Reader>();
    if reader.shutdown_pending.swap(true, Ordering::AcqRel) {
        return Err("READER_EXIT_BUSY");
    }
    reader.collection_wake.notify_one();
    let result = (|| {
        drop(reader.store.lock().map_err(|_| "READER_STORAGE_FAILED")?);
        #[cfg(windows)]
        if _close_update {
            tauri::async_runtime::block_on(app.state::<crate::update_host::UpdateHost>().close());
        }
        #[cfg(windows)]
        crate::tray_card::close(app);
        #[cfg(windows)]
        if tauri::async_runtime::block_on(reader.installers.close()).is_err() {
            return Err("INSTALL_CLEANUP_UNCONFIRMED");
        }
        tauri::async_runtime::block_on(price_sync::close(app));
        #[cfg(windows)]
        tauri::async_runtime::block_on(app.state::<crate::github_host::GithubHost>().close());
        #[cfg(windows)]
        if tauri::async_runtime::block_on(app.state::<crate::quota_host::QuotaHost>().close())
            .is_err()
        {
            return Err("PROVIDER_SHUTDOWN_FAILED");
        }
        #[cfg(windows)]
        app.state::<crate::desktop_shell::DesktopShell>().close();
        Ok(())
    })();
    if result.is_err() {
        allow_exit_retry(app);
    }
    result
}

fn schedule_quit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = prepare_shutdown(&app, true) {
            if error != "READER_EXIT_BUSY" {
                eprintln!("{error}");
            }
            return;
        }
        if let Some(window) = app.get_webview_window(MAIN) {
            if window.destroy().is_err() {
                eprintln!("READER_WINDOW_FAILED");
            }
            for _ in 0..50 {
                if app.get_webview_window(MAIN).is_none() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        app.exit(0);
    });
}

#[cfg(windows)]
fn probe_allocator() -> Option<Value> {
    use std::ffi::c_char;
    unsafe extern "C" {
        fn mi_stats_get_json(size: usize, buffer: *mut c_char) -> *mut c_char;
    }
    let mut buffer = [0u8; 32 * 1024];
    // SAFETY: The linked mimalloc fills the provided writable buffer up to
    // the supplied length. We check its returned buffer and the terminator.
    let ptr = unsafe { mi_stats_get_json(buffer.len(), buffer.as_mut_ptr().cast()) };
    if ptr != buffer.as_mut_ptr().cast() {
        return None;
    }
    let end = buffer.iter().position(|byte| *byte == 0)?;
    let row: Value = serde_json::from_slice(&buffer[..end]).ok()?;
    Some(json!({
        "version":row["mimalloc_version"],
        "reserved":row["reserved"],
        "committed":row["committed"],
        "mallocNormal":row["malloc_normal"],
        "mallocHuge":row["malloc_huge"],
        "mallocRequested":row["malloc_requested"],
        "threads":row["threads"]
    }))
}

fn probe_input(app: AppHandle) -> io::Result<()> {
    std::thread::Builder::new()
        .name("reader-probe".into())
        .spawn(move || {
            for command in io::stdin().lock().lines() {
                match command.as_deref() {
                    Ok("open") => schedule_open(&app),
                    Ok("memory") if app.state::<Reader>().cold_tray_probe => {
                        let reader = app.state::<Reader>();
                        #[cfg(windows)]
                        let allocator = probe_allocator();
                        #[cfg(not(windows))]
                        let allocator: Option<Value> = None;
                        println!("{}", json!({
                            "mainWindow":app.get_webview_window(MAIN).is_some(),
                            "webviewProfileCreated":reader.profile_dir.join("WebView2").exists(),
                            "storeLive":reader.store.try_lock().ok().map(|slot| slot.is_some()),
                            "calls":reader.probe_reads.each_ref().map(|value| value.load(Ordering::Relaxed)),
                            "allocator":allocator
                        }));
                    }
                    #[cfg(windows)]
                    Ok("website-fixture") if app.state::<Reader>().cold_tray_probe => {
                        let app = app.clone();
                        let root = app.state::<Reader>().profile_dir.clone();
                        tauri::async_runtime::spawn(async move {
                            let result = crate::website_login::fixture(app, root).await;
                            println!("{}", match result {
                                Ok(result) => json!({"loginFixture":result}),
                                Err(error) => json!({"loginFixtureError":error.to_string()}),
                            });
                        });
                    }
                    #[cfg(windows)]
                    Ok("tray") => {
                        if let Ok(Some(monitor)) = app.primary_monitor() {
                            let area = monitor.work_area();
                            let anchor = tauri::Rect {
                                position: tauri::PhysicalPosition::new(
                                    area.position.x + area.size.width as i32 - 70,
                                    area.position.y + area.size.height as i32,
                                )
                                .into(),
                                size: tauri::PhysicalSize::new(24, 24).into(),
                            };
                            let reader = app.state::<Reader>();
                            crate::tray_card::toggle(
                                &app,
                                anchor,
                                &reader.profile_dir.join("WebView2"),
                                &browser_arguments(reader.probe),
                            );
                        }
                    }
                    Ok("quit") => break,
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
            schedule_quit(&app);
        })?;
    Ok(())
}

fn setup(app: &mut tauri::App, _quota_dir: &Path) -> Result<(), Box<dyn Error>> {
    #[cfg(windows)]
    {
        let reader = app.state::<Reader>();
        let host = crate::quota_host::QuotaHost::open(_quota_dir, reader.probe)?;
        let shell = crate::desktop_shell::DesktopShell::open(
            _quota_dir, host.accounts.has_accounts()?, app.config().bundle.active && !reader.probe,
        );
        app.manage(host);
        app.manage(shell);
        let github_dir = _quota_dir.parent().ok_or("READER_STORAGE_FAILED")?.join("github");
        app.manage(crate::github_host::GithubHost::open(&github_dir, reader.probe));
        app.manage(crate::update_host::UpdateHost::open(app.handle()));
        crate::update_host::start(app.handle());
        crate::desktop_shell::start(app.handle())?;
        app.manage(crate::tray_card::TrayCard::default());
        crate::quota_host::start_timer(app.handle());
        crate::quota_host::start_passive(app.handle());
    }
    let open = MenuItem::with_id(app, "reader-open", "打开 QuotaDock", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "reader-quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let icon = app.default_window_icon().ok_or("READER_ICON_UNAVAILABLE")?;
    #[cfg(windows)]
    let tray = TrayIconBuilder::with_id(crate::desktop_shell::TRAY);
    #[cfg(not(windows))]
    let tray = TrayIconBuilder::new();
    tray.icon(icon.clone())
        .tooltip("QuotaDock · Rust Reader")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "reader-open" => {
                #[cfg(windows)]
                crate::tray_card::close(app);
                schedule_open(app);
            }
            "reader-quit" => schedule_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } => {
                #[cfg(windows)]
                {
                    let app = tray.app_handle().clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let reader = app.state::<Reader>();
                        crate::tray_card::toggle(
                            &app,
                            rect,
                            &reader.profile_dir.join("WebView2"),
                            &browser_arguments(reader.probe),
                        );
                    });
                }
                #[cfg(not(windows))]
                {
                    let _ = rect;
                    schedule_open(tray.app_handle());
                }
            }
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => {
                #[cfg(windows)]
                crate::tray_card::close(tray.app_handle());
                schedule_open(tray.app_handle());
            }
            _ => {}
        })
        .build(app)?;
    price_sync::start(app.handle());
    start_collection_timer(app.handle());
    if !app.state::<Reader>().start_in_tray {
        open_main(app.handle())?;
    }
    if app.state::<Reader>().probe {
        probe_input(app.handle().clone())?;
    }
    Ok(())
}

fn lock_ledger_directory(directory: &Path) -> Result<File, Box<dyn Error>> {
    fs::create_dir_all(directory)?;
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(".ledger.lock"))?;
    lock.try_lock()?;
    Ok(lock)
}

fn local_ipc(
    dispatch: impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool,
) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool {
    move |invoke| {
        if !matches!(invoke.message.webview_ref().label(), "main" | "tray-card") {
            // Third-party login views are never allowed to dispatch app commands.
            invoke.resolver.reject("IPC_SENDER_REJECTED");
            return true;
        }
        dispatch(invoke)
    }
}

pub fn run() -> Result<(), String> {
    let mut args = env::args().skip(1).peekable();
    let probe = args.next_if(|flag| flag == "--probe").is_some();
    let fixture = probe && args.next_if(|flag| flag == "--fixture").is_some();
    let cold_tray_probe = fixture && args.next_if(|flag| flag == "--cold-tray").is_some();
    let ledger_restart = fixture && args.next_if(|flag| flag == "--ledger-restart").is_some();
    #[cfg(windows)]
    let start_in_tray = cold_tray_probe || !probe && args.next_if(|flag| {
        flag == quota_engine::windows_startup::START_IN_TRAY
    }).is_some();
    #[cfg(not(windows))]
    let start_in_tray = cold_tray_probe;
    let roots = reader_roots(args, fixture)?;
    let directory = crate::webview_profile::Profile::new(crate::webview_profile::MAIN_PREFIX)
        .map_err(|_| "READER_STORAGE_FAILED")?;
    let profile_dir = directory.path().to_owned();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_notification::init());
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder.setup(move |app| {
            let _ = tauri::async_runtime::spawn_blocking(crate::webview_profile::sweep);
            let roots = if app.config().bundle.active && !probe
                && roots.as_object().is_some_and(serde_json::Map::is_empty)
            {
                env::var("USERPROFILE")
                    .ok()
                    .map(|home| policy::roots(&home, &env::vars().collect()))
                    .unwrap_or(roots)
            } else {
                roots
            };
            let (usage_dir, ledger_lock) = if probe && !ledger_restart {
                (profile_dir.clone(), None)
            } else {
                let app_data = if ledger_restart {
                    env::temp_dir()
                        .join("fixture-app-data")
                        .join(&app.config().identifier)
                } else {
                    app.path().app_data_dir()?
                };
                let usage_dir = app_data.join("usage");
                let lock = lock_ledger_directory(&usage_dir)?;
                (usage_dir, Some(lock))
            };
            let quota_dir = if ledger_restart {
                usage_dir.parent().ok_or("READER_STORAGE_FAILED")?.join("quota")
            } else if probe {
                profile_dir.join("quota")
            } else {
                app.path().app_data_dir()?.join("quota")
            };
            let custom_protected = [&usage_dir, &profile_dir, &quota_dir].into_iter()
                .map(|path| path.to_str().map(str::to_owned).ok_or("READER_STORAGE_FAILED"))
                .collect::<Result<Vec<_>, _>>()?;
            let reader = Reader {
                store: Mutex::new(None),
                statistics: Mutex::default(),
                collection_wake: tokio::sync::Notify::new(),
                opening: Mutex::new(()),
                pending_command: Mutex::new(None),
                active: AtomicBool::new(!start_in_tray),
                shutdown_pending: AtomicBool::new(false),
                labels: Mutex::new(SessionLabels::open(&usage_dir)),
                custom: Mutex::new(CustomSources::default()),
                codex_maintenance: Mutex::new(None),
                #[cfg(windows)]
                config: config_host::ConfigHost::default(),
                #[cfg(windows)]
                inventory: agent_inventory_host::InventoryHost::default(),
                #[cfg(windows)]
                installers: agent_install_host::InstallHost::open(usage_dir.join("agent-tools")),
                #[cfg(windows)]
                agent_setup: agent_setup_host::SetupHost::default(),
                custom_protected,
                price_sync: price_sync::PriceSync::default(),
                tasks: TranscriptTasks::new(Duration::from_secs(30)),
                collection_failure: Mutex::new(None),
                usage_dir,
                profile_dir,
                _ledger_lock: ledger_lock,
                source_home: if fixture {
                    Some(env::temp_dir().join("home"))
                } else {
                    env::var_os("USERPROFILE").map(PathBuf::from)
                },
                probe,
                cold_tray_probe,
                start_in_tray,
                probe_reads: Default::default(),
                roots,
            };
            if !start_in_tray && reader.roots.as_object().is_some_and(|roots| !roots.is_empty()) {
                reader.collect_with_preferences(true).map_err(|_| "READER_COLLECTION_FAILED")?;
            }
            app.manage(reader);
            setup(app, &quota_dir)
        })
        .invoke_handler(local_ipc(tauri::generate_handler![
            #[cfg(windows)]
            crate::quota_host::quota_get,
            #[cfg(windows)]
            crate::desktop_shell::shell_get,
            #[cfg(windows)]
            crate::desktop_shell::shell_set,
            #[cfg(windows)]
            crate::desktop_shell::shell_read_history,
            #[cfg(windows)]
            crate::github_host::github_get,
            #[cfg(windows)]
            crate::github_host::github_connect,
            #[cfg(windows)]
            crate::github_host::github_cancel,
            #[cfg(windows)]
            crate::github_host::github_disconnect,
            #[cfg(windows)]
            crate::github_host::github_repositories,
            #[cfg(windows)]
            crate::github_host::github_set_sync,
            #[cfg(windows)]
            crate::github_host::github_sync_now,
            #[cfg(windows)]
            crate::github_host::github_copy_code,
            #[cfg(windows)]
            crate::github_host::github_open,
            #[cfg(windows)]
            crate::update_host::update_get,
            #[cfg(windows)]
            crate::update_host::update_check,
            #[cfg(windows)]
            crate::update_host::update_cancel,
            #[cfg(windows)]
            crate::update_host::update_install,
            #[cfg(windows)]
            crate::update_host::update_open,
            #[cfg(windows)]
            crate::codex_host::quota_choose_executable,
            #[cfg(windows)]
            crate::codex_host::quota_login,
            #[cfg(windows)]
            crate::codex_host::quota_cancel,
            #[cfg(windows)]
            crate::codex_host::quota_refresh,
            #[cfg(windows)]
            crate::codex_host::quota_remove,
            #[cfg(windows)]
            crate::quota_host::quota_providers,
            #[cfg(windows)]
            crate::quota_host::quota_provider_connect,
            #[cfg(windows)]
            crate::quota_host::quota_provider_website_login,
            #[cfg(windows)]
            crate::quota_host::quota_provider_client_login,
            #[cfg(windows)]
            crate::quota_host::quota_provider_website_cancel,
            #[cfg(windows)]
            crate::quota_host::quota_provider_guide,
            #[cfg(windows)]
            crate::quota_host::quota_provider_passive_guide,
            #[cfg(windows)]
            crate::quota_host::quota_provider_action,
            #[cfg(windows)]
            crate::quota_host::quota_provider_experimental,
            #[cfg(windows)]
            crate::quota_host::quota_refresh_all,
            #[cfg(windows)]
            crate::quota_host::quota_set_auto_refresh,
            #[cfg(windows)]
            crate::tray_card::tray_rows,
            #[cfg(windows)]
            crate::tray_card::tray_size,
            #[cfg(windows)]
            crate::tray_card::tray_open,
            #[cfg(windows)]
            crate::tray_card::tray_dismiss,
            desktop_take_open_command,
            usage_get,
            usage_refresh,
            usage_performance_state,
            usage_statistics_diagnostics,
            usage_set_refresh_interval,
            usage_sessions,
            usage_session_summary,
            usage_sources,
            #[cfg(windows)]
            config_host::usage_config_state,
            #[cfg(windows)]
            config_host::usage_config_choose,
            #[cfg(windows)]
            config_host::usage_config_check,
            #[cfg(windows)]
            config_host::usage_config_forget,
            #[cfg(windows)]
            config_host::usage_config_cancel,
            #[cfg(windows)]
            config_host::usage_config_manage,
            #[cfg(windows)]
            agent_inventory_host::usage_agents,
            #[cfg(windows)]
            agent_install_host::usage_installers,
            #[cfg(windows)]
            agent_install_host::usage_installer_action,
            #[cfg(windows)]
            agent_setup_host::usage_agent_setup,
            #[cfg(windows)]
            agent_setup_host::usage_agent_setup_action,
            #[cfg(windows)]
            agent_setup_host::quota_discover_antigravity,
            #[cfg(windows)]
            agent_setup_host::quota_antigravity_setup,
            #[cfg(windows)]
            agent_setup_host::quota_antigravity_setup_action,
            usage_agent_use,
            codex_maintenance_host::usage_codex_preview,
            codex_maintenance_host::usage_codex_apply,
            usage_custom_draft,
            usage_custom_choose,
            usage_custom_sample,
            usage_custom_preview,
            usage_custom_apply,
            usage_custom_change,
            usage_custom_import,
            usage_custom_export,
            usage_connections,
            usage_connections_v2,
            usage_set_enabled,
            usage_choose_source,
            usage_change_source,
            usage_reveal_source,
            usage_data_info,
            usage_open_data,
            usage_workbench,
            usage_attention,
            usage_pricing,
            usage_price_save,
            usage_subscription,
            usage_price_reset,
            usage_billing_save,
            price_sync::usage_price_sync,
            price_sync::usage_price_auto,
            usage_price_probe,
            usage_price_try,
            usage_price_plan,
            usage_reprice,
            usage_workbench_save,
            usage_export_statistics,
            usage_export_cost,
            usage_export_projects,
            usage_transcript_copy,
            usage_transcript_export,
            usage_copy_text,
            usage_copy_resume,
            usage_open_link,
            usage_open_folder,
            usage_session_labels,
            usage_session_label,
            usage_transcript,
            usage_transcript_part,
            usage_transcript_find,
            usage_transcript_stamp,
            usage_transcript_facts,
            usage_search_transcripts,
            usage_transcript_file_history,
            probe_close,
            window_shell::desktop_state,
            window_shell::desktop_caption,
            window_shell::desktop_theme,
            window_shell::desktop_menu,
        ]))
        .on_window_event(|window, event| {
            if window.label() == MAIN {
                if matches!(event, WindowEvent::Focused(_) | WindowEvent::Resized(_)) {
                    window_shell::publish_state(window);
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    #[cfg(windows)]
                    if !window.state::<crate::desktop_shell::DesktopShell>().close_to_tray() {
                        schedule_quit(window.app_handle());
                        return;
                    }
                    if window.destroy().is_err() {
                        eprintln!("READER_WINDOW_FAILED");
                    } else {
                        release_store(window.app_handle());
                    }
                }
            }
        })
        .build(tauri::generate_context!())
        .map_err(|_| "READER_START_FAILED")?;
    let exit = app.run_return(|_app, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            api.prevent_exit();
        }
    });
    if exit != 0 {
        return Err("READER_EXIT_FAILED".to_owned());
    }
    directory.close().map_err(|_| "READER_STORAGE_CLEANUP_FAILED".to_owned())
}

#[cfg(test)]
mod tests {
    use super::lock_ledger_directory;

    #[test]
    fn ledger_writer_lease_releases_on_exit() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let ledger = root.path().join("usage");
        let lease = lock_ledger_directory(&ledger)?;
        assert!(lock_ledger_directory(&ledger).is_err());
        drop(lease);

        let reopened = lock_ledger_directory(&ledger)?;
        drop(reopened);
        Ok(())
    }
}
