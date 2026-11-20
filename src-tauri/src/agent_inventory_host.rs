use super::{main_window_app, Reader};
use quota_engine::config_manager::ConfigManager;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    env,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use usage_engine::{
    agent_inventory::{self, Environment, Inventory, Item},
    config_health::{guard, selected},
    store_io,
    time::{iso_from_ms, now_ms},
};

const BUSY: &str = "INVENTORY_BUSY";
const FAILED: &str = "INVENTORY_FAILED";
const UNKNOWN: &str = "INVENTORY_ITEM_UNKNOWN";
const UNSUPPORTED: &str = "INVENTORY_ACTION_UNSUPPORTED";
type Reply = Result<Value, &'static str>;

#[derive(Default)]
pub(super) struct InventoryHost {
    session: Mutex<Session>,
    active: AtomicBool,
}

#[derive(Default)]
struct Session {
    inventory: Option<Inventory>,
    checked_at: Option<String>,
    error: Option<&'static str>,
    busy: bool,
    repaired: Vec<String>,
}
impl Session {
    fn item(&self, id: &Value) -> Result<&Item, &'static str> {
        let id = id.as_str().ok_or(UNKNOWN)?;
        self.inventory
            .as_ref()
            .and_then(|inventory| inventory.items.iter().find(|item| item.id == id))
            .ok_or(UNKNOWN)
    }

    fn state(&self, dir: &Path) -> Value {
        let projects: Vec<_> = projects(dir)
            .iter()
            .enumerate()
            .map(|(index, path)| json!({"id":index,"name":path.file_name()}))
            .collect();
        json!({"busy":self.busy,"error":self.error,"checkedAt":self.checked_at,"inventory":self.inventory,"repaired":self.repaired.len(),"projects":projects})
    }
}

struct Activity<'a>(&'a AtomicBool);
impl Drop for Activity<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn projects(dir: &Path) -> Vec<PathBuf> {
    store_io::load(&dir.join("agent-projects.json"), Value::Null, None, false)
        .ok()
        .and_then(|saved| {
            saved.get("projects").and_then(Value::as_array).map(|rows| {
                rows.iter()
                    .filter_map(Value::as_str)
                    .map(PathBuf::from)
                    .filter(|path| path.is_absolute())
                    .collect()
            })
        })
        .unwrap_or_default()
}

fn persist(dir: &Path, projects: &[PathBuf]) -> Result<(), &'static str> {
    store_io::atomic(
        &dir.join("agent-projects.json"),
        &json!({"projects":projects}),
        false,
    )
    .map_err(|_| FAILED)
}

fn fallback_env(probe: bool) -> Environment {
    if probe {
        return Environment::default();
    }
    Environment {
        path: env::var("Path").unwrap_or_default(),
        path_ext: env::var("PATHEXT").unwrap_or_default(),
        names: Some(
            env::vars_os()
                .filter_map(|(name, _)| name.into_string().ok())
                .collect(),
        ),
    }
}

