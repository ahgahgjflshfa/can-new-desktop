use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::constants::{CAMERA_VIEWER_HEIGHT, CAMERA_VIEWER_LABEL, CAMERA_VIEWER_WIDTH};
use crate::runtime_log;

const LOG_SOURCE: &str = "camera-viewer";

#[tauri::command]
pub async fn open_camera_viewer(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        runtime_log::warn(LOG_SOURCE, "open_camera_viewer called without a url");
        return Err("camera viewer url is required".to_string());
    }

    let parsed_url = trimmed
        .parse()
        .map_err(|e| format!("invalid camera viewer url: {}", e))?;

    if let Some(existing) = app.get_webview_window(CAMERA_VIEWER_LABEL) {
        runtime_log::info(LOG_SOURCE, "Reusing existing camera viewer window");
        existing.navigate(parsed_url).map_err(|e| e.to_string())?;
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    runtime_log::info(LOG_SOURCE, "Creating camera viewer window");

    WebviewWindowBuilder::new(&app, CAMERA_VIEWER_LABEL, WebviewUrl::External(parsed_url))
        .title("攝影機觀看頁面")
        .inner_size(CAMERA_VIEWER_WIDTH, CAMERA_VIEWER_HEIGHT)
        .resizable(true)
        .focused(true)
        .build()
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed building camera viewer window: {}", e).as_str(),
            );
            e.to_string()
        })?;

    Ok(())
}
