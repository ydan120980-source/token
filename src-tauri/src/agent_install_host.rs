use super::{main_window_app, Reader, MAIN};
use quota_engine::{
    agent_install_engine::{launch_command, Cancel, Engine, Outcome, Progress},
    agent_install_plans::{compare, plan, version, AGENTS},
    agent_runtime::{definition, Environment},
};
use serde_json::{json, Map, Value};
use std::{
    cmp::Ordering,
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::sync::Notify;
use usage_engine::{
    agent_catalog::builtin_agents,
    config_health::guard_existing_parent,
    store_io,
    time::{iso_from_ms, now_ms, parse_iso},
};

type Result<T> = std::result::Result<T, &'static str>;
const FAILED: &str = "INSTALL_FAILED";
const CANCELED: &str = "INSTALL_CANCELED";
const REAP: &str = "INSTALL_CLEANUP_UNCONFIRMED";

fn error_message(code: &str) -> Option<&'static str> {
    Some(match code {
        "INSTALL_DOWNLOAD_FAILED" => "下载失败，请检查网络后重试，或使用官方下载入口。",
        "INSTALL_TIMEOUT" => "操作超时；请重新检查状态后重试。",
        "INSTALL_CHECKSUM_FAILED" => "下载文件校验不符，未执行。请重试或使用官方下载。",
        "INSTALL_SIGNATURE_FAILED" => "安装包签名或发行者核验未通过，未启动安装包。",
        "INSTALL_PROCESS_FAILED" => {
            "安装程序未正常完成，旧的应用内版本保留；可重新安装或打开官方排查。"
        }
        "INSTALL_VERSION_UNVERIFIED" => "安装后的版本或运行状态未能核验，旧版本保持使用。",
        "INSTALL_METADATA_INVALID" => "官方安装信息格式不符合当前合同，未继续安装。",
        "INSTALL_PLATFORM_UNSUPPORTED" => "当前系统或架构不支持此安装路线。",
        "INSTALL_LAYOUT_UNSUPPORTED" => "安装后的目录结构未被当前适配器识别，旧版本保留。",
        "INSTALL_DEPENDENCY_FAILED" => "应用内 Node.js 准备失败，请重试或使用官方下载。",
        CANCELED => "操作已取消，已启用的旧版本保留。",
        REAP => "无法确认安装子进程已清理；请检查进程并重启本应用后继续。",
        "INSTALL_OUTPUT_LIMIT" => "安装输出超过限制，已停止本次安装。",
        "INSTALL_URL_REJECTED" => "下载地址不符合已核对的官方来源，未继续。",
        "INSTALL_WRITE_FAILED" => "安装文件写入失败，请检查本应用数据目录的权限与磁盘空间。",
        "INSTALL_FIXTURE_BLOCKED" => "合成测试环境禁止真实安装或网络检查。",
        "INSTALL_INTERRUPTED" => "上次操作被中断，请重新检查版本；未确认安装完成。",
        "INSTALL_ARCHIVE_REJECTED" => "安装包目录或格式未通过安全检查，未启动程序。",
        "INSTALL_DOWNLOAD_LIMIT" => "安装包超出本次大小限制，已停止下载。",
        "INSTALL_LOCAL_MAINTENANCE_REQUIRED" => {
            "检测到旧的本机维护记录，请使用本机维护工具检查；产品安装器不会替换该外部程序。"
        }
        FAILED => "安装未完成，请重新检查后重试或使用官方下载。",
        _ => return None,
    })
}

fn controlled(code: &str) -> &str {
    if error_message(code).is_some() {
        code
    } else {
        FAILED
    }
}

