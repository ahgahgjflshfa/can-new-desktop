use std::sync::atomic::Ordering;

use tauri::Manager;

use crate::state::MinimizeToTrayState;

#[tauri::command]
pub fn set_minimize_to_tray_on_close(enabled: bool, state: tauri::State<MinimizeToTrayState>) {
    state.enabled.store(enabled, Ordering::Relaxed);
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
