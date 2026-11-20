use crate::{
    quota_host::{guard, QuotaHost},
    reader,
};
use quota_engine::{
    account_service::message,
    quota_watch::{self, Settings},
    windows_startup::StartupRegistration,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{self, Read},
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::Notify;
use usage_engine::{
    store_io::atomic,
    time::{iso_from_ms, now_ms},
};

pub const TRAY: &str = "quotadock";
const KEEP: usize = 40;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preferences {
    close_to_tray: bool,
    guided: bool,
    watch: Settings,
    #[serde(default)]
    marks: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellPatch {
    pub close_to_tray: Option<bool>,
    pub guided: Option<bool>,
    pub login: Option<bool>,
    pub watch: Option<WatchPatch>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WatchPatch {
    pub enabled: Option<bool>,
    pub low: Option<u8>,
    pub reset: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadLine {
    at: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    automatic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    quiet: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<u32>,
}

#[derive(Default)]
struct History {
    lines: BTreeMap<String, Vec<ReadLine>>,
    dirty: bool,
}

pub struct DesktopShell {
    root: PathBuf,
    preferences: Mutex<Preferences>,
    history: Mutex<History>,
    login_notified: Mutex<HashSet<String>>,
    notices: bool,
    startup: Option<StartupRegistration>,
    wake: Notify,
    closed: AtomicBool,
}

impl DesktopShell {
    pub fn open(root: &Path, has_accounts: bool, notices: bool) -> Self {
        let preferences = read_owned(&root.join("desktop-shell.json"), 256 * 1024)
            .filter(|value: &Preferences| matches!(value.watch.low, 10 | 20 | 30))
            .unwrap_or_else(|| Preferences {
                close_to_tray: true,
                guided: has_accounts,
                watch: Settings::default(),
                marks: Map::new(),
            });
        let mut lines: BTreeMap<String, Vec<ReadLine>> =
            read_owned(&root.join("read-history.json"), 512 * 1024).unwrap_or_default();
        lines.retain(|id, rows| {
            valid_id(id)
                && rows.len() <= KEEP
                && rows.iter().all(|line| {
                    line.code.as_deref().is_none_or(valid_code)
                        && quota_engine::resource_contract::instant(&json!(line.at)).is_some()
                })
        });
        Self {
            root: root.to_owned(),
            preferences: Mutex::new(preferences),
            history: Mutex::new(History {
                lines,
                ..History::default()
            }),
            login_notified: Mutex::new(HashSet::new()),
            notices,
            startup: if notices {
                std::env::current_exe().ok().and_then(|file| StartupRegistration::new(&file))
            } else {
                None
            },
            wake: Notify::new(),
            closed: AtomicBool::new(false),
        }
    }

    pub fn close_to_tray(&self) -> bool {
        self.preferences
            .lock()
            .map_or(true, |prefs| prefs.close_to_tray)
    }

    fn snapshot(&self, tray: bool) -> Result<Value, String> {
        let prefs = self
            .preferences
            .lock()
            .map_err(|_| "SHELL_STATE_UNAVAILABLE")?;
        let open = self.startup.as_ref().and_then(|startup| startup.enabled().ok());
        Ok(
            json!({"tray":tray,"closeToTray":prefs.close_to_tray,"guided":prefs.guided,
            "notices":self.notices,"login":{"available":open.is_some(),"open":open.unwrap_or(false)},"watch":prefs.watch,
            "lows":[10,20,30]}),
        )
    }

    fn save_preferences(&self, prefs: &Preferences) -> io::Result<()> {
        let data = serde_json::to_value(prefs)?;
        atomic(&self.root.join("desktop-shell.json"), &data, false)
    }

    fn update(&self, patch: ShellPatch) -> Result<(), String> {
        let mut prefs = self
            .preferences
            .lock()
            .map_err(|_| "SHELL_STATE_UNAVAILABLE")?;
        if self.closed.load(Ordering::Acquire) {
            return Err("SHELL_STATE_UNAVAILABLE".to_owned());
        }
        let startup = patch.login
            .map(|enabled| self.startup.as_ref().map(|startup| (startup, enabled)).ok_or("SHELL_LOGIN_UNAVAILABLE"))
            .transpose()?;
        let mut next = Preferences {
            close_to_tray: patch.close_to_tray.unwrap_or(prefs.close_to_tray),
            guided: patch.guided.unwrap_or(prefs.guided),
            watch: prefs.watch,
            marks: std::mem::take(&mut prefs.marks),
        };
        if let Some(watch) = patch.watch {
            next.watch.enabled = watch.enabled.unwrap_or(next.watch.enabled);
            next.watch.reset = watch.reset.unwrap_or(next.watch.reset);
            if let Some(low) = watch.low.filter(|low| matches!(low, 10 | 20 | 30)) {
                next.watch.low = low;
            }
        }
        if self.save_preferences(&next).is_err() {
            prefs.marks = next.marks;
            return Err("SHELL_STORAGE_FAILED".to_owned());
        }
        if let Some((startup, enabled)) = startup {
            if startup.set(enabled).is_err() {
                prefs.marks = next.marks;
                self.save_preferences(&prefs).map_err(|_| "SHELL_STORAGE_FAILED")?;
                return Err("SHELL_LOGIN_UNAVAILABLE".to_owned());
            }
        }
        *prefs = next;
        drop(prefs);
        self.wake.notify_one();
        Ok(())
    }

    fn record(&self, id: &str, code: Option<&str>, automatic: bool, quiet: bool) {
        if !valid_id(id) {
            return;
        }
        let Ok(mut history) = self.history.lock() else {
            return;
        };
        if self.closed.load(Ordering::Acquire) {
            return;
        }
        let code = code.map(|code| {
            if valid_code(code) {
                code
            } else {
                "PROVIDER_REQUEST_FAILED"
            }
        });
        let list = history.lines.entry(id.to_owned()).or_default();
        let at = iso_from_ms(now_ms());
        if let Some(last) = list.last_mut().filter(|line| line.code.as_deref() == code) {
            last.at = at;
            last.count = Some(last.count.unwrap_or(1).saturating_add(1));
        } else {
            list.push(ReadLine {
                at,
                ok: code.is_none(),
                code: code.map(str::to_owned),
                automatic,
                quiet: quiet.then_some(true),
                count: None,
            });
            if list.len() > KEEP {
                list.remove(0);
            }
        }
        history.dirty = true;
        self.wake.notify_one();
    }

    fn read_lines(&self, id: &str) -> Result<Vec<Value>, String> {
        let history = self.history.lock().map_err(|_| "SHELL_STATE_UNAVAILABLE")?;
        Ok(history
            .lines
            .get(id)
            .into_iter()
            .flatten()
            .rev()
            .map(|line| {
                let mut row = json!(line);
                row["message"] = json!(line.code.as_deref().map(message));
                row
            })
            .collect())
    }

    fn flush_history(&self) {
        let Ok(mut history) = self.history.lock() else {
            return;
        };
        if history.dirty
            && atomic(
                &self.root.join("read-history.json"),
                &json!(history.lines),
                false,
            )
            .is_ok()
        {
            history.dirty = false;
        }
    }

    fn notices(&self, accounts: &[Value]) -> Result<Vec<quota_watch::Notice>, String> {
        let mut prefs = self
            .preferences
            .lock()
            .map_err(|_| "SHELL_STATE_UNAVAILABLE")?;
        let enabled = prefs.watch.enabled;
        let rows = quota_watch::window_rows(accounts);
        let evaluated = quota_watch::evaluate(&rows, &prefs.marks, prefs.watch, now_ms());
        if prefs.marks != evaluated.marks {
            prefs.marks = evaluated.marks;
            let _ = self.save_preferences(&prefs);
        }
        drop(prefs);
        let mut notices = if enabled {
            quota_watch::bundled(evaluated.notices)
        } else {
            Vec::new()
        };
        let mut seen = self
            .login_notified
            .lock()
            .map_err(|_| "SHELL_STATE_UNAVAILABLE")?;
        let relogin: HashSet<_> = accounts
            .iter()
            .filter(|row| row["status"] == "login-required")
            .filter_map(|row| row["id"].as_str())
            .filter(|id| valid_id(id))
            .map(str::to_owned)
            .collect();
        if enabled && relogin.iter().any(|id| !seen.contains(id)) {
            notices.push(quota_watch::Notice {
                kind: "login",
                title: "额度连接需要登录".to_owned(),
                body: "打开 QuotaDock 查看需要重新登录的连接。".to_owned(),
                agent: None,
            });
        }
        *seen = relogin;
        Ok(notices)
    }

    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.wake.notify_one();
        self.flush_history();
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-')
}

fn valid_code(code: &str) -> bool {
    code.len() <= 64
        && (code.starts_with("PROVIDER_")
            || code.starts_with("CODEX_")
            || matches!(
                code,
                "LOGIN_REQUIRED" | "RATE_LIMITED" | "SYSTEM_CREDENTIAL_STORE_REQUIRED"
            ))
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
}

fn read_owned<T: serde::de::DeserializeOwned>(path: &Path, limit: usize) -> Option<T> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.file_attributes() & 0x400 != 0 || meta.len() > limit as u64 {
        return None;
    }
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > limit {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

pub fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.state::<DesktopShell>().notices {
        let owner = app.clone();
        app.notification().on_action(move |event| {
            if event.action_id() == "tap"
                && !owner.state::<DesktopShell>().closed.load(Ordering::Acquire)
            {
                reader::schedule_open_command(&owner, Some("show-quota".to_owned()));
            }
        })?;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let shell = app.state::<DesktopShell>();
        while !shell.closed.load(Ordering::Acquire) {
            tokio::select! {
                _ = shell.wake.notified() => tokio::time::sleep(Duration::from_millis(1500)).await,
                _ = tokio::time::sleep(Duration::from_secs(60)) => {}
            }
            if shell.closed.load(Ordering::Acquire) {
                return;
            }
            let owned = app.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                let shell = owned.state::<DesktopShell>();
                shell.flush_history();
                if !shell.notices || shell.closed.load(Ordering::Acquire) {
                    return;
                }
                let host = owned.state::<QuotaHost>();
                let Ok(result) = host.quota_state(true) else {
                    return;
                };
                let Some(accounts) = result["accounts"].as_array() else {
                    return;
                };
                let Ok(notices) = shell.notices(accounts) else {
                    return;
                };
                for notice in notices {
                    if shell.closed.load(Ordering::Acquire) {
                        break;
                    }
                    if owned
                        .notification()
                        .builder()
                        .title(notice.title)
                        .body(notice.body)
                        .show()
                        .is_err()
                    {
                        eprintln!("SHELL_NOTIFICATION_FAILED");
                    }
                }
            })
            .await;
        }
    });
    Ok(())
}

pub fn changed(app: &AppHandle) {
    if let Some(shell) = app.try_state::<DesktopShell>() {
        if shell.notices {
            shell.wake.notify_one();
        }
    }
}

pub fn record_read(app: &AppHandle, id: &str, code: Option<&str>, automatic: bool) {
    if let Some(shell) = app.try_state::<DesktopShell>() {
        shell.record(id, code, automatic, false);
    }
}

pub fn record_quiet_read(app: &AppHandle, id: &str, code: &str) {
    if let Some(shell) = app.try_state::<DesktopShell>() {
        shell.record(id, Some(code), true, true);
    }
}

pub fn forget(app: &AppHandle, id: &str) {
    if let Some(shell) = app.try_state::<DesktopShell>() {
        if let Ok(mut history) = shell.history.lock() {
            if history.lines.remove(id).is_some() {
                history.dirty = true;
                shell.wake.notify_one();
            }
        }
    }
}

#[tauri::command]
pub fn shell_get(window: WebviewWindow, shell: State<'_, DesktopShell>) -> Result<Value, String> {
    guard(&window)?;
    shell.snapshot(window.app_handle().tray_by_id(TRAY).is_some())
}

#[tauri::command]
pub async fn shell_set(window: WebviewWindow, patch: ShellPatch) -> Result<Value, String> {
    guard(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let shell = app.state::<DesktopShell>();
        shell.update(patch)?;
        shell.snapshot(app.tray_by_id(TRAY).is_some())
    })
    .await
    .map_err(|_| "SHELL_STORAGE_FAILED".to_owned())?
}