fn valid_version(value: &Value) -> Option<&str> {
    value.as_str().and_then(version)
}
fn newer(row: &Value) -> bool {
    row["localMaintenanceRequired"] != true
        && row["checkError"].is_null()
        && valid_version(&row["latest"])
            .zip(valid_version(&row["version"]))
            .is_some_and(|(latest, current)| compare(latest, current) == Some(Ordering::Greater))
}
fn valid_state(value: &Value) -> Option<&str> {
    value.as_str().filter(|state| {
        matches!(
            *state,
            "installed" | "missing" | "broken" | "unverified" | "incomplete" | "multiple"
        )
    })
}

#[derive(Clone, Copy)]
struct Task {
    agent: &'static str,
    install: bool,
}

struct Active {
    task: Task,
    cancel: Arc<Cancel>,
    progress_at: Option<Instant>,
}

struct Service {
    rows: Map<String, Value>,
    queue: VecDeque<Task>,
    active: Option<Active>,
    closed: bool,
    blocked: bool,
    revision: u64,
    persist_warning: bool,
}

pub(super) struct InstallHost {
    root: PathBuf,
    state: Mutex<Service>,
    changed: Notify,
}

impl InstallHost {
    pub(super) fn open(root: PathBuf) -> Self {
        let path = root.join("install-status.json");
        let saved = usage_engine::config_health::management_read(&path, 1024 * 1024)
            .ok()
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .unwrap_or(Value::Null);
        let catalog = builtin_agents();
        let mut rows = Map::new();
        for agent in AGENTS {
            let mut row = json!({"agent":agent,"name":catalog[agent]["name"],"state":"unchecked","version":null,"latest":null,"managed":false,
                "runnable":null,"checkedAt":null,"stage":null,"busy":false,"errorCode":null,"message":null});
            let old = &saved["rows"][agent];
            if old["busy"] == true {
                row["errorCode"] = json!("INSTALL_INTERRUPTED");
                row["message"] = json!(error_message("INSTALL_INTERRUPTED"));
            } else if old.is_object() {
                row["state"] = json!(valid_state(&old["state"]).unwrap_or("unchecked"));
                row["version"] = json!(valid_version(&old["version"]));
                row["latest"] = json!(valid_version(&old["latest"]));
                row["managed"] = json!(old["managed"] == true);
                row["localMaintenanceRequired"] =
                    json!(old["localMaintenanceRequired"] == true || old["governed"] == true);
                row["governed"] = json!(false);
                row["canRollback"] = json!(false);
                row["checkedAt"] = json!(old["checkedAt"]
                    .as_str()
                    .filter(|stamp| parse_iso(stamp).is_some()));
                row["expectedVersion"] = json!(valid_version(&old["expectedVersion"]));
                if old["stage"] == "awaiting-installer" {
                    row["stage"] = json!("awaiting-installer");
                    row["message"] = json!("上次已打开安装程序，请完成后复检；尚未确认安装完成。");
                } else {
                    row["message"] = json!("上次检查结果，请检查当前版本。");
                }
            }
            rows.insert(agent.to_string(), row);
        }
        let state = Service {
            rows,
            queue: VecDeque::new(),
            active: None,
            closed: false,
            blocked: false,
            revision: 0,
            persist_warning: false,
        };
        Self {
            root,
            state: Mutex::new(state),
            changed: Notify::new(),
        }
    }

    pub(super) fn search_directories(&self) -> Vec<String> {
        self.state.lock().ok().map_or_else(Vec::new, |state| {
            state
                .rows
                .values()
                .filter(|row| row["managed"] == true && row["state"] == "installed")
                .filter_map(|row| row["searchDirectory"].as_str())
                .filter(|path| std::path::Path::new(path).starts_with(&self.root))
                .map(str::to_owned)
                .collect()
        })
    }

    pub(super) async fn close(&self) -> Result<()> {
        loop {
            {
                let mut state = self.state.lock().map_err(|_| REAP)?;
                state.closed = true;
                while let Some(task) = state.queue.pop_front() {
                    if let Some(row) = state.rows.get_mut(task.agent) {
                        row["busy"] = Value::Bool(false);
                        row["stage"] = json!("canceled");
                        row["message"] = json!(error_message(CANCELED));
                    }
                }
                if let Some(active) = &state.active {
                    active.cancel.stop();
                } else {
                    return Ok(());
                }
            }
            self.changed.notified().await;
        }
    }

