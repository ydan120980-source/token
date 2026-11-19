use crate::quota_host::QuotaHost;
use quota_engine::quota_watch::window_rows;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicI64, Ordering},
        Mutex,
    },
};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use usage_engine::time::now_ms;

pub const CARD: &str = "tray-card";
const PATH: &str = "design/desktop-reference/tray/card.html";
const WIDTH: f64 = 340.0;

#[derive(Default)]
pub struct TrayCard {
    anchor: Mutex<Option<Rect>>,
    opening: AtomicBool,
    focused: AtomicBool,
    closed_at: AtomicI64,
}

pub fn close(app: &AppHandle) {
    if let Some(card) = app.get_webview_window(CARD) {
        let state = app.state::<TrayCard>();
        state.focused.store(false, Ordering::Release);
        state.closed_at.store(now_ms(), Ordering::Release);
        let _ = card.destroy();
    }
}

pub fn toggle(app: &AppHandle, anchor: Rect, directory: &Path, arguments: &str) {
    let state = app.state::<TrayCard>();
    if app.get_webview_window(CARD).is_some() {
        close(app);
        return;
    }
    if now_ms().saturating_sub(state.closed_at.load(Ordering::Acquire)) < 250
        || state.opening.swap(true, Ordering::AcqRel)
    {
        return;
    }
    if let Ok(mut saved) = state.anchor.lock() {
        *saved = Some(anchor);
    }
    let dark = app
        .get_webview_window("main")
        .and_then(|window| window.theme().ok())
        .is_some_and(|theme| theme == tauri::Theme::Dark);
    let theme = if dark { "dark" } else { "light" };
    let result = WebviewWindowBuilder::new(
        app,
        CARD,
        WebviewUrl::App(format!("{PATH}?theme={theme}").into()),
    )
    .title("QuotaDock")
    .inner_size(WIDTH, 240.0)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .data_directory(directory.to_path_buf())
    .additional_browser_args(arguments)
    .on_navigation(|url| {
        url.scheme() == "http"
            && url.host_str() == Some("tauri.localhost")
            && url.path() == format!("/{PATH}")
    })
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build();
    state.opening.store(false, Ordering::Release);
    let Ok(card) = result else { return };
    let _ = place(&card, 240.0);
    let app = app.clone();
    card.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => app
            .state::<TrayCard>()
            .focused
            .store(true, Ordering::Release),
        WindowEvent::Focused(false) if app.state::<TrayCard>().focused.load(Ordering::Acquire) => {
            close(&app)
        }
        _ => {}
    });
    let _ = card.show();
    let _ = card.set_focus();
}

fn place(card: &WebviewWindow, height: f64) -> tauri::Result<()> {
    let state = card.state::<TrayCard>();
    let anchor = state.anchor.lock().ok().and_then(|anchor| *anchor);
    let Some(anchor) = anchor else { return Ok(()) };
    let initial = anchor.position.to_physical::<f64>(card.scale_factor()?);
    let Some(monitor) = card
        .monitor_from_point(initial.x, initial.y)?
        .or(card.primary_monitor()?)
    else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let icon = anchor.position.to_physical::<f64>(scale);
    let size = anchor.size.to_physical::<f64>(scale);
    let area = monitor.work_area();
    let (left, top) = (f64::from(area.position.x), f64::from(area.position.y));
    let (width, height) = (WIDTH * scale, height * scale);
    let gap = 8.0 * scale;
    let x = (icon.x + size.width / 2.0 - width / 2.0)
        .max(left + gap)
        .min(left + f64::from(area.size.width) - width - gap);
    let above = icon.y - height - gap;
    let y = (if above >= top {
        above
    } else {
        icon.y + size.height + gap
    })
    .max(top + gap)
    .min(top + f64::from(area.size.height) - height - gap);
    card.set_size(PhysicalSize::new(
        width.round() as u32,
        height.round() as u32,
    ))?;
    card.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
}

fn guard(card: &WebviewWindow) -> Result<(), String> {
    if card.label() == CARD {
        Ok(())
    } else {
        Err("IPC_SENDER_REJECTED".to_owned())
    }
}

#[tauri::command]
pub fn tray_rows(window: WebviewWindow) -> Result<Value, String> {
    guard(&window)?;
    let snapshot = window
        .state::<QuotaHost>()
        .accounts
        .quota_state(true, now_ms())
        .map_err(|error| error.to_string())?;
    let accounts = snapshot["accounts"]
        .as_array()
        .map_or(&[][..], Vec::as_slice);
    let rows = window_rows(accounts);
    let mut duplicates: HashMap<&str, HashSet<&str>> = HashMap::new();
    for row in &rows {
        duplicates.entry(row.agent).or_default().insert(row.account);
    }
    let result: Vec<_> = rows.iter().take(6).map(|row| json!({
        "agent":row.agent,"agentName":row.agent_name,
        "alias":if duplicates.get(row.agent).is_some_and(|ids| ids.len()>1) {row.alias} else {None},
        "window":row.window,"remaining":row.remaining,"resetsAt":row.resets_at,"fresh":row.fresh
    })).collect();
    Ok(json!({"rows":result,"more":rows.len().saturating_sub(6)}))
}

#[tauri::command]
pub async fn tray_size(window: WebviewWindow, height: f64) -> Result<bool, String> {
    guard(&window)?;
    place(&window, height.ceil().clamp(120.0, 640.0)).map_err(|_| "TRAY_WINDOW_FAILED")?;
    Ok(true)
}

#[tauri::command]
pub async fn tray_open(window: WebviewWindow, command: Option<String>) -> Result<bool, String> {
    guard(&window)?;
    if command
        .as_deref()
        .is_some_and(|command| !matches!(command, "show-quota" | "show-connect"))
    {
        return Err("IPC_SENDER_REJECTED".to_owned());
    }
    let app = window.app_handle();
    close(app);
    crate::reader::schedule_open_command(app, command);
    Ok(true)
}

#[tauri::command]
pub async fn tray_dismiss(window: WebviewWindow) -> Result<bool, String> {
    guard(&window)?;
    close(window.app_handle());
    Ok(true)
}
