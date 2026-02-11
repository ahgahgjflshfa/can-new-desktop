use std::fs;
use std::io::ErrorKind;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const POPUP_LABEL: &str = "alert-popup";
const POPUP_WIDTH: f64 = 420.0;
const POPUP_HEIGHT: f64 = 280.0;
const API_BASE_URL: &str = "https://www-u.tymetro.com.tw/station_services/api";
const DEVICE_ID_FILENAME: &str = "device-id";

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

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    status: String,
    message: Option<String>,
    data: Option<T>,
}

#[derive(Deserialize)]
struct LoginApiData {
    token: String,
    user: LoginApiUser,
}

#[derive(Deserialize)]
struct LoginApiUser {
    name: String,
    station_id: String,
    section_id: Option<String>,
    role: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthLoginRequest {
    account: String,
    password: String,
    device_type: String,
    device_id: String,
    fcm_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthUser {
    name: String,
    station_id: String,
    section_id: Option<String>,
    role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthLoginResponse {
    token: String,
    user: AuthUser,
}

#[derive(Serialize)]
struct AuthLoginRequestBody<'a> {
    account: &'a str,
    password: &'a str,
    device_type: &'a str,
    device_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    fcm_token: Option<&'a str>,
}

#[derive(Deserialize, Serialize)]
struct TaskApiItem {
    id: i64,
    station_id: String,
    station_name: String,
    location_name: String,
    location_code: String,
    status: String,
    created_at: Option<i64>,
    replied_at: Option<i64>,
    done_at: Option<i64>,
}

#[derive(Deserialize)]
struct TaskStatusItem {
    id: i64,
    status: String,
}

#[derive(Serialize)]
struct CompleteTaskRequestBody<'a> {
    result: &'a str,
}

fn build_api_url(path: &str) -> String {
    format!("{}{}", API_BASE_URL.trim_end_matches('/'), path)
}

fn build_api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn device_id_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let mut app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    app_data_dir.push(DEVICE_ID_FILENAME);
    Ok(app_data_dir)
}

#[tauri::command]
fn get_or_create_device_id(app: tauri::AppHandle) -> Result<String, String> {
    let file_path = device_id_file_path(&app)?;

    match fs::read_to_string(&file_path) {
        Ok(existing) => {
            let existing = existing.trim();
            if !existing.is_empty() {
                return Ok(existing.to_string());
            }
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => return Err(err.to_string()),
    }

    let generated = uuid::Uuid::new_v4().to_string();
    fs::write(file_path, generated.as_bytes()).map_err(|e| e.to_string())?;

    Ok(generated)
}

#[tauri::command]
async fn auth_login(payload: AuthLoginRequest) -> Result<AuthLoginResponse, String> {
    let client = build_api_client()?;
    let body = AuthLoginRequestBody {
        account: payload.account.as_str(),
        password: payload.password.as_str(),
        device_type: payload.device_type.as_str(),
        device_id: payload.device_id.as_str(),
        fcm_token: payload.fcm_token.as_deref(),
    };

    let response = client
        .post(build_api_url("/auth/login"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<LoginApiData>>()
        .await
        .map_err(|e| e.to_string())?;

    if !status_code.is_success() || envelope.status != "success" {
        return Err(envelope
            .message
            .unwrap_or_else(|| format!("Login failed with status {}", status_code)));
    }

    let data = envelope
        .data
        .ok_or_else(|| "Login response missing data".to_string())?;

    Ok(AuthLoginResponse {
        token: data.token,
        user: AuthUser {
            name: data.user.name,
            station_id: data.user.station_id,
            section_id: data.user.section_id,
            role: data.user.role,
        },
    })
}

#[tauri::command]
async fn auth_logout(token: String) -> Result<(), String> {
    let client = build_api_client()?;
    let response = client
        .post(build_api_url("/auth/logout"))
        .bearer_auth(token)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<serde_json::Value>>()
        .await
        .map_err(|e| e.to_string())?;

    if !status_code.is_success() || envelope.status != "success" {
        return Err(envelope
            .message
            .unwrap_or_else(|| format!("Logout failed with status {}", status_code)));
    }

    Ok(())
}

#[tauri::command]
async fn fetch_tasks(token: String) -> Result<Vec<TaskApiItem>, String> {
    let client = build_api_client()?;
    let response = client
        .get(build_api_url("/tasks"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<Vec<TaskApiItem>>>()
        .await
        .map_err(|e| e.to_string())?;

    if !status_code.is_success() || envelope.status != "success" {
        return Err(envelope
            .message
            .unwrap_or_else(|| format!("Fetch tasks failed with status {}", status_code)));
    }

    Ok(envelope.data.unwrap_or_default())
}

#[tauri::command]
async fn reply_task(token: String, task_id: i64) -> Result<String, String> {
    let client = build_api_client()?;
    let response = client
        .post(build_api_url(format!("/tasks/{}/reply", task_id).as_str()))
        .bearer_auth(token)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<Vec<TaskStatusItem>>>()
        .await
        .map_err(|e| e.to_string())?;

    if !status_code.is_success() || envelope.status != "success" {
        return Err(envelope
            .message
            .unwrap_or_else(|| format!("Reply task failed with status {}", status_code)));
    }

    let status = envelope
        .data
        .and_then(|items| items.into_iter().find(|item| item.id == task_id))
        .map(|item| item.status)
        .unwrap_or_else(|| "replied".to_string());

    Ok(status)
}

#[tauri::command]
async fn complete_task(token: String, task_id: i64, result: String) -> Result<String, String> {
    if result != "normal" && result != "no_passenger" {
        return Err("Invalid completion result".to_string());
    }

    let client = build_api_client()?;
    let response = client
        .post(build_api_url(
            format!("/tasks/{}/complete", task_id).as_str(),
        ))
        .bearer_auth(token)
        .json(&CompleteTaskRequestBody {
            result: result.as_str(),
        })
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<Vec<TaskStatusItem>>>()
        .await
        .map_err(|e| e.to_string())?;

    if !status_code.is_success() || envelope.status != "success" {
        return Err(envelope
            .message
            .unwrap_or_else(|| format!("Complete task failed with status {}", status_code)));
    }

    let status = envelope
        .data
        .and_then(|items| items.into_iter().find(|item| item.id == task_id))
        .map(|item| item.status)
        .unwrap_or_else(|| "completed".to_string());

    Ok(status)
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
            get_or_create_device_id,
            auth_login,
            auth_logout,
            fetch_tasks,
            reply_task,
            complete_task,
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
