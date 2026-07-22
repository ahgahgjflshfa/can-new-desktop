use std::sync::atomic::Ordering;

use tauri::{Emitter, Manager};

mod api_client;
mod auth_commands;
mod camera_viewer_commands;
mod can_api_client;
mod can_commands;
mod charge_commands;
mod constants;
mod device_id;
mod ipc_types;
mod log_commands;
mod popup_commands;
mod runtime_log;
mod state;
mod task_commands;
mod window_controls;

use constants::POPUP_LABEL;
use ipc_types::PopupClosedPayload;
use state::{MinimizeToTrayState, PendingNotificationState};

pub use auth_commands::{auth_login, auth_logout};
pub use camera_viewer_commands::open_camera_viewer;
pub use can_commands::{can_complete_task, can_fetch_tasks, can_login};
pub use charge_commands::{charge_complete_task, charge_fetch_tasks, charge_login};
pub use device_id::get_or_create_device_id;
pub use log_commands::export_app_logs;
pub use popup_commands::{
    ack_popup_displayed, clear_alert_popup_system, emit_dismiss_notification,
    get_pending_notification, hide_alert_popup, show_alert_popup,
};
pub use task_commands::{complete_task, fetch_tasks, reply_task};
pub use window_controls::{set_minimize_to_tray_on_close, show_emergency_window};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MinimizeToTrayState::default())
        .manage(PendingNotificationState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == POPUP_LABEL {
                    api.prevent_close();

                    let state = window.state::<PendingNotificationState>();
                    let displayed = state
                        .displayed
                        .lock()
                        .ok()
                        .and_then(|mut displayed| displayed.take());
                    let mut notification_id = String::new();
                    let mut revision = 0;
                    if let Some((id, rev)) = displayed {
                        if let Ok(mut pending) = state.notification.lock() {
                            if pending
                                .as_ref()
                                .map(|n| n.id == id && n.revision == rev)
                                .unwrap_or(false)
                            {
                                *pending = None;
                                notification_id = id;
                                revision = rev;
                            }
                        }
                    }

                    let payload = PopupClosedPayload {
                        notification_id: if notification_id.is_empty() {
                            None
                        } else {
                            Some(notification_id)
                        },
                        revision,
                    };
                    if let Some(main_window) = window.app_handle().get_webview_window("main") {
                        let _ = main_window.emit("popup-closed", payload);
                    }

                    let _ = window.hide();
                    return;
                }

                let state = window.state::<MinimizeToTrayState>();
                if state.enabled.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                let _ = app.handle().plugin(tauri_plugin_autostart::init(
                    MacosLauncher::LaunchAgent,
                    None,
                ));
            }

            #[cfg(debug_assertions)]
            {
                let window = tauri::Manager::get_webview_window(app, "main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_prevent_default::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_or_create_device_id,
            auth_login,
            auth_logout,
            can_login,
            can_fetch_tasks,
            can_complete_task,
            charge_login,
            charge_fetch_tasks,
            charge_complete_task,
            open_camera_viewer,
            fetch_tasks,
            reply_task,
            complete_task,
            set_minimize_to_tray_on_close,
            show_emergency_window,
            show_alert_popup,
            hide_alert_popup,
            clear_alert_popup_system,
            ack_popup_displayed,
            emit_dismiss_notification,
            get_pending_notification,
            export_app_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
