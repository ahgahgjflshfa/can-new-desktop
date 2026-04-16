use serde::{Deserialize, Serialize};

use crate::api_client::{build_api_client, build_api_url, ApiEnvelope};
use crate::runtime_log;

const LOG_SOURCE: &str = "tasks";

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
    runtime_log::info(LOG_SOURCE, "Fetching tasks from backend API");
    let client = build_api_client()?;
    let response = client
        .get(build_api_url("/tasks"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Fetch tasks HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<Vec<TaskApiItem>>>()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed decoding fetch tasks response: {}", e).as_str(),
            );
            e.to_string()
        })?;

    if !status_code.is_success() || envelope.status != "success" {
        let message = envelope
            .message
            .unwrap_or_else(|| format!("Fetch tasks failed with status {}", status_code));
        runtime_log::warn(
            LOG_SOURCE,
            format!(
                "Fetch tasks rejected with status {}: {}",
                status_code, message
            )
            .as_str(),
        );
        return Err(message);
    }

    let items = envelope.data.unwrap_or_default();
    runtime_log::info(
        LOG_SOURCE,
        format!("Fetched {} tasks successfully", items.len()).as_str(),
    );
    Ok(items)
}

#[tauri::command]
pub async fn reply_task(token: String, task_id: i64) -> Result<String, String> {
    runtime_log::info(LOG_SOURCE, format!("Replying to task {}", task_id).as_str());
    let client = build_api_client()?;
    let response = client
        .post(build_api_url(format!("/tasks/{}/reply", task_id).as_str()))
        .bearer_auth(token)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Reply task HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<Vec<TaskStatusItem>>>()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed decoding reply task response: {}", e).as_str(),
            );
            e.to_string()
        })?;

    if !status_code.is_success() || envelope.status != "success" {
        let message = envelope
            .message
            .unwrap_or_else(|| format!("Reply task failed with status {}", status_code));
        runtime_log::warn(
            LOG_SOURCE,
            format!(
                "Reply task {} rejected with status {}: {}",
                task_id, status_code, message
            )
            .as_str(),
        );
        return Err(message);
    }

    let status = envelope
        .data
        .and_then(|items| items.into_iter().find(|item| item.id == task_id))
        .map(|item| item.status)
        .unwrap_or_else(|| "replied".to_string());

    runtime_log::info(
        LOG_SOURCE,
        format!("Reply task {} succeeded with status '{}'", task_id, status).as_str(),
    );

    Ok(status)
}

#[tauri::command]
pub async fn complete_task(token: String, task_id: i64, result: String) -> Result<String, String> {
    if result != "normal" && result != "no_passenger" {
        runtime_log::warn(
            LOG_SOURCE,
            format!(
                "Rejected invalid completion result '{}' for task {}",
                result, task_id
            )
            .as_str(),
        );
        return Err("Invalid completion result".to_string());
    }

    runtime_log::info(
        LOG_SOURCE,
        format!("Completing task {} with result '{}'", task_id, result).as_str(),
    );

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
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Complete task HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<Vec<TaskStatusItem>>>()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed decoding complete task response: {}", e).as_str(),
            );
            e.to_string()
        })?;

    if !status_code.is_success() || envelope.status != "success" {
        let message = envelope
            .message
            .unwrap_or_else(|| format!("Complete task failed with status {}", status_code));
        runtime_log::warn(
            LOG_SOURCE,
            format!(
                "Complete task {} rejected with status {}: {}",
                task_id, status_code, message
            )
            .as_str(),
        );
        return Err(message);
    }

    let status = envelope
        .data
        .and_then(|items| items.into_iter().find(|item| item.id == task_id))
        .map(|item| item.status)
        .unwrap_or_else(|| "completed".to_string());

    runtime_log::info(
        LOG_SOURCE,
        format!(
            "Complete task {} succeeded with status '{}'",
            task_id, status
        )
        .as_str(),
    );

    Ok(status)
}
