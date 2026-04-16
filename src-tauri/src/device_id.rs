use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use tauri::Manager;

use crate::runtime_log;

const DEVICE_ID_FILENAME: &str = "device-id";
const LOG_SOURCE: &str = "device-id";

fn device_id_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    app_data_dir.push(DEVICE_ID_FILENAME);
    Ok(app_data_dir)
}

#[tauri::command]
pub fn get_or_create_device_id(app: tauri::AppHandle) -> Result<String, String> {
    let file_path = device_id_file_path(&app)?;
    runtime_log::info(
        LOG_SOURCE,
        format!("Resolving device id at {}", file_path.display()).as_str(),
    );

    match fs::read_to_string(&file_path) {
        Ok(existing) => {
            let existing = existing.trim();
            if !existing.is_empty() {
                runtime_log::info(LOG_SOURCE, "Loaded existing device id from disk");
                return Ok(existing.to_string());
            }
            runtime_log::warn(
                LOG_SOURCE,
                "Device id file existed but was empty; generating a new one",
            );
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed reading device id file: {}", err).as_str(),
            );
            return Err(err.to_string());
        }
    }

    let generated = uuid::Uuid::new_v4().to_string();
    fs::write(file_path, generated.as_bytes()).map_err(|e| {
        runtime_log::error(
            LOG_SOURCE,
            format!("Failed writing device id file: {}", e).as_str(),
        );
        e.to_string()
    })?;

    runtime_log::info(LOG_SOURCE, "Generated and persisted new device id");

    Ok(generated)
}
