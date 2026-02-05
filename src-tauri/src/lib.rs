use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const POPUP_LABEL: &str = "alert-popup";
const POPUP_WIDTH: f64 = 420.0;
const POPUP_HEIGHT: f64 = 280.0;

#[derive(Default)]
struct MinimizeToTrayState {
    enabled: AtomicBool,
}

/// Stores the current notification for popup to retrieve when ready
#[derive(Default)]
struct PendingNotificationState {
    notification: Mutex<Option<NotificationPayload>>,
}

#[derive(Clone, Serialize, Deserialize)]
struct NotificationPayload {
    id: String,
    title: String,
    body: String,
    priority: String,
    category: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "unreadCount")]
    unread_count: u32,
}

#[derive(Clone, Serialize, Deserialize)]
struct DismissPayload {
    #[serde(rename = "notificationId")]
    notification_id: Option<String>,
    #[serde(rename = "dismissAll")]
    dismiss_all: bool,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn set_minimize_to_tray_on_close(enabled: bool, state: tauri::State<MinimizeToTrayState>) {
    state.enabled.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn greet(name: &str) -> String {
    println!("Backend was called with an argument: {}", name);
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn show_alert_popup(
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

/// Hide the popup window
#[tauri::command]
async fn hide_alert_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Focus the popup window (for refocus interval) - shows it again if hidden
#[tauri::command]
async fn focus_alert_popup(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(POPUP_LABEL) {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Called from popup window to dismiss notification - emits event to main window
#[tauri::command]
async fn emit_dismiss_notification(
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
fn get_pending_notification(
    state: tauri::State<'_, PendingNotificationState>,
) -> Result<Option<NotificationPayload>, String> {
    let pending = state.notification.lock().map_err(|e| e.to_string())?;
    println!(
        "[Rust] get_pending_notification called, returning: {:?}",
        pending.is_some()
    );
    Ok(pending.clone())
}

#[tauri::command]
async fn show_emergency_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn hide_emergency_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MinimizeToTrayState::default())
        .manage(PendingNotificationState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == POPUP_LABEL {
                    api.prevent_close();
                    let _ = window.hide();

                    if let Some(main_window) = window.app_handle().get_webview_window("main") {
                        let payload = DismissPayload {
                            notification_id: None,
                            dismiss_all: false,
                        };
                        let _ = main_window.emit("popup-closed", payload);
                    }
                    return;
                }

                let state = window.state::<MinimizeToTrayState>();
                if state.enabled.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|_app| {
            // Tray icon (note: on some Linux desktops, a tray icon might not be shown unless a menu exists).
            let show = MenuItem::with_id(_app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(_app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(_app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(_app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(_app)?;

            #[cfg(debug_assertions)] // only include this code on debug builds
            {
                let window = tauri::Manager::get_webview_window(_app, "main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_prevent_default::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            set_minimize_to_tray_on_close,
            show_emergency_window,
            hide_emergency_window,
            show_alert_popup,
            hide_alert_popup,
            focus_alert_popup,
            emit_dismiss_notification,
            get_pending_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
