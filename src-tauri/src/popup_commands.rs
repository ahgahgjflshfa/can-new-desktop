use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::constants::{POPUP_HEIGHT, POPUP_LABEL, POPUP_WIDTH};
use crate::ipc_types::{DismissPayload, NotificationPayload};
use crate::state::PendingNotificationState;

#[tauri::command]
pub async fn show_alert_popup(
    app: tauri::AppHandle,
    notification: NotificationPayload,
    state: tauri::State<'_, PendingNotificationState>,
) -> Result<(), String> {
    println!(
        "[Rust] show_alert_popup called with notification id: {}",
        notification.id
    );
    {
        let mut pending = state.notification.lock().map_err(|e| e.to_string())?;
        *pending = Some(notification.clone());
        println!("[Rust] Stored notification in PendingNotificationState");
    }

    let window = if let Some(existing) = app.get_webview_window(POPUP_LABEL) {
        existing
    } else {
        let url = if cfg!(debug_assertions) {
            WebviewUrl::External("http://localhost:1420/popup.html".parse().unwrap())
        } else {
            WebviewUrl::App("popup.html".into())
        };

        WebviewWindowBuilder::new(&app, POPUP_LABEL, url)
            .title("Emergency Alert")
            .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .center()
            .focused(true)
            .skip_taskbar(false)
            .build()
            .map_err(|e| e.to_string())?
    };

    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    window.set_always_on_top(true).map_err(|e| e.to_string())?;

    window
        .emit("show-notification", notification)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn hide_alert_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn focus_alert_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn emit_dismiss_notification(
    app: tauri::AppHandle,
    notification_id: Option<String>,
    dismiss_all: bool,
) -> Result<(), String> {
    let payload = DismissPayload {
        notification_id,
        dismiss_all,
    };

    if let Some(main_window) = app.get_webview_window("main") {
        main_window
            .emit("dismiss-notification", payload)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_pending_notification(
    state: tauri::State<'_, PendingNotificationState>,
) -> Result<Option<NotificationPayload>, String> {
    let pending = state.notification.lock().map_err(|e| e.to_string())?;
    println!(
        "[Rust] get_pending_notification called, returning: {:?}",
        pending.is_some()
    );
    Ok(pending.clone())
}
