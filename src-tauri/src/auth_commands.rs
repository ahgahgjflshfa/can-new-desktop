use serde::{Deserialize, Serialize};

use crate::api_client::{build_api_client, build_api_url, ApiEnvelope};

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
pub async fn auth_logout(token: String) -> Result<(), String> {
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