    fn write_status(&self, state: &mut Service) {
        state.revision = state.revision.saturating_add(1);
        let path = self.root.join("install-status.json");
        // Only advisory data is needed on restart. Runtime paths are verified
        // from the active generation on the next explicit check.
        let mut durable = state.rows.clone();
        for row in durable.values_mut() {
            if let Some(row) = row.as_object_mut() {
                row.shift_remove("launchCommand");
                row.shift_remove("searchDirectory");
            }
        }
        state.persist_warning = guard_existing_parent(&path).is_err()
            || store_io::atomic(&path, &json!({"rows":durable}), false).is_err();
    }

    fn progress(&self, app: &AppHandle, task: Task, progress: Progress) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let Some(active) = state
            .active
            .as_mut()
            .filter(|active| active.task.agent == task.agent)
        else {
            return;
        };
        if progress.downloaded_bytes.is_some()
            && active
                .progress_at
                .is_some_and(|time| time.elapsed() < Duration::from_millis(250))
        {
            return;
        }
        active.progress_at = Some(Instant::now());
        if let Some(row) = state.rows.get_mut(task.agent) {
            row["stage"] = json!(progress.stage);
            row["attempt"] = json!(progress.attempt);
            row["downloadedBytes"] = json!(progress.downloaded_bytes);
            row["totalBytes"] = json!(progress.total_bytes);
            if progress.stage == "awaiting-installer" {
                row["message"] = json!("请在官方安装界面完成操作。安装结束后复检版本。");
            }
        }
        self.write_status(&mut state);
        drop(state);
        let _ = app.emit_to(MAIN, "usage:installUpdate", ());
    }
}

impl Service {
    fn view(&self) -> Value {
        let rows: Vec<_> = self
            .rows
            .iter()
            .map(|(agent, row)| {
                let mut row = row.clone();
                let route = if row["localMaintenanceRequired"] == true {
                    "旧本机维护记录 · 请使用本机工具"
                } else if plan(agent).is_some_and(|route| route.desktop()) {
                    "官方安装包 · 需完成安装界面"
                } else {
                    "应用内管理 · 不覆盖其他安装"
                };
                row["route"] = json!(route);
                row["updateAvailable"] = json!(newer(&row));
                row["canCancel"] = json!(row["busy"] == true);
                row["quotaReady"] = Value::Bool(false);
                row
            })
            .collect();
        json!({"schemaVersion":"AgentInstallStateV1","revision":self.revision,"active":self.active.as_ref().map(|active|active.task.agent),
            "blocked":self.blocked,"persistWarning":self.persist_warning,"rows":rows})
    }

    fn reply(&self, ok: bool, message: Option<&str>) -> Value {
        let mut value = json!({"ok":ok,"state":self.view()});
        if let Some(message) = message {
            value["message"] = json!(message);
        }
        value
    }

    fn enqueue(&mut self, task: Task, front: bool) -> bool {
        let Some(row) = self
            .rows
            .get_mut(task.agent)
            .filter(|row| row["busy"] != true)
        else {
            return false;
        };
        row["busy"] = Value::Bool(true);
        row["stage"] = json!("queued");
        row["errorCode"] = Value::Null;
        row["message"] = Value::Null;
        if front {
            self.queue.push_front(task);
        } else {
            self.queue.push_back(task);
        }
        true
    }

    fn take(&mut self) -> Option<(Task, Arc<Cancel>)> {
        if self.active.is_some() || self.closed || self.blocked {
            return None;
        }
        let task = self.queue.pop_front()?;
        let cancel = Arc::new(Cancel::default());
        self.active = Some(Active {
            task,
            cancel: Arc::clone(&cancel),
            progress_at: None,
        });
        Some((task, cancel))
    }

