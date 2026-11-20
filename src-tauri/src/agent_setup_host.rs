use super::{main_window_app, Reader};
use quota_engine::{
    agent_runtime::{definition, discover, discover_antigravity, Environment},
    agent_setup::{agent_view, antigravity_view, usage_recovery},
};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;

const AGY: &str = "antigravity";

#[derive(Default)]
pub(super) struct SetupHost {
    slots: Mutex<HashMap<String, Slot>>,
}

#[derive(Default)]
struct Slot {
    revision: u64,
    signature: Option<Value>,
    runtime: Option<Value>,
    busy: bool,
}

struct Facts {
    name: String,
    usage: Value,
}

fn facts(reader: &Reader, agent: &str) -> Result<Facts, String> {
    reader.with_store(|store| {
        let catalog = store.catalog();
        let meta = catalog
            .get(agent)
            .and_then(Value::as_object)
            .ok_or("SETUP_AGENT_REJECTED")?;
        let name = meta
            .get("name")
            .and_then(Value::as_str)
            .ok_or("SETUP_AGENT_REJECTED")?;
        let enabled = store.settings["enabled"] != false
            && store.state["customSources"][agent]["enabled"] != false
            && !store.settings["sources"]["disabled"]
                .as_array()
                .is_some_and(|disabled| disabled.iter().any(|id| id == agent));
        let usage = usage_recovery(
            enabled,
            &store.state["statuses"][agent],
            meta.get("custom") == Some(&Value::Bool(true)),
        );
        Ok(Facts {
            name: name.to_owned(),
            usage,
        })
    })
}

fn failure(agy: bool, kind: &str, state: Option<Value>) -> Value {
    let (error, message) = match (agy, kind) {
        (true, "stale") => ("AGY_SETUP_STALE", "CLI 状态已更新，请使用最新引导。"),
        (true, "busy") => ("AGY_SETUP_BUSY", "已有引导操作正在进行，请等待其结果。"),
        (true, "unavailable") => (
            "AGY_SETUP_ACTION_UNAVAILABLE",
            "当前状态已不适用此操作，请查看最新引导。",
        ),
        (true, "scan") => (
            "AGY_SETUP_SCAN_FAILED",
            "重新扫描失败，已保留上次发现结果供参考。",
        ),
        (true, "copy") => (
            "AGY_SETUP_COPY_FAILED",
            "安装命令未能复制，请重试或打开官方指南。",
        ),
        (true, "open") => (
            "AGY_SETUP_GUIDE_FAILED",
            "未能打开官方指南，请检查默认浏览器后重试。",
        ),
        (true, _) => (
            "AGY_SETUP_ARGUMENTS_REJECTED",
            "请求参数无效，请刷新引导状态后重试。",
        ),
        (false, "agent") => ("SETUP_AGENT_REJECTED", "来源不可用，请重新打开引导。"),
        (false, "stale") => ("SETUP_STALE", "状态已变化，请使用最新引导。"),
        (false, "busy") => ("SETUP_BUSY", "已有引导操作正在进行。"),
        (false, "unavailable") => ("SETUP_ACTION_UNAVAILABLE", "当前状态不适用此操作。"),
        (false, "changed") => (
            "SETUP_ACTION_UNAVAILABLE",
            "发现结果已变化，安装命令未复制，请查看最新引导。",
        ),
        (false, "scan") => ("SETUP_SCAN_FAILED", "本次扫描失败，保留上次结果；请重试。"),
        (false, "copy") => ("SETUP_COPY_FAILED", "未能复制安装命令；可打开官方指南。"),
        (false, "open") => (
            "SETUP_GUIDE_FAILED",
            "未能打开指南；请检查默认浏览器后重试。",
        ),
        (false, _) => ("SETUP_ARGUMENTS_REJECTED", "请求参数无效，请刷新引导。"),
    };
    json!({"ok":false,"errorCode":error,"message":message,"state":state})
}

fn view(slot: &mut Slot, agent: &str, facts: Option<&Facts>) -> Option<Value> {
    let Some(facts) = facts else {
        return Some(antigravity_view(slot.revision, slot.runtime.as_ref()));
    };
    if agent != AGY && slot.signature.as_ref() != Some(&facts.usage) {
        slot.revision = slot.revision.saturating_add(1);
        slot.signature = Some(facts.usage.clone());
    }
    agent_view(
        agent,
        &facts.name,
        &facts.usage,
        slot.revision,
        slot.runtime.as_ref(),
    )
}

fn environment(reader: &Reader) -> Environment {
    if !reader.probe {
        let mut env = Environment::current();
        let mut paths = reader.installers.search_directories();
        if !paths.is_empty() {
            paths.push(env.path);
            env.path = paths.join(";");
        }
        return env;
    }
    let home = reader.source_home.as_ref();
    let text = |path: Option<std::path::PathBuf>| {
        path.map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default()
    };
    Environment {
        platform: "win32".to_owned(),
        home: home
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        local_app_data: text(home.map(|path| path.join("AppData/Local"))),
        app_data: text(home.map(|path| path.join("AppData/Roaming"))),
        ..Environment::default()
    }
}

fn state(reader: &Reader, agent: &str, quota: bool) -> Value {
    let Ok(mut slots) = reader.agent_setup.slots.lock() else {
        return failure(quota, "scan", None);
    };
    let facts = if quota {
        None
    } else {
        let Ok(facts) = facts(reader, agent) else {
            return failure(false, "agent", None);
        };
        Some(facts)
    };
    let slot = slots.entry(agent.to_owned()).or_default();
    view(slot, agent, facts.as_ref()).map_or_else(
        || failure(quota, "agent", None),
        |state| json!({"ok":true,"state":state}),
    )
}

