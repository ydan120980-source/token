use super::{main_window_app, Reader};
use quota_engine::config_manager::{ConfigManager, Kind, Selection};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use usage_engine::config_health::{scan, selected};

type Reply = Result<Value, &'static str>;
const STALE: &str = "CONFIG_PREVIEW_STALE";
const BUSY: &str = "CONFIG_CHECK_BUSY";
const FAILED: &str = "CONFIG_CHECK_FAILED";

#[derive(Default)]
pub(super) struct ConfigHost {
    session: Mutex<Session>,
    manager: Mutex<ConfigManager>,
}

#[derive(Default)]
struct Session {
    entries: Map<String, Value>,
    roots: Vec<(String, PathBuf)>,
    active: Option<Activity>,
}

struct Activity {
    key: String,
    flag: Arc<AtomicBool>,
    checking: bool,
    visible: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct State<'a> {
    pub busy: bool,
    pub active: Option<&'a str>,
    pub selections: &'a Map<String, Value>,
}

impl Session {
    fn state(&self) -> Value {
        let active = self.active.as_ref().filter(|active| active.visible);
        json!(State {
            busy: active.is_some(),
            active: active.map(|task| task.key.as_str()),
            selections: &self.entries
        })
    }

    fn available(&self) -> Result<(), &'static str> {
        if self.active.is_some() {
            return Err(BUSY);
        }
        Ok(())
    }

    fn root(&self, key: &str) -> Result<PathBuf, &'static str> {
        self.roots
            .iter()
            .find(|(id, _)| id == key)
            .map(|(_, root)| root.clone())
            .ok_or("CONFIG_ROOT_NOT_SELECTED")
    }

    fn forget(&mut self, key: &str) {
        self.roots.retain(|(id, _)| id != key);
        self.entries.shift_remove(key);
    }

    fn invalidate(&mut self, root: &std::path::Path) {
        for (key, selected_root) in &self.roots {
            let matches = selected_root == root
                || selected_root
                    .to_string_lossy()
                    .eq_ignore_ascii_case(&root.to_string_lossy());
            if matches {
                if let Some(entry) = self.entries.get_mut(key) {
                    *entry = entry_state();
                }
            }
        }
    }
}

fn entry_state() -> Value {
    json!({"selected":true,"result":null,"checkedAt":null,"error":null})
}

pub(super) struct Lease<'a> {
    session: &'a Mutex<Session>,
    flag: Arc<AtomicBool>,
}

impl Drop for Lease<'_> {
    fn drop(&mut self) {
        if let Ok(mut session) = self.session.lock() {
            if session
                .active
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(&active.flag, &self.flag))
            {
                session.active = None;
            }
        }
    }
}

