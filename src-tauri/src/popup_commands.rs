use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::constants::{POPUP_HEIGHT, POPUP_LABEL, POPUP_WIDTH};
use crate::ipc_types::{DismissPayload, NotificationPayload};
use crate::runtime_log;
use crate::state::PendingNotificationState;

const LOG_SOURCE: &str = "popup";

#[tauri::command]
pub async fn show_alert_popup(
    app: tauri::AppHandle,
    notification: NotificationPayload,
    state: tauri::State<'_, PendingNotificationState>,
) -> Result<(), String> {
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "show_alert_popup called with notification id {}",
            notification.id
        )
        .as_str(),
    );
    {
        let mut pending = state.notification.lock().map_err(|e| e.to_string())?;
        *pending = Some(notification.clone());
        runtime_log::info(
            LOG_SOURCE,
            "Stored notification in PendingNotificationState",
        );
    }

    let window = if let Some(existing) = app.get_webview_window(POPUP_LABEL) {
        runtime_log::info(LOG_SOURCE, "Reusing existing popup window");
        existing
    } else {
        let url = if cfg!(debug_assertions) {
            WebviewUrl::External("http://localhost:1420/popup.html".parse().unwrap())
        } else {
            WebviewUrl::App("popup.html".into())
        };

        runtime_log::info(LOG_SOURCE, "Creating popup window");

        WebviewWindowBuilder::new(&app, POPUP_LABEL, url)
            .title("Emergency Alert")
            .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
            .resizable(false)
            .decorations(true)
            .always_on_top(true)
            .center()
            .focused(true)
            .skip_taskbar(false)
            .build()
            .map_err(|e| {
                runtime_log::error(
                    LOG_SOURCE,
                    format!("Failed building popup window: {}", e).as_str(),
                );
                e.to_string()
            })?
    };

    window.show().map_err(|e| {
        runtime_log::error(
            LOG_SOURCE,
            format!("Failed showing popup window: {}", e).as_str(),
        );
        e.to_string()
    })?;
    window.set_focus().map_err(|e| {
        runtime_log::error(
            LOG_SOURCE,
            format!("Failed focusing popup window: {}", e).as_str(),
        );
        e.to_string()
    })?;
    window.set_always_on_top(true).map_err(|e| {
        runtime_log::error(
            LOG_SOURCE,
            format!("Failed setting popup window always-on-top: {}", e).as_str(),
        );
        e.to_string()
    })?;

    window
        .emit("show-notification", notification)
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed emitting popup notification event: {}", e).as_str(),
            );
            e.to_string()
        })?;

    runtime_log::info(LOG_SOURCE, "Popup notification event emitted successfully");

    Ok(())
}

#[tauri::command]
pub async fn hide_alert_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        runtime_log::info(LOG_SOURCE, "Hiding popup window");
        window.hide().map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed hiding popup window: {}", e).as_str(),
            );
            e.to_string()
        })?;
    } else {
        runtime_log::warn(
            LOG_SOURCE,
            "hide_alert_popup called but popup window does not exist",
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn emit_dismiss_notification(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingNotificationState>,
    notification_id: Option<String>,
    dismiss_all: bool,
) -> Result<(), String> {
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "Emitting dismiss notification event (dismiss_all={}, notification_id={:?})",
            dismiss_all, notification_id
        )
        .as_str(),
    );

    {
        let mut pending = state.notification.lock().map_err(|e| e.to_string())?;
        if dismiss_all {
            *pending = None;
        } else if let Some(ref id) = notification_id {
            if pending.as_ref().map(|n| n.id == *id).unwrap_or(false) {
                *pending = None;
            }
        }
    }

    let payload = DismissPayload {
        notification_id,
        dismiss_all,
    };

    if let Some(main_window) = app.get_webview_window("main") {
        main_window
            .emit("dismiss-notification", payload)
            .map_err(|e| {
                runtime_log::error(
                    LOG_SOURCE,
                    format!("Failed emitting dismiss-notification event: {}", e).as_str(),
                );
                e.to_string()
            })?;
    } else {
        runtime_log::warn(
            LOG_SOURCE,
            "Dismiss notification requested but main window was not available",
        );
    }

    Ok(())
}

#[tauri::command]
pub fn get_pending_notification(
    state: tauri::State<'_, PendingNotificationState>,
) -> Result<Option<NotificationPayload>, String> {
    let pending = state.notification.lock().map_err(|e| e.to_string())?;
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "get_pending_notification called, returning_present={}",
            pending.is_some()
        )
        .as_str(),
    );
    Ok(pending.clone())
}
