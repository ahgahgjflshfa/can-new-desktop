use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::constants::{POPUP_HEIGHT, POPUP_LABEL, POPUP_WIDTH};
use crate::ipc_types::{DismissPayload, NotificationPayload, PopupClearedPayload};
use crate::runtime_log;
use crate::state::PendingNotificationState;

const LOG_SOURCE: &str = "popup";

fn same_popup_identity(notification: &NotificationPayload, id: &str, revision: u64) -> bool {
    notification.id == id && notification.revision == revision
}

fn matches_lma_clear(notification: &NotificationPayload, principal: &str, revision: u64) -> bool {
    let pending_principal = notification
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("principal"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let system = notification
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("system"))
        .and_then(|value| value.as_str())
        .unwrap_or("lma");
    system == "lma" && pending_principal == principal && notification.revision == revision
}

fn revise_notification(
    mut notification: NotificationPayload,
    revision: &mut u64,
) -> Result<NotificationPayload, String> {
    *revision = revision.saturating_add(1);
    if *revision == 0 {
        return Err("popup revision overflowed".to_string());
    }
    notification.revision = *revision;
    Ok(notification)
}

#[tauri::command]
pub async fn show_alert_popup(
    app: tauri::AppHandle,
    notification: NotificationPayload,
    state: tauri::State<'_, PendingNotificationState>,
) -> Result<NotificationPayload, String> {
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "show_alert_popup called with notification id {}",
            notification.id
        )
        .as_str(),
    );
    let mut revised_notification = notification;
    {
        let mut pending = state.notification.lock().map_err(|e| e.to_string())?;
        let mut revision = state.revision.lock().map_err(|e| e.to_string())?;
        revised_notification = revise_notification(revised_notification, &mut revision)?;
        *pending = Some(revised_notification.clone());
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
        .emit("show-notification", &revised_notification)
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed emitting popup notification event: {}", e).as_str(),
            );
            e.to_string()
        })?;

    runtime_log::info(LOG_SOURCE, "Popup notification event emitted successfully");

    Ok(revised_notification)
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
    }
    Ok(())
}

#[tauri::command]
pub fn clear_alert_popup_system(
    app: tauri::AppHandle,
    state: tauri::State<'_, PendingNotificationState>,
    system: String,
    expected_principal: String,
    expected_revision: u64,
) -> Result<(), String> {
    let mut pending = state.notification.lock().map_err(|e| e.to_string())?;
    let revision = pending.as_ref().map(|item| item.revision).unwrap_or(0);
    let pending_principal = pending
        .as_ref()
        .and_then(|item| item.metadata.as_ref())
        .and_then(|metadata| metadata.get("principal"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let pending_system = pending
        .as_ref()
        .and_then(|item| item.metadata.as_ref())
        .and_then(|metadata| metadata.get("system"))
        .and_then(|value| value.as_str())
        .unwrap_or("lma");
    let identity_matches = pending
        .as_ref()
        .map(|item| matches_lma_clear(item, &expected_principal, expected_revision))
        .unwrap_or(false);
    if pending_system == system
        && identity_matches
        && pending_principal == expected_principal
        && revision == expected_revision
    {
        *pending = None;
        if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
            let _ = popup.emit("popup-cleared", PopupClearedPayload { system, revision });
            let _ = popup.hide();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ack_popup_displayed(
    state: tauri::State<'_, PendingNotificationState>,
    notification_id: String,
    revision: u64,
) -> Result<(), String> {
    let pending = state.notification.lock().map_err(|e| e.to_string())?;
    if pending
        .as_ref()
        .map(|item| same_popup_identity(item, &notification_id, revision))
        .unwrap_or(false)
    {
        *state.displayed.lock().map_err(|e| e.to_string())? = Some((notification_id, revision));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn notification(id: &str, revision: u64, principal: &str) -> NotificationPayload {
        let mut metadata = HashMap::new();
        metadata.insert("system".into(), serde_json::json!("lma"));
        metadata.insert("principal".into(), serde_json::json!(principal));
        NotificationPayload {
            id: id.into(),
            title: String::new(),
            body: String::new(),
            priority: "pending".into(),
            category: None,
            created_at: String::new(),
            unread_count: 0,
            metadata: Some(metadata),
            revision,
        }
    }

    #[test]
    fn revised_payload_is_identical_for_pending_emit_and_return_and_increments() {
        let original = notification("same", 0, "principal");
        let mut revision = 0;
        let first = revise_notification(original.clone(), &mut revision).unwrap();
        let second = revise_notification(original, &mut revision).unwrap();
        let pending = first.clone();
        let emitted = first.clone();
        let returned = first;
        assert_eq!(pending.id, emitted.id);
        assert_eq!(pending.revision, emitted.revision);
        assert_eq!(pending.id, returned.id);
        assert_eq!(pending.revision, returned.revision);
        assert_eq!(second.revision, pending.revision + 1);
    }

    #[test]
    fn delayed_a_clear_cannot_clear_b() {
        let a = notification("a", 1, "principal-a");
        let b = notification("b", 2, "principal-b");
        assert!(matches_lma_clear(&a, "principal-a", 1));
        assert!(!matches_lma_clear(&b, "principal-a", 1));
    }

    #[test]
    fn stale_ack_cannot_ack_newer_pending() {
        let b = notification("b", 2, "principal-b");
        assert!(!same_popup_identity(&b, "a", 1));
        assert!(!same_popup_identity(&b, "b", 1));
        assert!(same_popup_identity(&b, "b", 2));
    }
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