impl ConfigHost {
    pub(super) fn inventory_manager(
        &self,
    ) -> Result<(Lease<'_>, std::sync::MutexGuard<'_, ConfigManager>), &'static str> {
        let (lease, _) = self.begin("inventory", false, false, false)?;
        let manager = self.manager.lock().map_err(|_| FAILED)?;
        Ok((lease, manager))
    }

    pub(super) fn invalidate(&self, root: &std::path::Path) {
        if let Ok(mut session) = self.session.lock() {
            session.invalidate(root);
        }
    }

    fn begin(
        &self,
        key: &str,
        checking: bool,
        visible: bool,
        needs_root: bool,
    ) -> Result<(Lease<'_>, Option<PathBuf>), &'static str> {
        let mut session = self.session.lock().map_err(|_| FAILED)?;
        session.available()?;
        let root = if needs_root {
            Some(session.root(key)?)
        } else {
            None
        };
        let flag = Arc::new(AtomicBool::new(false));
        session.active = Some(Activity {
            key: key.to_owned(),
            flag: Arc::clone(&flag),
            checking,
            visible,
        });
        Ok((
            Lease {
                session: &self.session,
                flag,
            },
            root,
        ))
    }

    pub(super) fn release_window(&self) {
        if let Ok(session) = self.session.lock() {
            if let Some(active) = &session.active {
                active.flag.store(true, Ordering::Release);
            }
        }
        if let Ok(mut manager) = self.manager.lock() {
            manager.release();
        }
    }

    fn state(&self) -> Reply {
        let session = self.session.lock().map_err(|_| FAILED)?;
        Ok(session.state())
    }

    fn choose(
        &self,
        window: &WebviewWindow,
        key: &str,
        source_home: Option<&std::path::Path>,
    ) -> Reply {
        let (lease, _) = self.begin(key, false, true, false)?;
        let mut picker = window
            .dialog()
            .file()
            .set_parent(window)
            .set_title("选择 Agent 配置目录");
        if let Some(home) = source_home {
            picker = picker.set_directory(home);
        }
        let chosen = picker.blocking_pick_folder();
        if lease.flag.load(Ordering::Acquire) {
            return Err("CONFIG_CHECK_CLOSED");
        }
        let canceled = chosen.is_none();
        if let Some(folder) = chosen {
            let path = folder
                .into_path()
                .map_err(|_| "CONFIG_SELECTION_REJECTED")?;
            let root = selected(&path).map_err(|_| "CONFIG_SELECTION_REJECTED")?;
            let mut session = self.session.lock().map_err(|_| FAILED)?;
            if let Some((_, existing)) = session.roots.iter_mut().find(|(id, _)| id == key) {
                *existing = root;
            } else {
                session.roots.push((key.to_owned(), root));
            }
            session.entries.insert(key.to_owned(), entry_state());
            drop(session);
            self.manager.lock().map_err(|_| FAILED)?.release();
        }
        drop(lease);
        let mut reply = json!({"state":self.state()?});
        if canceled {
            reply["canceled"] = Value::Bool(true);
        }
        Ok(reply)
    }

    fn check(&self, key: &str, agent: &str, scope: &str) -> Reply {
        let (lease, root) = self.begin(key, true, true, true)?;
        let root = root.ok_or("CONFIG_ROOT_NOT_SELECTED")?;
        if let Some(entry) = self
            .session
            .lock()
            .map_err(|_| FAILED)?
            .entries
            .get_mut(key)
        {
            entry["error"] = Value::Null;
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        let canceled = || lease.flag.load(Ordering::Acquire) || Instant::now() >= deadline;
        let result = scan(&json!({(scope):root}), &[agent], canceled);
        {
            let mut session = self.session.lock().map_err(|_| FAILED)?;
            let entry = session
                .entries
                .get_mut(key)
                .ok_or("CONFIG_ROOT_NOT_SELECTED")?;
            if lease.flag.load(Ordering::Acquire) {
                entry["error"] = json!("CONFIG_CHECK_CANCELLED");
            } else if Instant::now() >= deadline {
                entry["error"] = json!("CONFIG_CHECK_TIMEOUT");
            } else if let Ok(result) = result {
                entry["result"] = result;
                entry["checkedAt"] = json!(iso_now());
            } else {
                entry["error"] = json!(FAILED);
            }
        }
        drop(lease);
        Ok(json!({"state":self.state()?}))
    }

    fn forget(&self, key: &str) -> Reply {
        let (lease, _) = self.begin(key, false, false, false)?;
        self.session.lock().map_err(|_| FAILED)?.forget(key);
        self.manager.lock().map_err(|_| FAILED)?.release();
        drop(lease);
        Ok(json!({"state":self.state()?}))
    }

    fn cancel(&self) -> Reply {
        let session = self.session.lock().map_err(|_| FAILED)?;
        if let Some(active) = session.active.as_ref().filter(|activity| activity.checking) {
            active.flag.store(true, Ordering::Release);
        }
        Ok(json!({"state":session.state()}))
    }

    fn manage(&self, window: &WebviewWindow, backup_root: PathBuf, request: Manage) -> Reply {
        let Manage {
            key,
            agent,
            scope,
            kind,
            action,
            payload,
        } = request;
        if !matches!(
            action.as_str(),
            "list" | "release" | "preview" | "apply" | "undo" | "import"
        ) {
            return Err("CONFIG_SELECTION_INVALID");
        }
        let importing = action == "import";
        let (lease, root) = self.begin(&key, false, importing, true)?;
        let root = root.ok_or("CONFIG_ROOT_NOT_SELECTED")?;
        let selection = Selection {
            root: &root,
            agent: &agent,
            scope: &scope,
            kind,
        };
        let mut manager = self.manager.lock().map_err(|_| FAILED)?;
        let id = payload["id"].as_str();
        let mut reply = match action.as_str() {
            "list" => json!({"view":manager.list(selection)?}),
            "release" => {
                manager.release_selection(&selection, id);
                json!({"released":true})
            }
            "preview" => json!({"preview":manager.prepare(selection,&payload,None)?}),
            "apply" => manager.apply(selection, id, &backup_root)?,
            "undo" => manager.undo(&root, &backup_root)?,
            "import" => {
                manager.can_import(&selection, id)?;
                drop(manager);
                let picker = window.dialog().file().set_parent(window);
                let result = if kind == Kind::Skills {
                    picker.set_title("导入 Skill 目录").blocking_pick_folder()
                } else {
                    picker
                        .set_title("导入 Agent 配置")
                        .add_filter("JSON / TOML", &["json", "toml"])
                        .blocking_pick_file()
                };
                if lease.flag.load(Ordering::Acquire) {
                    return Err("CONFIG_CHECK_CLOSED");
                }
                let Some(file) = result else {
                    return Ok(json!({"canceled":true}));
                };
                let file = file.into_path().map_err(|_| "CONFIG_IMPORT_REJECTED")?;
                manager = self.manager.lock().map_err(|_| FAILED)?;
                json!({"preview":manager.prepare(selection,&payload,Some(&file))?})
            }
            _ => return Err(STALE),
        };
        drop(manager);
        let modified = matches!(action.as_str(), "apply" | "undo");
        if modified {
            self.session.lock().map_err(|_| FAILED)?.invalidate(&root);
        }
        drop(lease);
        if modified {
            reply["state"] = self.state()?;
        }
        Ok(reply)
    }
}

fn iso_now() -> String {
    usage_engine::time::iso_from_ms(usage_engine::time::now_ms())
}

struct Manage {
    key: String,
    agent: String,
    scope: String,
    kind: Kind,
    action: String,
    payload: Value,
}

fn key(agent: &str, scope: &str) -> Result<String, &'static str> {
    if matches!(agent, "codex" | "claude") && matches!(scope, "home" | "project") {
        Ok(format!("{agent}:{scope}"))
    } else {
        Err("CONFIG_SELECTION_INVALID")
    }
}

