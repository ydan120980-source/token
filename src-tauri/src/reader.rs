use crate::{desktop_io, window_shell};
use serde_json::{json, Value};
use std::{
    env,
    error::Error,
    io::{self, BufRead},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
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
use usage_engine::{
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

struct Reader {
    store: Mutex<Option<Store>>,
    opening: Mutex<()>,
    pending_command: Mutex<Option<String>>,
    active: AtomicBool,
    labels: Mutex<SessionLabels>,
    roots: Value,
    directory: PathBuf,
    source_home: Option<PathBuf>,
    collection_failure: Mutex<Option<CollectionFailure>>,
    probe: bool,
    tasks: TranscriptTasks,
}

impl Reader {
    fn directory_name(&self) -> Result<&str, String> {
        self.directory
            .to_str()
            .ok_or_else(|| "READER_STORAGE_FAILED".to_owned())
    }

    fn with_store<T>(
        &self,
        read: impl FnOnce(&mut Store) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut owner = self.store.lock().map_err(|_| "READER_STORAGE_FAILED")?;
        if !self.active.load(Ordering::Acquire) {
            return Err("READER_WINDOW_CLOSED".to_owned());
        }
        if owner.is_none() {
            *owner = Some(Store::new(self.directory_name()?, &self.roots)?);
        }
        read(owner.as_mut().ok_or("READER_STORAGE_FAILED")?)
    }

    fn collect(&self) -> Result<Value, String> {
        self.collect_with_preferences(false)
    }

    fn collect_with_preferences(&self, require_enabled: bool) -> Result<Value, String> {
        self.with_store(|store| {
            if require_enabled && store.settings["enabled"] == false {
                return self.usage_state(store);
            }
            let salt = store.state["salt"]
                .as_str()
                .ok_or("READER_STORAGE_FAILED")?;
            let scan = scan_sources(
                &store.source_roots(),
                salt,
                &mut policy::Audit::new(),
                ScanOptions {
                    cache: None,
                    prepared: None,
                },
            );
            let failure = store
                .ingest_collection(Some(&scan), &Value::Null, None)
                .err()
                .map(|error| {
                    collection_diagnostic::failure(
                        &json!({"message": error}),
                        "ingest",
                        "COLLECTION_FAILED",
                    )
                });
            *self
                .collection_failure
                .lock()
                .map_err(|_| "READER_STORAGE_FAILED")? = failure;
            self.usage_state(store)
        })
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
            "refreshIntervalMs": 0,
            "subscriptions": {},
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

#[tauri::command]
async fn usage_get(app: AppHandle) -> Result<Value, String> {
    blocking(app, |reader| {
        reader.with_store(|store| reader.usage_state(store))
    })
    .await
}

#[tauri::command]
async fn usage_refresh(app: AppHandle) -> Result<Value, String> {
    let state = blocking(app.clone(), Reader::collect).await?;
    app.emit_to(MAIN, "usage:update", ())
        .map_err(|_| "READER_EVENT_FAILED")?;
    Ok(state)
}

#[tauri::command]
async fn usage_sessions(app: AppHandle, selection: Option<Value>) -> Result<SessionList, String> {
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
            Ok(store.discover_selected_sources(
                reader.source_home.as_deref().and_then(|path| path.to_str()),
            ))
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
async fn usage_reveal_source(app: AppHandle, file: String) -> Result<Value, String> {
    blocking(app, move |reader| {
        let known = reader.with_store(|store| {
            Ok(store.source_selection().iter().any(|entry| {
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
        reader.with_store(|store| store.pricing(view.as_deref()))
    })
    .await
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
    read(app, key, TranscriptRequest::Preview { proof }).await
}

#[tauri::command]
async fn usage_transcript_part(
    app: AppHandle,
    key: String,
    request: PartRequest,
) -> Result<Value, String> {
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
    .data_directory(reader.directory.join("WebView2"))
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
    app.state::<Reader>().active.store(false, Ordering::Release);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let reader = app.state::<Reader>();
        let Ok(mut owner) = reader.store.lock() else {
            return;
        };
        if !reader.active.load(Ordering::Acquire) {
            owner.take();
        }
    });
}

fn schedule_quit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        crate::tray_card::close(&app);
        #[cfg(windows)]
        if tauri::async_runtime::block_on(app.state::<crate::quota_host::QuotaHost>().close())
            .is_err()
        {
            eprintln!("PROVIDER_SHUTDOWN_FAILED");
            return;
        }
        if let Some(window) = app.get_webview_window(MAIN) {
            if window.close().is_err() {
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

fn probe_input(app: AppHandle) -> io::Result<()> {
    std::thread::Builder::new()
        .name("reader-probe".into())
        .spawn(move || {
            for command in io::stdin().lock().lines() {
                match command.as_deref() {
                    Ok("open") => schedule_open(&app),
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
                                &reader.directory.join("WebView2"),
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

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    #[cfg(windows)]
    {
        let reader = app.state::<Reader>();
        let root = if reader.probe {
            reader.directory.join("quota")
        } else {
            app.path().app_data_dir()?.join("quota")
        };
        let host = crate::quota_host::QuotaHost::open(&root, reader.probe)?;
        app.manage(host);
        app.manage(crate::tray_card::TrayCard::default());
        crate::quota_host::start_timer(app.handle());
    }
    let open = MenuItem::with_id(app, "reader-open", "打开 QuotaDock", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "reader-quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let icon = app.default_window_icon().ok_or("READER_ICON_UNAVAILABLE")?;
    TrayIconBuilder::new()
        .icon(icon.clone())
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
                            &reader.directory.join("WebView2"),
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
    open_main(app.handle())?;
    if app.state::<Reader>().probe {
        probe_input(app.handle().clone())?;
    }
    Ok(())
}

pub fn run() -> Result<(), String> {
    let mut args = env::args().skip(1).peekable();
    let probe = args.next_if(|flag| flag == "--probe").is_some();
    let fixture = probe && args.next_if(|flag| flag == "--fixture").is_some();
    let roots = reader_roots(args, fixture)?;
    let directory = tempfile::Builder::new()
        .prefix("quotadock-reader-")
        .tempdir()
        .map_err(|_| "READER_STORAGE_FAILED")?;
    let reader = Reader {
        store: Mutex::new(None),
        opening: Mutex::new(()),
        pending_command: Mutex::new(None),
        active: AtomicBool::new(true),
        labels: Mutex::new(SessionLabels::open(directory.path())),
        tasks: TranscriptTasks::new(Duration::from_secs(30)),
        collection_failure: Mutex::new(None),
        directory: directory.path().to_owned(),
        source_home: if fixture {
            Some(env::temp_dir().join("home"))
        } else {
            env::var_os("USERPROFILE").map(PathBuf::from)
        },
        probe,
        roots,
    };
    if reader
        .roots
        .as_object()
        .is_some_and(|roots| !roots.is_empty())
    {
        reader.collect().map_err(|_| "READER_COLLECTION_FAILED")?;
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(reader)
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            #[cfg(windows)]
            crate::quota_host::quota_get,
            #[cfg(windows)]
            crate::quota_host::quota_providers,
            #[cfg(windows)]
            crate::quota_host::quota_provider_connect,
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
            usage_sessions,
            usage_session_summary,
            usage_sources,
            usage_connections,
            usage_connections_v2,
            usage_set_enabled,
            usage_choose_source,
            usage_change_source,
            usage_reveal_source,
            usage_workbench,
            usage_attention,
            usage_pricing,
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
        ])
        .on_window_event(|window, event| {
            if window.label() == MAIN {
                if matches!(event, WindowEvent::Focused(_) | WindowEvent::Resized(_)) {
                    window_shell::publish_state(window);
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
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
    directory
        .close()
        .map_err(|_| "READER_STORAGE_CLEANUP_FAILED".to_owned())
}