impl InventoryHost {
    fn begin(&self) -> Result<Activity<'_>, &'static str> {
        self.active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| BUSY)?;
        Ok(Activity(&self.active))
    }

    fn check(&self, reader: &Reader) -> Reply {
        let home = reader.source_home.as_deref().ok_or(FAILED)?;
        {
            let mut session = self.session.lock().map_err(|_| FAILED)?;
            session.busy = true;
            session.error = None;
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        let existing: Vec<_> = projects(&reader.usage_dir)
            .into_iter()
            .filter_map(|root| selected(&root).ok())
            .collect();
        let inventory = agent_inventory::scan(home, &existing, &fallback_env(reader.probe), || {
            Instant::now() >= deadline
        });
        let mut session = self.session.lock().map_err(|_| FAILED)?;
        session.busy = false;
        match inventory {
            Ok(inventory) => {
                session.inventory = Some(inventory);
                session.checked_at = Some(iso_from_ms(now_ms()));
            }
            Err(error) => {
                session.error = Some(if error == "INVENTORY_TIMEOUT" {
                    error
                } else {
                    FAILED
                })
            }
        }
        Ok(session.state(&reader.usage_dir))
    }

    fn project(&self, window: &WebviewWindow, dir: &Path, remove: Option<&Value>) -> Reply {
        let mut list = projects(dir);
        if let Some(id) = remove {
            let index = id
                .as_u64()
                .and_then(|index| usize::try_from(index).ok())
                .filter(|index| *index < list.len())
                .ok_or(UNKNOWN)?;
            let root = list.remove(index);
            persist(dir, &list)?;
            let mut session = self.session.lock().map_err(|_| FAILED)?;
            if let Some(inventory) = &mut session.inventory {
                inventory
                    .items
                    .retain(|item| item.locator.scope != "project" || item.locator.root != root);
            }
            return Ok(json!({"state":session.state(dir)}));
        }
        let chosen = window
            .dialog()
            .file()
            .set_parent(window)
            .set_title("添加 Agent 配置项目")
            .blocking_pick_folder();
        let Some(chosen) = chosen else {
            return Ok(
                json!({"canceled":true,"state":self.session.lock().map_err(|_|FAILED)?.state(dir)}),
            );
        };
        let folder = chosen.into_path().map_err(|_| "CONFIG_PATH_REJECTED")?;
        let root = selected(&folder).map_err(|_| "CONFIG_PATH_REJECTED")?;
        if !list.iter().any(|existing| {
            existing
                .to_string_lossy()
                .eq_ignore_ascii_case(&root.to_string_lossy())
        }) {
            list.push(root);
            persist(dir, &list)?;
        }
        Ok(json!({"state":self.session.lock().map_err(|_|FAILED)?.state(dir)}))
    }
}

fn locate(window: &WebviewWindow, item: &Item, action: &Value) -> Reply {
    let file = &item.locator.file;
    guard(file).map_err(|_| "INVENTORY_FILE_MISSING")?;
    match action.as_str() {
        Some("copy") => window
            .clipboard()
            .write_text(file.to_string_lossy().into_owned())
            .map_err(|_| "INVENTORY_OPEN_FAILED")?,
        Some("reveal") => {
            tauri_plugin_opener::reveal_item_in_dir(file).map_err(|_| "INVENTORY_OPEN_FAILED")?
        }
        Some("open") => {
            if !agent_inventory::openable(file)
                || agent_inventory::sensitive_name(file)
                || !file.is_file()
            {
                return Err("INVENTORY_OPEN_REFUSED");
            }
            tauri_plugin_opener::open_path(file, None::<&str>)
                .map_err(|_| "INVENTORY_OPEN_FAILED")?;
        }
        _ => return Err(UNSUPPORTED),
    }
    Ok(json!({"done":true}))
}

fn plan(session: &Session, manager: &mut ConfigManager) -> Value {
    let mut rows = Vec::new();
    let mut manual = Vec::new();
    for item in session
        .inventory
        .iter()
        .flat_map(|inventory| &inventory.items)
    {
        let fix = if item.enabled == Some(false) {
            None
        } else {
            item.problems
                .iter()
                .find(|row| row.remedy == "stop")
                .or_else(|| {
                    item.problems
                        .iter()
                        .find(|row| row.remedy == "stop-optional")
                })
        };
        let item_view = |text: &str| json!({"id":item.id,"name":item.name,"agent":item.agent,"kind":item.kind,"file":item.file,"text":text});
        if let Some(fix) = fix {
            let mut row = item_view(&fix.text);
            match manager.preview_item(item, &json!({"action":"toggle","enabled":false})) {
                Ok(_) => {
                    row["chosen"] = json!(fix.remedy == "stop");
                    rows.push(row);
                }
                Err(error) => {
                    row["why"] = json!(error);
                    row["fix"] = json!(fix.fix);
                    manual.push(row);
                }
            }
        }
        for problem in item
            .problems
            .iter()
            .filter(|row| row.remedy == "manual" && row.level != "note")
        {
            let mut row = item_view(&problem.text);
            row["why"] = Value::Null;
            row["fix"] = json!(problem.fix);
            manual.push(row);
        }
    }
    manager.release();
    json!({"rows":rows,"manual":manual})
}

