use std::sync::atomic::Ordering;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::state::MinimizeToTrayState;

const MAIN_TRAY_ID: &str = "main-tray";

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn ensure_tray_icon<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.tray_by_id(MAIN_TRAY_ID).is_some() {
        return Ok(());
    }

    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => focus_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(&tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let _tray = builder.build(app)?;
    Ok(())
}

fn remove_tray_icon<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.remove_tray_by_id(MAIN_TRAY_ID);
}

#[tauri::command]
pub fn set_minimize_to_tray_on_close(
    enabled: bool,
    state: tauri::State<MinimizeToTrayState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if enabled {
        ensure_tray_icon(&app).map_err(|e| e.to_string())?;
        state.enabled.store(true, Ordering::Relaxed);
    } else {
        remove_tray_icon(&app);
        state.enabled.store(false, Ordering::Relaxed);
    }

    Ok(())
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    println!("Backend was called with an argument: {}", name);
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub async fn show_emergency_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_emergency_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
    }
    Ok(())
}