async fn run(window: &WebviewWindow, f: impl FnOnce(&Reader) -> Reply + Send + 'static) -> Value {
    let app: AppHandle = match main_window_app(window) {
        Ok(app) => app,
        Err(_) => return json!({"error":"IPC_SENDER_REJECTED"}),
    };
    match tauri::async_runtime::spawn_blocking(move || f(&app.state::<Reader>())).await {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => json!({"error":error}),
        Err(_) => json!({"error":FAILED}),
    }
}

#[tauri::command]
pub(super) async fn usage_config_state(window: WebviewWindow) -> Value {
    run(&window, |reader| reader.config.state()).await
}

#[tauri::command]
pub(super) async fn usage_config_choose(
    window: WebviewWindow,
    agent: String,
    scope: String,
) -> Value {
    let parent = window.clone();
    run(&window, move |reader| {
        reader.config.choose(
            &parent,
            &key(&agent, &scope)?,
            reader.source_home.as_deref(),
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn usage_config_check(
    window: WebviewWindow,
    agent: String,
    scope: String,
) -> Value {
    run(&window, move |reader| {
        reader.config.check(&key(&agent, &scope)?, &agent, &scope)
    })
    .await
}

#[tauri::command]
pub(super) async fn usage_config_forget(
    window: WebviewWindow,
    agent: String,
    scope: String,
) -> Value {
    run(&window, move |reader| {
        reader.config.forget(&key(&agent, &scope)?)
    })
    .await
}

#[tauri::command]
pub(super) async fn usage_config_cancel(window: WebviewWindow) -> Value {
    run(&window, |reader| reader.config.cancel()).await
}

#[tauri::command]
pub(super) async fn usage_config_manage(
    window: WebviewWindow,
    action: String,
    agent: String,
    scope: String,
    kind: String,
    request: Option<Value>,
) -> Value {
    let parent = window.clone();
    run(&window, move |reader| {
        let backup = reader.usage_dir.join("config-backups");
        let request = Manage {
            key: key(&agent, &scope)?,
            agent,
            scope,
            kind: Kind::parse(&kind)?,
            action,
            payload: request.unwrap_or(Value::Null),
        };
        reader.config.manage(&parent, backup, request)
    })
    .await
}
