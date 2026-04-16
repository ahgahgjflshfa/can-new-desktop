use serde::{Deserialize, Serialize};

use crate::api_client::{build_api_client, build_api_url, ApiEnvelope};
use crate::runtime_log;

const LOG_SOURCE: &str = "auth";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginRequest {
    account: String,
    password: String,
    device_type: String,
    device_id: String,
    fcm_token: Option<String>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    name: String,
    station_id: String,
    section_id: Option<String>,
    role: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLoginResponse {
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

#[tauri::command]
pub async fn auth_login(payload: AuthLoginRequest) -> Result<AuthLoginResponse, String> {
    runtime_log::info(
        LOG_SOURCE,
        format!(
            "Starting login request for account '{}' with device_type '{}'",
            payload.account, payload.device_type
        )
        .as_str(),
    );
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
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Login HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<LoginApiData>>()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed to decode login response: {}", e).as_str(),
            );
            e.to_string()
        })?;

    if !status_code.is_success() || envelope.status != "success" {
        let message = envelope
            .message
            .unwrap_or_else(|| format!("Login failed with status {}", status_code));
        runtime_log::warn(
            LOG_SOURCE,
            format!("Login rejected with status {}: {}", status_code, message).as_str(),
        );
        return Err(message);
    }

    let data = envelope.data.ok_or_else(|| {
        runtime_log::error(LOG_SOURCE, "Login response was successful but missing data");
        "Login response missing data".to_string()
    })?;

    runtime_log::info(
        LOG_SOURCE,
        format!(
            "Login succeeded for account '{}' (station_id='{}', role='{}')",
            payload.account, data.user.station_id, data.user.role
        )
        .as_str(),
    );

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
pub async fn auth_logout(token: String) -> Result<(), String> {
    runtime_log::info(LOG_SOURCE, "Starting logout request");
    let client = build_api_client()?;
    let response = client
        .post(build_api_url("/auth/logout"))
        .bearer_auth(token)
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Logout HTTP request failed: {}", e).as_str(),
            );
            e.to_string()
        })?;

    let status_code = response.status();
    let envelope = response
        .json::<ApiEnvelope<serde_json::Value>>()
        .await
        .map_err(|e| {
            runtime_log::error(
                LOG_SOURCE,
                format!("Failed to decode logout response: {}", e).as_str(),
            );
            e.to_string()
        })?;

    if !status_code.is_success() || envelope.status != "success" {
        let message = envelope
            .message
            .unwrap_or_else(|| format!("Logout failed with status {}", status_code));
        runtime_log::warn(
            LOG_SOURCE,
            format!("Logout rejected with status {}: {}", status_code, message).as_str(),
        );
        return Err(message);
    }

    runtime_log::info(LOG_SOURCE, "Logout succeeded");

    Ok(())
}