    fn finish(&mut self, task: Task, outcome: Result<Outcome>) {
        self.active = None;
        let Some(row) = self.rows.get_mut(task.agent) else {
            return;
        };
        row["busy"] = Value::Bool(false);
        row["downloadedBytes"] = Value::Null;
        row["totalBytes"] = Value::Null;
        match outcome {
            Ok(Outcome::Installed(runtime)) => {
                row["state"] = json!("installed");
                row["version"] = json!(runtime.version);
                row["latest"] = json!(runtime.version);
                row["runnable"] = Value::Bool(true);
                row["managed"] = Value::Bool(true);
                row["governed"] = Value::Bool(false);
                row["canRollback"] = Value::Bool(false);
                row["localMaintenanceRequired"] = Value::Bool(false);
                row["stage"] = json!("complete");
                row["message"] = json!("应用内版本安装并通过版本复检，未登录或读取额度。");
                row["launchCommand"] = json!(launch_command(&runtime));
                row["searchDirectory"] = json!(runtime.bin_directory);
                if !self.closed {
                    self.enqueue(
                        Task {
                            agent: task.agent,
                            install: false,
                        },
                        true,
                    );
                }
            }
            Ok(Outcome::Desktop { version }) => {
                row["stage"] = json!("awaiting-installer");
                row["expectedVersion"] = json!(version);
                row["message"] = json!("官方安装程序已结束。请点击“复检安装”确认当前版本。");
            }
            Ok(Outcome::Inspected(next)) => {
                let expected = valid_version(&row["expectedVersion"]).map(str::to_owned);
                for key in [
                    "state",
                    "version",
                    "latest",
                    "managed",
                    "runnable",
                    "localMaintenanceRequired",
                    "launchCommand",
                    "searchDirectory",
                ] {
                    row[key] = next[key].clone();
                }
                row["governed"] = Value::Bool(false);
                row["canRollback"] = Value::Bool(false);
                row["checkError"] = json!(next["checkError"].as_str().map(controlled));
                row["checkedAt"] = json!(iso_from_ms(now_ms()));
                row["stage"] = json!("complete");
                if let Some(expected) = expected.filter(|version| {
                    !valid_version(&row["version"]).is_some_and(|checked| {
                        compare(checked, version).is_some_and(|order| order != Ordering::Less)
                    })
                }) {
                    row["expectedVersion"] = json!(expected);
                    row["stage"] = json!("awaiting-installer");
                    row["message"] = json!("尚未发现目标版本，请完成官方安装界面后再复检。");
                } else {
                    row["expectedVersion"] = Value::Null;
                    row["message"] = json!(row["checkError"]
                        .as_str()
                        .and_then(error_message)
                        .unwrap_or_else(|| {
                            if row["state"] == "broken" {
                                "应用内版本无法通过运行核验，可重新安装修复；已有数据保留。"
                            } else {
                                "版本检查已完成；发现程序不表示账号或额度已连接。"
                            }
                        }));
                }
            }
            Err(error) => {
                let code = controlled(error);
                row["errorCode"] = json!(code);
                row["message"] = json!(error_message(code));
                row["stage"] = json!(if code == CANCELED {
                    "canceled"
                } else {
                    "failed"
                });
                if code == "INSTALL_LOCAL_MAINTENANCE_REQUIRED" {
                    row["localMaintenanceRequired"] = Value::Bool(true);
                    row["launchCommand"] = Value::Null;
                    row["searchDirectory"] = Value::Null;
                }
                if code == REAP {
                    self.blocked = true;
                    while let Some(entry) = self.queue.pop_front() {
                        if let Some(row) = self.rows.get_mut(entry.agent) {
                            row["busy"] = Value::Bool(false);
                            row["stage"] = json!("canceled");
                            row["message"] = json!("安装运行环境需人工检查，队列已停止。");
                        }
                    }
                }
            }
        }
    }
}