fn performs(state: &Value, id: &str) -> bool {
    state["actions"]
        .as_array()
        .is_some_and(|rows| rows.iter().any(|row| row["id"] == id))
}

fn action(reader: &Reader, window: &WebviewWindow, request: &Value, quota: bool) -> Value {
    let (agent, id, revision) = match (
        request.as_object(),
        request["agent"].as_str(),
        request["actionId"].as_str(),
        request["revision"].as_u64(),
    ) {
        (Some(map), None, Some(id), Some(revision)) if quota && map.len() == 2 => {
            (AGY, id, revision)
        }
        (Some(map), Some(agent), Some(id), Some(revision)) if !quota && map.len() == 3 => {
            (agent, id, revision)
        }
        _ => return failure(quota, "invalid", None),
    };
    let agy = agent == AGY;
    let facts = if quota {
        None
    } else {
        let Ok(facts) = facts(reader, agent) else {
            return failure(agy, "invalid", None);
        };
        Some(facts)
    };
    let before = {
        let Ok(mut slots) = reader.agent_setup.slots.lock() else {
            return failure(agy, "scan", None);
        };
        let slot = slots.entry(agent.to_owned()).or_default();
        let Some(before) = view(slot, agent, facts.as_ref()) else {
            return failure(agy, "invalid", None);
        };
        if slot.busy {
            return failure(agy, "busy", Some(before));
        }
        if slot.revision != revision {
            return failure(agy, "stale", Some(before));
        }
        if !performs(&before, id) {
            return failure(agy, "unavailable", Some(before));
        }
        slot.busy = true;
        before
    };
    let refreshed = if matches!(id, "rescan" | "copy-install-command")
        || agy && id == "installation-guide" && before["installation"]["command"].is_string()
    {
        Some(if agy {
            Ok(discover_antigravity(&environment(reader)))
        } else {
            discover(agent, &environment(reader)).map(|runtime| json!(runtime))
        })
    } else {
        None
    };
    let scanned = refreshed.as_ref().is_some_and(Result::is_ok);
    let scan_failed = refreshed.as_ref().is_some_and(Result::is_err);
    let after = {
        let Ok(mut slots) = reader.agent_setup.slots.lock() else {
            return failure(agy, "scan", None);
        };
        let Some(slot) = slots.get_mut(agent) else {
            return failure(agy, "scan", None);
        };
        if let Some(Ok(runtime)) = refreshed {
            slot.runtime = Some(runtime);
            slot.revision = slot.revision.saturating_add(1);
        }
        view(slot, agent, facts.as_ref()).unwrap_or(before)
    };
    let result = if scan_failed {
        failure(agy, "scan", Some(after))
    } else if id == "rescan" && scanned {
        json!({"ok":true,"state":after,"outcome":"metadata-rescanned"})
    } else if !performs(&after, id) {
        failure(
            agy,
            if id == "copy-install-command" {
                "changed"
            } else {
                "unavailable"
            },
            Some(after),
        )
    } else if id == "copy-install-command" {
        if after["installation"]["command"]
            .as_str()
            .is_some_and(|command| window.clipboard().write_text(command).is_ok())
        {
            json!({"ok":true,"state":after,"outcome":"command-copied"})
        } else {
            failure(agy, "copy", Some(after))
        }
    } else {
        let url = definition(agent).and_then(|spec| match id {
            "installation-guide" => Some(spec.install),
            "troubleshooting-guide" => Some(spec.help),
            _ => None,
        });
        if url.is_some_and(|url| tauri_plugin_opener::open_url(url, None::<&str>).is_ok()) {
            json!({"ok":true,"state":after,"outcome":"guide-opened"})
        } else {
            failure(agy, "open", Some(after))
        }
    };
    if let Ok(mut slots) = reader.agent_setup.slots.lock() {
        if let Some(slot) = slots.get_mut(agent) {
            slot.busy = false;
        }
    }
    result
}

async fn command(
    window: WebviewWindow,
    work: impl FnOnce(&Reader, &WebviewWindow) -> Value + Send + 'static,
) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<Reader>(), &window))
        .await
        .map_err(|_| "SETUP_SCAN_FAILED".to_owned())
}

#[tauri::command]
pub(super) async fn usage_agent_setup(
    window: WebviewWindow,
    agent: String,
) -> Result<Value, String> {
    command(window, move |reader, _| state(reader, &agent, false)).await
}
#[tauri::command]
pub(super) async fn usage_agent_setup_action(
    window: WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    command(window, move |reader, window| {
        action(reader, window, &request, false)
    })
    .await
}
#[tauri::command]
pub(super) async fn quota_discover_antigravity(window: WebviewWindow) -> Result<Value, String> {
    command(
        window,
        |reader, _| json!({"ok":true,"discovery":discover_antigravity(&environment(reader))}),
    )
    .await
}
#[tauri::command]
pub(super) async fn quota_antigravity_setup(window: WebviewWindow) -> Result<Value, String> {
    command(window, |reader, _| state(reader, AGY, true)).await
}
#[tauri::command]
pub(super) async fn quota_antigravity_setup_action(
    window: WebviewWindow,
    request: Value,
) -> Result<Value, String> {
    command(window, move |reader, window| {
        action(reader, window, &request, true)
    })
    .await
}
