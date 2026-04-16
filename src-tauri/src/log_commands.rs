use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::Manager;

#[tauri::command]
pub fn export_app_logs(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    let mut output_dir = match app.path().download_dir() {
        Ok(path) => path,
        Err(_) => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };

    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let unix_timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    output_dir.push(format!("can-new-desktop-logs-{}.log", unix_timestamp));

    write_log_file(&output_dir, contents)?;

    Ok(output_dir.to_string_lossy().into_owned())
}

fn write_log_file(path: &PathBuf, contents: String) -> Result<(), String> {
    fs::write(path, contents.as_bytes()).map_err(|e| e.to_string())
}
