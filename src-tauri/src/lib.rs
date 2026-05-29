use std::sync::atomic::Ordering;

use tauri::{Emitter, Manager};

mod api_client;
mod auth_commands;
mod camera_viewer_commands;
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
use crate::ipc_types::DismissPayload;
use state::{MinimizeToTrayState, PendingNotificationState};

pub use auth_commands::{auth_login, auth_logout};
pub use camera_viewer_commands::open_camera_viewer;
pub use device_id::get_or_create_device_id;
pub use log_commands::export_app_logs;
pub use popup_commands::{
    emit_dismiss_notification, get_pending_notification, hide_alert_popup, show_alert_popup,
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
                    let _ = window.app_handle().emit("dismiss-notification", DismissPayload {
                        notification_id: None,
                        dismiss_all: true,
                    });
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
            #[cfg(debug_assertions)]
            {
                let window = tauri::Manager::get_webview_window(app, "main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_prevent_default::init())
        .invoke_handler(tauri::generate_handler![
            get_or_create_device_id,
            auth_login,
            auth_logout,
            open_camera_viewer,
            fetch_tasks,
            reply_task,
            complete_task,
            set_minimize_to_tray_on_close,
            show_emergency_window,
            show_alert_popup,
            hide_alert_popup,
            emit_dismiss_notification,
            get_pending_notification,
            export_app_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
