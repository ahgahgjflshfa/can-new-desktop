use serde::{Deserialize, Serialize};

use crate::can_api_client::{CanApiEnvelope, build_can_api_client, build_can_api_url};
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
    account: Option<String>,
    station: Option<String>,
    topic: Option<String>,
}

fn parse_jwt_sub(token: &str) -> Option<String> {
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = parts[1];
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    let json: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    json.get("sub")?.as_str().map(|s| s.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanUser {
    name: String,
    station: String,
    topic: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanLoginResponse {
    token: String,
    user: CanUser,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanTaskItem {
    pub serial_number: i64,
    pub station: String,
    pub trash_bin: String,
    pub is_done: bool,
    pub clean_at: Option<String>,
    pub inform_time: i64,
    pub resolution_type: i64,
    pub visitor_id: Option<String>,
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
        .post(build_can_api_url("/api/auth/login"))
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

    let station = data
        .station
        .or_else(|| parse_jwt_sub(&data.access_token))
        .unwrap_or_else(|| payload.account.clone());
    let topic = data.topic.unwrap_or_else(|| format!("can_{}", station));
    let account = data.account.unwrap_or_else(|| payload.account.clone());

    runtime_log::info(
        LOG_SOURCE,
        format!(
            "CAN login succeeded for account '{}' (station='{}', topic='{}')",
            account, station, topic
        )
        .as_str(),
    );

    Ok(CanLoginResponse {
        token: data.access_token,
        user: CanUser {
            name: account,
            station,
            topic,
        },
    })
}

#[tauri::command]
pub async fn can_fetch_tasks(
    token: String,
    station_code: String,
) -> Result<Vec<CanTaskItem>, String> {
    runtime_log::info(
        LOG_SOURCE,
        format!("Fetching CAN tasks for station '{}'", station_code).as_str(),
    );
    let client = build_can_api_client()?;
    let response = client
        .get(build_can_api_url(
            format!("/api/task/station/{}", station_code).as_str(),
        ))
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
            format!("/api/task/{}", serial_number).as_str(),
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

    let envelope: CanApiEnvelope<serde_json::Value> = match serde_json::from_str(&body_text) {
        Ok(v) => v,
        Err(e) => {
            runtime_log::error(
                LOG_SOURCE,
                format!(
                    "Failed decoding complete CAN task response body: {} | body: {}",
                    e, body_text
                )
                .as_str(),
            );
            return Err(format!(
                "Failed decoding complete CAN task response body: {} | body: {}",
                e, body_text
            ));
        }
    };

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

    runtime_log::info(
        LOG_SOURCE,
        format!("Complete CAN task {} succeeded", serial_number).as_str(),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::CanCompleteTaskRequestBody;
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
}