#[tauri::command]
pub fn shell_read_history(
    window: WebviewWindow,
    shell: State<'_, DesktopShell>,
    id: String,
) -> Result<Vec<Value>, String> {
    guard(&window)?;
    if id.len() > 64 {
        return Err("ACCOUNT_NOT_FOUND".to_owned());
    }
    shell.read_lines(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_preferences_and_history_round_trip_with_bounded_projection(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let shell = DesktopShell::open(root.path(), false, false);
        let id = "bbbf92ff-e719-4c48-9614-2faa1a675dbd";
        shell.update(serde_json::from_value(
            json!({"closeToTray":false,"guided":true,"watch":{"low":30}}),
        )?)?;
        shell.record(id, None, false, false);
        shell.record(id, None, true, false);
        shell.record(id, Some("private server error"), true, true);
        shell.close();

        let saved = DesktopShell::open(root.path(), false, false);
        assert!(!saved.close_to_tray());
        let state = saved.snapshot(true)?;
        assert_eq!(state["guided"], true);
        assert_eq!(state["watch"]["low"], 30);
        let lines = saved.read_lines(id)?;
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["code"], "PROVIDER_REQUEST_FAILED");
        assert_eq!(lines[0]["automatic"], true);
        assert_eq!(lines[1]["count"], 2);
        assert_eq!(lines[1]["automatic"], false);
        assert!(saved.read_lines("../read-history.json")?.is_empty());
        Ok(())
    }

    #[test]
    fn relogin_notice_is_transition_based_and_contains_no_account_labels(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let shell = DesktopShell::open(root.path(), true, false);
        let account = json!({"id":"bbbf92ff-e719-4c48-9614-2faa1a675dbd","alias":"Synthetic private label","status":"login-required"});
        let notices = shell.notices(std::slice::from_ref(&account))?;
        assert_eq!(notices.len(), 1);
        assert!(!serde_json::to_string(&notices)?.contains("Synthetic private"));
        assert!(shell.notices(std::slice::from_ref(&account))?.is_empty());
        assert!(shell.notices(&[])?.is_empty());
        assert_eq!(shell.notices(&[account])?.len(), 1);
        Ok(())
    }
}
