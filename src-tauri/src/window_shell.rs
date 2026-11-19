use serde::{Deserialize, Serialize};
#[cfg(windows)]
use tauri::Manager;
use tauri::{
    menu::{MenuBuilder, MenuEvent, MenuItem},
    Emitter, Theme, WebviewWindow, Window,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub focused: bool,
    pub maximized: bool,
}

#[tauri::command]
pub fn desktop_state(window: WebviewWindow) -> Result<WindowState, String> {
    Ok(WindowState {
        focused: window.is_focused().map_err(rejected)?,
        maximized: window.is_maximized().map_err(rejected)?,
    })
}

pub fn publish_state(window: &Window) {
    if let (Ok(focused), Ok(maximized)) = (window.is_focused(), window.is_maximized()) {
        let _ = window.emit("window:state", WindowState { focused, maximized });
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptionAction {
    Minimize,
    ToggleMaximize,
    Close,
    Drag,
}

#[tauri::command]
pub async fn desktop_caption(window: WebviewWindow, action: CaptionAction) -> Result<(), String> {
    match action {
        CaptionAction::Minimize => window.minimize(),
        CaptionAction::ToggleMaximize => {
            if window.is_maximized().map_err(rejected)? {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }
        CaptionAction::Close => window.close(),
        CaptionAction::Drag => window.start_dragging(),
    }
    .map_err(rejected)
}

#[tauri::command]
pub fn desktop_theme(window: WebviewWindow, value: String) -> Result<bool, String> {
    let theme = match value.as_str() {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => return Err("WINDOW_ACTION_REJECTED".to_owned()),
    };
    window.set_theme(Some(theme)).map_err(rejected)?;
    Ok(true)
}

const STATISTICS: &[(&str, &str, Option<&str>)] = &[
    ("refresh", "刷新当前页面", Some("Ctrl+R")),
    ("export", "导出统计…", Some("Ctrl+E")),
];
const APPEARANCE: &[(&str, &str, Option<&str>)] = &[
    ("sidebar", "显示 / 隐藏侧栏", Some("Ctrl+B")),
    ("summary", "显示 / 隐藏概要", Some("Ctrl+Shift+B")),
    ("theme", "切换深浅外观", None),
    ("settings", "设置", Some("Ctrl+,")),
];

fn rejected(_: tauri::Error) -> String {
    "WINDOW_ACTION_REJECTED".to_owned()
}

#[tauri::command]
pub async fn desktop_menu(window: WebviewWindow, name: String) -> Result<bool, String> {
    let groups = match name.as_str() {
        "app" => &[STATISTICS, APPEARANCE][..],
        "statistics" => &[STATISTICS][..],
        "appearance" => &[APPEARANCE][..],
        _ => return Err("WINDOW_ACTION_REJECTED".to_owned()),
    };
    let mut menu = MenuBuilder::new(&window);
    #[cfg(windows)]
    if name == "app" {
        menu = menu.item(
            &MenuItem::with_id(
                &window,
                "shell-import-legacy",
                "导入旧版账户…",
                true,
                None::<&str>,
            )
            .map_err(rejected)?,
        );
        menu = menu.separator();
    }
    for (index, group) in groups.iter().enumerate() {
        if index > 0 {
            menu = menu.separator();
        }
        for &(id, title, accelerator) in *group {
            let item = MenuItem::with_id(&window, format!("shell-{id}"), title, true, accelerator)
                .map_err(rejected)?;
            menu = menu.item(&item);
        }
    }
    window
        .popup_menu(&menu.build().map_err(rejected)?)
        .map_err(rejected)?;
    Ok(true)
}

pub fn menu_event(window: &Window, event: MenuEvent) {
    #[cfg(windows)]
    if event.id().as_ref() == "shell-import-legacy" {
        crate::quota_host::select_legacy(window.app_handle());
        return;
    }
    if let Some(command) = event.id().as_ref().strip_prefix("shell-") {
        let _ = window.emit("window:command", command);
    }
}
