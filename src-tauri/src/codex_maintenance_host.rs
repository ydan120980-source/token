use super::{blocking, main_window_app, Reader, MAIN};
use serde_json::{json, Value};
use tauri::{Emitter, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

#[tauri::command]
pub(super) async fn usage_codex_preview(window: WebviewWindow) -> Result<Value, String> {
    blocking(main_window_app(&window)?, |reader| {
        reader.with_store(|store| {
            let mut slot = reader
                .codex_maintenance
                .lock()
                .map_err(|_| "MAINTENANCE_BUSY")?;
            slot.take();
            let candidate = store.preview_codex_maintenance()?;
            let reply = candidate.summary().clone();
            *slot = Some(candidate);
            Ok(reply)
        })
    })
    .await
}

fn check(reader: &Reader, id: &str) -> Result<(), String> {
    reader.with_store(|store| {
        let slot = reader
            .codex_maintenance
            .lock()
            .map_err(|_| "MAINTENANCE_STALE")?;
        if slot
            .as_ref()
            .is_some_and(|candidate| candidate.matches(store, id))
        {
            Ok(())
        } else {
            Err("MAINTENANCE_STALE".to_owned())
        }
    })
}

#[tauri::command]
pub(super) async fn usage_codex_apply(window: WebviewWindow, id: String) -> Result<Value, String> {
    let app = main_window_app(&window)?;
    let reply=blocking(app.clone(),move |reader|{
        check(reader,&id)?;
        let decision=window.dialog().message("应用预览中的 Codex 用量重建？\n\n只更新本应用统计。自动保存备份，保留无法重读的历史；原始日志与账号连接不变。")
            .parent(&window).kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom("备份并重建".to_owned(),"取消".to_owned()))
            .blocking_show();
        if !decision {return Ok(json!({"canceled":true}));}
        reader.with_store(|store|{
            let mut slot=reader.codex_maintenance.lock().map_err(|_|"MAINTENANCE_STALE")?;
            let candidate=slot.as_ref().ok_or("MAINTENANCE_STALE")?;
            store.apply_codex_maintenance(&id,candidate)?;
            slot.take();
            Ok(json!({"applied":true,"state":reader.usage_state(store)?}))
        })
    }).await?;
    if reply["applied"] == true {
        let _ = app.emit_to(MAIN, "usage:update", ());
    }
    Ok(reply)
}
