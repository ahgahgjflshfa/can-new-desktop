use serde::{Deserialize, Deserializer, Serialize};

use crate::can_api_client::{build_can_api_client, build_can_api_url, CanApiEnvelope};
use crate::runtime_log;

const LOG_SOURCE: &str = "can";

#[derive(Deserialize)]
pub struct CanLoginRequest {
    account: String,
    password: String,
}

#[derive(Deserialize)]
struct CanLoginApiData {
    access_token: String,
    account: String,
    station: Option<String>,
    #[serde(rename = "accessScope")]
    access_scope: String,
    region: Option<String>,
    topic: Option<String>,
    system: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanUser {
    account: String,
    name: String,
    station: Option<String>,
    access_scope: String,
    region: Option<String>,
    topic: Option<String>,
    system: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanLoginResponse {
    token: String,
    user: CanUser,
}

fn deserialize_bool_or_number<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    match serde_json::Value::deserialize(deserializer)? {
        serde_json::Value::Bool(value) => Ok(value),
        serde_json::Value::Number(value) => Ok(value.as_i64().unwrap_or(0) != 0),
        serde_json::Value::String(value) => Ok(matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "true" | "1" | "yes" | "y"
        )),
        _ => Err(serde::de::Error::custom("expected a boolean or 0/1")),
    }
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanTaskItem {
    pub serial_number: i64,
    pub station: String,
    pub trash_bin: String,
    #[serde(deserialize_with = "deserialize_bool_or_number")]
    pub is_done: bool,
    pub clean_at: Option<String>,
    pub inform_time: i64,
    pub resolution_type: i64,
    pub visitor_id: Option<String>,
    #[serde(deserialize_with = "deserialize_bool_or_number")]
    pub is_disable: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
struct CanLoginRequestBody<'a> {
    account: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CanCompleteTaskRequestBody {
    is_done: bool,
    resolution_type: Option<i64>,
}

#[tauri::command]
pub async fn can_login(payload: CanLoginRequest) -> Result<CanLoginResponse, String> {
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "Starting CAN login request for account '{}'",
            payload.account
        )
        .as_str(),
    );
    let client = build_can_api_client()?;
    let body = CanLoginRequestBody {
        account: payload.account.as_str(),
        password: payload.password.as_str(),
    };

    let response = client
        .post(build_can_api_url("/auth/login"))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("CAN login HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let body_text = response.text().await.map_err(|e| {
        runtime_log::error(
            LOG_SOURCE,
            format!("Failed to read CAN login response body: {}", e).as_str(),
        );
        e.to_string()
    })?;

    if !status_code.is_success() {
        runtime_log::warn(
            LOG_SOURCE,
            format!("CAN login failed with status {}", status_code).as_str(),
        );
        return Err(format!("CAN login failed with status {}", status_code));
    }

    let data: CanLoginApiData = match serde_json::from_str(&body_text) {
        Ok(direct) => direct,
        Err(_) => match serde_json::from_str::<CanApiEnvelope<CanLoginApiData>>(&body_text) {
            Ok(envelope) => match envelope.data {
                Some(d) => d,
                None => {
                    runtime_log::error(LOG_SOURCE, "CAN login response envelope missing data");
                    return Err("CAN login response envelope missing data".to_string());
                }
            },
            Err(_) => {
                runtime_log::error(LOG_SOURCE, "Failed to decode CAN login response");
                return Err("Failed to decode CAN login response".to_string());
            }
        },
    };

    if data.system != "can" && data.system != "admin" {
        return Err("此帳號不可使用 Q 潔淨立馬清".to_string());
    }
    if !matches!(data.access_scope.as_str(), "station" | "region" | "global") {
        return Err("CAN 登入回傳的權限範圍無效".to_string());
    }
    if let Some(region) = &data.region {
        if !matches!(region.as_str(), "north" | "central" | "south") {
            return Err("CAN 登入回傳的區段無效".to_string());
        }
    }

    runtime_log::info(
        LOG_SOURCE,
        format!("CAN login succeeded for account '{}'", data.account).as_str(),
    );

    Ok(CanLoginResponse {
        token: data.access_token,
        user: CanUser {
            name: data.account.clone(),
            account: data.account,
            station: data.station,
            access_scope: data.access_scope,
            region: data.region,
            topic: data.topic,
            system: data.system,
        },
    })
}

