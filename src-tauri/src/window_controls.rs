use std::sync::atomic::Ordering;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::runtime_log;
use crate::state::MinimizeToTrayState;

const MAIN_WINDOW_LABEL: &str = "main";
const MAIN_TRAY_ID: &str = "main-tray";
const SHOW_MENU_ID: &str = "show";
const QUIT_MENU_ID: &str = "quit";
const LOG_SOURCE: &str = "window-controls";

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main_window(app) {
        runtime_log::info(LOG_SOURCE, "Showing and focusing main window");
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        runtime_log::warn(
            LOG_SOURCE,
            "Requested main window focus but main window was not available",
        );
    }
}

fn ensure_tray_icon<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.tray_by_id(MAIN_TRAY_ID).is_some() {
        runtime_log::info(LOG_SOURCE, "Tray icon already exists; skipping rebuild");
        return Ok(());
    }

    let show = MenuItem::with_id(app, SHOW_MENU_ID, "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ID, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            SHOW_MENU_ID => focus_main_window(app),
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let _tray = builder.build(app)?;
    runtime_log::info(LOG_SOURCE, "Created main tray icon");
    Ok(())
}

fn remove_tray_icon<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.remove_tray_by_id(MAIN_TRAY_ID);
    runtime_log::info(LOG_SOURCE, "Removed main tray icon");
}

#[tauri::command]
pub fn set_minimize_to_tray_on_close(
    enabled: bool,
    state: tauri::State<MinimizeToTrayState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    runtime_log::info(
        LOG_SOURCE,
        format!("Setting minimize-to-tray on close to {}", enabled).as_str(),
    );
    if enabled {
        ensure_tray_icon(&app).map_err(|e| e.to_string())?;
    } else {
        remove_tray_icon(&app);
    }

    state.enabled.store(enabled, Ordering::Relaxed);

    Ok(())
}

#[tauri::command]
pub async fn show_emergency_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = main_window(&app) {
        runtime_log::info(LOG_SOURCE, "Showing emergency window");
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        runtime_log::warn(
            LOG_SOURCE,
            "show_emergency_window called but main window was not available",
        );
    }
    crate::popup_commands::hide_alert_popup(app).await.map_err(|e| e.to_string())?;
    Ok(())
}