fn kick(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let reader = app.state::<Reader>();
            let host = &reader.installers;
            let (task, cancel) = {
                let Ok(mut state) = host.state.lock() else {
                    return;
                };
                let Some(selected) = state.take() else {
                    return;
                };
                host.write_status(&mut state);
                selected
            };
            let _ = app.emit_to(MAIN, "usage:installUpdate", ());
            let reply = if reader.probe {
                Err("INSTALL_FIXTURE_BLOCKED")
            } else {
                let notify_app = app.clone();
                let engine = Engine::new(
                    host.root.clone(),
                    Environment::current(),
                    cancel,
                    move |progress| {
                        notify_app.state::<Reader>().installers.progress(
                            &notify_app,
                            task,
                            progress,
                        );
                    },
                );
                match engine {
                    Ok(engine) if task.install => engine.install(task.agent).await,
                    Ok(engine) => engine.inspect(task.agent).await,
                    Err(error) => Err(error),
                }
            };
            {
                let Ok(mut state) = host.state.lock() else {
                    return;
                };
                state.finish(task, reply);
                host.write_status(&mut state);
            }
            host.changed.notify_one();
            let _ = app.emit_to(MAIN, "usage:installUpdate", ());
        }
    });
}

#[tauri::command]
pub(super) fn usage_installers(window: WebviewWindow) -> std::result::Result<Value, String> {
    let app = main_window_app(&window)?;
    let reader = app.state::<Reader>();
    let state = reader.installers.state.lock().map_err(|_| FAILED)?;
    Ok(state.reply(true, None))
}

#[tauri::command]
pub(super) async fn usage_installer_action(
    window: WebviewWindow,
    request: Value,
) -> std::result::Result<Value, String> {
    let app = main_window_app(&window)?;
    let parent = window.clone();
    tauri::async_runtime::spawn_blocking(move || action(&app, &parent, &request))
        .await
        .map_err(|_| FAILED.to_owned())?
}