#[tauri::command]
pub async fn can_fetch_tasks(token: String) -> Result<Vec<CanTaskItem>, String> {
    runtime_log::info(LOG_SOURCE, "Fetching CAN tasks");
    let client = build_can_api_client()?;
    let response = client
        .get(build_can_api_url("/task"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Fetch CAN tasks HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let body_text = response.text().await.map_err(|e| {
        runtime_log::error(
            LOG_SOURCE,
            format!("Failed to read CAN tasks response body: {}", e).as_str(),
        );
        e.to_string()
    })?;

    runtime_log::info(
        LOG_SOURCE,
        format!("CAN tasks response body: {}", body_text).as_str(),
    );

    if !status_code.is_success() {
        return Err(format!(
            "Fetch CAN tasks failed with status {}: {}",
            status_code, body_text
        ));
    }

    let items: Vec<CanTaskItem> = if let Ok(tasks) =
        serde_json::from_str::<Vec<CanTaskItem>>(&body_text)
    {
        tasks
    } else {
        let envelope: CanApiEnvelope<Vec<CanTaskItem>> = match serde_json::from_str(&body_text) {
            Ok(v) => v,
            Err(e) => {
                runtime_log::error(
                    LOG_SOURCE,
                    format!(
                        "Failed decoding CAN tasks response body: {} | body: {}",
                        e, body_text
                    )
                    .as_str(),
                );
                return Err(format!(
                    "Failed decoding CAN tasks response body: {} | body: {}",
                    e, body_text
                ));
            }
        };
        if envelope.status != "success" {
            let message = envelope
                .message
                .unwrap_or_else(|| format!("Fetch CAN tasks failed with status {}", status_code));
            runtime_log::warn(
                LOG_SOURCE,
                format!("Fetch CAN tasks rejected: {}", message).as_str(),
            );
            return Err(message);
        }
        envelope.data.unwrap_or_default()
    };

    runtime_log::info(
        LOG_SOURCE,
        format!("Fetched {} CAN tasks successfully", items.len()).as_str(),
    );
    Ok(items)
}

#[tauri::command]
pub async fn can_complete_task(
    token: String,
    serial_number: i64,
    is_done: bool,
    resolution_type: Option<i64>,
) -> Result<(), String> {
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "Completing CAN task {} with is_done={} resolution_type={:?}",
            serial_number, is_done, resolution_type
        )
        .as_str(),
    );

    let client = build_can_api_client()?;
    let body = CanCompleteTaskRequestBody {
        is_done,
        resolution_type,
    };

    let response = client
        .patch(build_can_api_url(
            format!("/task/{}", serial_number).as_str(),
        ))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Complete CAN task HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let body_text = response.text().await.map_err(|e| {
        runtime_log::error(
            LOG_SOURCE,
            format!("Failed to read complete CAN task response body: {}", e).as_str(),
        );
        e.to_string()
    })?;

    runtime_log::info(
        LOG_SOURCE,
        format!("Complete CAN task response body: {}", body_text).as_str(),
    );

    // The CAN complete-task API may return either:
    //   1. A flat CanTaskItem (current observed behavior)
    //   2. A wrapped CanApiEnvelope<CanTaskItem>
    // Try envelope first (so we can detect non-success status), then flat.
    if let Ok(envelope) = serde_json::from_str::<CanApiEnvelope<CanTaskItem>>(&body_text) {
        if !status_code.is_success() || envelope.status != "success" {
            let message = envelope
                .message
                .unwrap_or_else(|| format!("Complete CAN task failed with status {}", status_code));
            runtime_log::warn(
                LOG_SOURCE,
                format!(
                    "Complete CAN task {} rejected with status {}: {}",
                    serial_number, status_code, message
                )
                .as_str(),
            );
            return Err(message);
        }
    } else if let Ok(_task) = serde_json::from_str::<CanTaskItem>(&body_text) {
        if !status_code.is_success() {
            runtime_log::warn(
                LOG_SOURCE,
                format!(
                    "Complete CAN task {} returned task object but HTTP {}",
                    serial_number, status_code
                )
                .as_str(),
            );
            return Err(format!(
                "Complete CAN task failed with status {}",
                status_code
            ));
        }
    } else if let Ok(envelope) =
        serde_json::from_str::<CanApiEnvelope<serde_json::Value>>(&body_text)
    {
        let message = envelope
            .message
            .unwrap_or_else(|| format!("Complete CAN task failed with status {}", status_code));
        runtime_log::warn(
            LOG_SOURCE,
            format!(
                "Complete CAN task {} rejected with status {}: {}",
                serial_number, status_code, message
            )
            .as_str(),
        );
        return Err(message);
    } else {
        runtime_log::error(
            LOG_SOURCE,
            format!(
                "Failed decoding complete CAN task response body | body: {}",
                body_text
            )
            .as_str(),
        );
        return Err(format!(
            "Failed decoding complete CAN task response body | body: {}",
            body_text
        ));
    }

    runtime_log::info(
        LOG_SOURCE,
        format!("Complete CAN task {} succeeded", serial_number).as_str(),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{CanCompleteTaskRequestBody, CanTaskItem};
    use serde_json::json;

    #[test]
    fn serializes_complete_task_body_with_backend_field_names() {
        let body = CanCompleteTaskRequestBody {
            is_done: true,
            resolution_type: Some(1),
        };

        let serialized = serde_json::to_value(body).expect("serialize CAN complete body");

        assert_eq!(
            serialized,
            json!({
                "isDone": true,
                "resolutionType": 1,
            })
        );
    }

    #[test]
    fn deserializes_numeric_can_task_flags() {
        let task: CanTaskItem = serde_json::from_value(json!({
            "serialNumber": 1,
            "station": "T01",
            "trashBin": "T01-BIN-01",
            "isDone": 0,
            "cleanAt": null,
            "informTime": 1,
            "resolutionType": 0,
            "visitorID": "seed-can-task",
            "isDisable": 1,
            "createdAt": "2026-08-08T08:00:55.000Z",
            "updatedAt": "2026-08-08T08:00:55.000Z"
        })).expect("deserialize CAN task with numeric flags");

        assert!(!task.is_done);
        assert!(task.is_disable);
    }
}