fn repair(
    reader: &Reader,
    session: &mut Session,
    manager: &mut ConfigManager,
    backups: &Path,
    ids: &Value,
) -> Reply {
    let ids = ids
        .as_array()
        .filter(|ids| ids.len() <= 1000 && ids.iter().all(Value::is_string))
        .ok_or("CONFIG_EDIT_INVALID")?;
    let choices = plan(session, manager);
    let mut visited = HashSet::new();
    let mut done = Vec::new();
    let mut failed = Vec::new();
    let mut records = Vec::new();
    for id in ids
        .iter()
        .filter_map(Value::as_str)
        .filter(|id| visited.insert(*id))
    {
        let row = choices["rows"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|row| row["id"] == id);
        let Some(row) = row else {
            failed.push(json!({"id":id,"name":id,"error":UNKNOWN}));
            continue;
        };
        let attempted = (|| {
            let item = session.item(&row["id"])?;
            let preview =
                manager.preview_item(item, &json!({"action":"toggle","enabled":false}))?;
            let id = preview["id"].as_str().ok_or("CONFIG_PREVIEW_STALE")?;
            manager.apply_item(id, backups)
        })();
        match attempted {
            Ok((root, result)) => {
                reader.config.invalidate(&root);
                if let Some(record) = result["record"].as_str() {
                    records.push(record.to_owned());
                }
                done.push(json!({"id":id,"name":row["name"]}));
            }
            Err(error) => failed.push(json!({"id":id,"name":row["name"],"error":error})),
        }
    }
    session.repaired = records;
    Ok(json!({"done":done,"failed":failed,"state":session.state(&reader.usage_dir)}))
}

fn request(reader: &Reader, window: &WebviewWindow, action: &str, args: &[Value]) -> Reply {
    let host = &reader.inventory;
    if action == "state" {
        if !args.is_empty() {
            return Err(UNSUPPORTED);
        }
        return Ok(host
            .session
            .lock()
            .map_err(|_| FAILED)?
            .state(&reader.usage_dir));
    }
    let _activity = host.begin()?;
    match (action, args) {
        ("check", []) => return host.check(reader),
        ("addProject", []) => return host.project(window, &reader.usage_dir, None),
        ("removeProject", [id]) => return host.project(window, &reader.usage_dir, Some(id)),
        _ => {}
    }
    let mut session = host.session.lock().map_err(|_| FAILED)?;
    let backups = reader.usage_dir.join("config-backups");
    match (action, args) {
        ("instruction", [id]) => ConfigManager::read_instruction(session.item(id)?),
        ("locate", [request]) => locate(window, session.item(&request["id"])?, &request["action"]),
        ("history", []) => Ok(json!({"records":ConfigManager::history(&backups)})),
        _ => {
            let (_lease, mut manager) = reader.config.inventory_manager()?;
            match (action, args) {
                ("preview", [request]) => Ok(
                    json!({"preview":manager.preview_item(session.item(&request["id"])? ,request)?}),
                ),
                ("apply", [id]) => {
                    let (root, result) =
                        manager.apply_item(id.as_str().ok_or("CONFIG_PREVIEW_STALE")?, &backups)?;
                    reader.config.invalidate(&root);
                    Ok(result)
                }
                ("plan", []) => Ok(plan(&session, &mut manager)),
                ("repair", [ids]) => repair(reader, &mut session, &mut manager, &backups, ids),
                ("undoRepair", []) => {
                    let size = session.repaired.len();
                    let mut restored = 0;
                    for id in session.repaired.drain(..).rev() {
                        if let Ok((root, _)) = manager.restore_record(&backups, &id) {
                            reader.config.invalidate(&root);
                            restored += 1;
                        }
                    }
                    Ok(
                        json!({"restored":restored,"left":size-restored,"state":session.state(&reader.usage_dir)}),
                    )
                }
                ("restore", [id]) => {
                    let (root, mut result) = manager
                        .restore_record(&backups, id.as_str().ok_or("CONFIG_UNDO_UNAVAILABLE")?)?;
                    reader.config.invalidate(&root);
                    result["records"] = json!(ConfigManager::history(&backups));
                    Ok(result)
                }
                _ => Err("INVENTORY_ACTION_REJECTED"),
            }
        }
    }
}

#[tauri::command]
pub(super) async fn usage_agents(window: WebviewWindow, action: String, args: Vec<Value>) -> Value {
    let app = match main_window_app(&window) {
        Ok(app) => app,
        Err(_) => return json!({"error":"IPC_SENDER_REJECTED"}),
    };
    match tauri::async_runtime::spawn_blocking(move || {
        request(&app.state::<Reader>(), &window, &action, &args)
    })
    .await
    {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => json!({"error":error}),
        Err(_) => json!({"error":FAILED}),
    }
}
