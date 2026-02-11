use serde::{Deserialize, Serialize};

use crate::api_client::{build_api_client, build_api_url, ApiEnvelope};

#[derive(Deserialize, Serialize)]
pub struct TaskApiItem {
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

#[tauri::command]
pub async fn fetch_tasks(token: String) -> Result<Vec<TaskApiItem>, String> {
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
pub async fn reply_task(token: String, task_id: i64) -> Result<String, String> {
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
pub async fn complete_task(token: String, task_id: i64, result: String) -> Result<String, String> {
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
