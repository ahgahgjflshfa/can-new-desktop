use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use tauri::Manager;

const DEVICE_ID_FILENAME: &str = "device-id";

fn device_id_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;
    app_data_dir.push(DEVICE_ID_FILENAME);
    Ok(app_data_dir)
}

#[tauri::command]
pub fn get_or_create_device_id(app: tauri::AppHandle) -> Result<String, String> {
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
