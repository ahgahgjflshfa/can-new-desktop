use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::constants::{POPUP_HEIGHT, POPUP_LABEL, POPUP_WIDTH};
use crate::ipc_types::{
    DismissPayload, NotificationPayload, PopupClearedPayload, PopupNotificationBatch,
};
use crate::runtime_log;
use crate::state::PendingNotificationState;

const LOG_SOURCE: &str = "popup";

fn same_popup_batch(batch: &PopupNotificationBatch, revision: u64) -> bool {
    batch.revision == revision
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
    mut notifications: Vec<NotificationPayload>,
    revision: &mut u64,
) -> Result<PopupNotificationBatch, String> {
    *revision = revision.saturating_add(1);
    if *revision == 0 {
        return Err("popup revision overflowed".to_string());
    }
    for notification in &mut notifications {
        notification.revision = *revision;
    }
    Ok(PopupNotificationBatch {
        notifications,
        revision: *revision,
    })
}

#[tauri::command]
pub async fn show_alert_popup(
    app: tauri::AppHandle,
    notifications: Vec<NotificationPayload>,
    state: tauri::State<'_, PendingNotificationState>,
) -> Result<PopupNotificationBatch, String> {
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "show_alert_popup called with {} notifications",
            notifications.len()
        )
        .as_str(),
    );
    let revised_batch;
    {
        let mut pending = state.notification.lock().map_err(|e| e.to_string())?;
        let mut revision = state.revision.lock().map_err(|e| e.to_string())?;
        revised_batch = revise_notification(notifications, &mut revision)?;
        *pending = Some(revised_batch.clone());
        // The popup may be closed before its frontend acknowledgement arrives.
        // Track the batch currently represented by the native window so that
        // close cannot report the previous acknowledged revision in that gap.
        state.mark_popup_revision(revised_batch.revision)?;
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
        .emit("show-notification", &revised_batch)
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed emitting popup notification event: {}", e).as_str(),
            );
            e.to_string()
        })?;

    runtime_log::info(LOG_SOURCE, "Popup notification event emitted successfully");

    Ok(revised_batch)
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
    let identity_matches = pending
        .as_ref()
        .map(|item| {
            item.notifications
                .iter()
                .any(|n| matches_lma_clear(n, &expected_principal, expected_revision))
        })
        .unwrap_or(false);
    if system == "lma" && identity_matches && revision == expected_revision {
        if let Some(batch) = pending.as_mut() {
            batch.notifications.retain(|notification| {
                notification
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get("system"))
                    .and_then(|value| value.as_str())
                    != Some("lma")
            });
            if batch.notifications.is_empty() {
                *pending = None;
            }
        }
        if let Some(popup) = app.get_webview_window(POPUP_LABEL) {
            let _ = popup.emit("popup-cleared", PopupClearedPayload { system, revision });
            if pending.is_none() {
                let _ = popup.hide();
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn ack_popup_displayed(
    state: tauri::State<'_, PendingNotificationState>,
    revision: u64,
) -> Result<(), String> {
    let pending = state.notification.lock().map_err(|e| e.to_string())?;
    if pending
        .as_ref()
        .map(|item| same_popup_batch(item, revision))
        .unwrap_or(false)
    {
        *state.displayed.lock().map_err(|e| e.to_string())? = Some(revision);
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
        let first = revise_notification(vec![original.clone()], &mut revision).unwrap();
        let second = revise_notification(vec![original], &mut revision).unwrap();
        let pending = first.clone();
        let emitted = first.clone();
        let returned = first;
        assert_eq!(pending.notifications[0].id, emitted.notifications[0].id);
        assert_eq!(pending.revision, emitted.revision);
        assert_eq!(pending.notifications[0].id, returned.notifications[0].id);
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
        let batch = PopupNotificationBatch {
            notifications: vec![b],
            revision: 2,
        };
        assert!(!same_popup_batch(&batch, 1));
        assert!(same_popup_batch(&batch, 2));
    }

    #[test]
    fn acknowledgement_is_for_the_whole_batch_revision() {
        let batch = PopupNotificationBatch {
            notifications: vec![notification("a", 7, "p"), notification("b", 7, "p")],
            revision: 7,
        };
        assert!(same_popup_batch(&batch, 7));
        assert!(!same_popup_batch(&batch, 6));
    }

    #[test]
    fn close_uses_new_pending_revision_before_frontend_ack() {
        let first = PopupNotificationBatch {
            notifications: vec![notification("a", 1, "p")],
            revision: 1,
        };
        let second = PopupNotificationBatch {
            notifications: vec![notification("b", 2, "p"), notification("c", 2, "p")],
            revision: 2,
        };
        let state = PendingNotificationState {
            notification: std::sync::Mutex::new(Some(first)),
            revision: std::sync::Mutex::new(2),
            displayed: std::sync::Mutex::new(Some(1)),
        };
        // Revision 1 was acknowledged, then revision 2 replaced it. The
        // replacement happens before its frontend ack in the race window.
        *state.notification.lock().unwrap() = Some(second.clone());
        state.mark_popup_revision(second.revision).unwrap();

        let close_revision = state.take_popup_revision().unwrap();
        assert_eq!(close_revision, Some(2));
        assert_eq!(
            state
                .notification
                .lock()
                .unwrap()
                .as_ref()
                .map(|b| b.revision),
            Some(2)
        );
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
            if let Some(batch) = pending.as_mut() {
                batch.notifications.retain(|n| n.id != *id);
                if batch.notifications.is_empty() {
                    *pending = None;
                }
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
) -> Result<Option<PopupNotificationBatch>, String> {
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