fn action(
    app: &AppHandle,
    window: &WebviewWindow,
    request: &Value,
) -> std::result::Result<Value, String> {
    let reader = app.state::<Reader>();
    let host = &reader.installers;
    let mut state = host.state.lock().map_err(|_| FAILED)?;
    if state.blocked {
        return Ok(state.reply(false, error_message(REAP)));
    }
    if state.closed
        || request.as_object().is_none_or(|value| value.len() != 3)
        || request["action"].as_str().is_none()
        || request["agent"].as_str().is_none()
        || request["revision"].as_u64().is_none()
    {
        return Ok(state.reply(false, Some("安装请求无效。")));
    }
    if request["revision"].as_u64() != Some(state.revision) {
        return Ok(state.reply(false, Some("安装状态已变化，请使用最新状态重试。")));
    }
    let name = request["agent"].as_str().unwrap_or_default();
    let action = request["action"].as_str().unwrap_or_default();
    if name == "all" && matches!(action, "check-all" | "upgrade-all") {
        let mut changed = false;
        for &agent in AGENTS {
            let install = action == "upgrade-all";
            if install
                && !(newer(&state.rows[agent])
                    && (state.rows[agent]["managed"] == true
                        || plan(agent).is_some_and(|row| row.desktop())))
            {
                continue;
            }
            changed |= state.enqueue(Task { agent, install }, false);
        }
        if changed {
            host.write_status(&mut state);
        }
        let reply = state.reply(true, None);
        drop(state);
        if changed {
            let _ = app.emit_to(MAIN, "usage:installUpdate", ());
            kick(app.clone());
        }
        return Ok(reply);
    }
    let Some(agent) = AGENTS.iter().copied().find(|agent| *agent == name) else {
        return Ok(state.reply(false, Some("这个来源没有程序安装功能。")));
    };
    let current = &state.rows[agent];
    if action == "official" {
        let url = definition(agent).ok_or(FAILED)?.install;
        drop(state);
        let success = tauri_plugin_opener::open_url(url, None::<&str>).is_ok();
        let state = host.state.lock().map_err(|_| FAILED)?;
        let message = if success {
            "已请求浏览器打开官方下载入口。"
        } else {
            "官方下载网页未能打开，请检查默认浏览器后重试。"
        };
        return Ok(state.reply(success, Some(message)));
    }
    if action == "copy-launch" && current["busy"] != true {
        if let Some(command) = current["launchCommand"].as_str() {
            let success = window.clipboard().write_text(command).is_ok();
            return Ok(state.reply(
                success,
                Some(if success {
                    "已复制应用内 CLI 的 PowerShell 启动命令。"
                } else {
                    "无法复制命令。"
                }),
            ));
        }
    }
    let mut start = false;
    let updated = match action {
        "cancel" => {
            if let Some(active) = state
                .active
                .as_ref()
                .filter(|active| active.task.agent == agent)
            {
                active.cancel.stop();
                false
            } else {
                state.queue.retain(|task| task.agent != agent);
                let row = state.rows.get_mut(agent).ok_or(FAILED)?;
                row["busy"] = Value::Bool(false);
                row["stage"] = json!("canceled");
                row["message"] = json!(error_message(CANCELED));
                true
            }
        }
        "dismiss-installer"
            if current["busy"] != true && current["stage"] == "awaiting-installer" =>
        {
            let row = state.rows.get_mut(agent).ok_or(FAILED)?;
            row["expectedVersion"] = Value::Null;
            row["stage"] = json!("canceled");
            row["message"] = json!("已清除待复检标记，未确认安装完成；可重新检查或再次安装。");
            true
        }
        "install" if current["localMaintenanceRequired"] == true => {
            return Ok(state.reply(false, error_message("INSTALL_LOCAL_MAINTENANCE_REQUIRED")))
        }
        "check" | "install"
            if current["busy"] != true
                && (action != "install" || current["stage"] != "awaiting-installer") =>
        {
            start = state.enqueue(
                Task {
                    agent,
                    install: action == "install",
                },
                false,
            );
            start
        }
        _ => return Ok(state.reply(false, Some("请先完成当前操作，或复检安装状态。"))),
    };
    if updated {
        host.write_status(&mut state);
    }
    let reply = state.reply(true, None);
    drop(state);
    if updated {
        let _ = app.emit_to(MAIN, "usage:installUpdate", ());
    }
    if start {
        kick(app.clone());
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interrupted_queue_and_pending_desktop_state_survive_cold_restart(
    ) -> std::result::Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let host = InstallHost::open(dir.path().to_owned());
        {
            let mut state = host
                .state
                .lock()
                .map_err(|_| "installation state poisoned")?;
            assert!(state.enqueue(
                Task {
                    agent: "claude",
                    install: true
                },
                false
            ));
            let (task, _) = state.take().ok_or("task missing")?;
            assert_eq!(task.agent, "claude");
            assert!(state.enqueue(
                Task {
                    agent: "cursor",
                    install: true
                },
                false
            ));
            assert!(state.take().is_none());
            {
                let row = state.rows.get_mut("zcode").ok_or("row missing")?;
                row["managed"] = Value::Bool(false);
                row["stage"] = json!("awaiting-installer");
                row["expectedVersion"] = json!("1.2.3");
            }
            host.write_status(&mut state);
        }
        let reopened = InstallHost::open(dir.path().to_owned());
        let state = reopened
            .state
            .lock()
            .map_err(|_| "installation state poisoned")?;
        assert_eq!(state.rows["claude"]["errorCode"], "INSTALL_INTERRUPTED");
        assert_eq!(state.rows["cursor"]["errorCode"], "INSTALL_INTERRUPTED");
        assert_eq!(state.rows["zcode"]["expectedVersion"], "1.2.3");
        assert_eq!(state.rows["zcode"]["stage"], "awaiting-installer");
        assert_eq!(state.rows["zcode"]["state"], "unchecked");
        Ok(())
    }
}
