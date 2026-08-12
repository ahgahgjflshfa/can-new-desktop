use serde::{Deserialize, Serialize};

use crate::can_api_client::{build_can_api_client, build_charge_api_url, CanApiEnvelope};

#[derive(Debug, Serialize)]
pub struct ChargeHttpError {
    pub status: u16,
    pub message: String,
}

#[derive(Deserialize)]
pub struct ChargeLoginRequest {
    account: String,
    password: String,
}

#[derive(Deserialize)]
struct ChargeLoginApiData {
    #[serde(alias = "token")]
    access_token: String,
    account: Option<String>,
    station: Option<String>,
    topic: Option<String>,
    system: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChargeUser {
    account: String,
    name: String,
    station: String,
    system: String,
    topic: Option<String>,
}
#[derive(Serialize)]
pub struct ChargeLoginResponse {
    token: String,
    user: ChargeUser,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChargeTaskItem {
    pub serial_number: i64,
    pub device_code: String,
    pub station: String,
    pub is_done: bool,
    pub clean_at: Option<String>,
    pub inform_time: i64,
    pub is_disable: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn value<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Option<&'a serde_json::Value> {
    object.get(name)
}
fn required_string(
    object: &serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<String, String> {
    value(object, name)
        .and_then(|item| item.as_str().map(str::to_owned))
        .filter(|item| !item.is_empty())
        .ok_or_else(|| format!("charge task field '{}' is required", name))
}
fn required_integer(
    object: &serde_json::Map<String, serde_json::Value>,
    name: &str,
) -> Result<i64, String> {
    value(object, name)
        .and_then(|item| {
            item.as_i64()
                .or_else(|| item.as_u64().and_then(|number| i64::try_from(number).ok()))
        })
        .ok_or_else(|| format!("charge task field '{}' is required", name))
}
fn bool_value(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> bool {
    match value(object, name) {
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::Number(value)) => value.as_i64().unwrap_or(0) != 0,
        Some(serde_json::Value::String(value)) => matches!(value.as_str(), "true" | "1"),
        _ => false,
    }
}
fn transform_task(raw: serde_json::Value) -> Result<ChargeTaskItem, String> {
    let object = raw
        .as_object()
        .ok_or_else(|| "charge task must be an object".to_string())?;
    Ok(ChargeTaskItem {
        serial_number: required_integer(object, "serialNumber")?,
        device_code: required_string(object, "deviceCode")?,
        station: required_string(object, "station")?,
        is_done: bool_value(object, "isDone"),
        clean_at: value(object, "cleanAt").and_then(|item| item.as_str().map(str::to_owned)),
        inform_time: required_integer(object, "informTime")?,
        is_disable: bool_value(object, "isDisable"),
        created_at: required_string(object, "createdAt")?,
        updated_at: required_string(object, "updatedAt")?,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChargeUpdateTaskRequestBody {
    is_done: bool,
}
fn http_error(status: u16, message: String) -> ChargeHttpError {
    ChargeHttpError { status, message }
}
async fn response_body(response: reqwest::Response) -> Result<(u16, String), ChargeHttpError> {
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| http_error(status, error.to_string()))?;
    Ok((status, body))
}

#[tauri::command]
pub async fn charge_login(
    payload: ChargeLoginRequest,
) -> Result<ChargeLoginResponse, ChargeHttpError> {
    let client = build_can_api_client().map_err(|message| http_error(0, message))?;
    let response = client
        .post(build_charge_api_url("/auth/login"))
        .json(&serde_json::json!({ "account": payload.account, "password": payload.password }))
        .send()
        .await
        .map_err(|error| http_error(0, error.to_string()))?;
    let (status, body) = response_body(response).await?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, body));
    }
    let data = serde_json::from_str::<ChargeLoginApiData>(&body)
        .or_else(|_| {
            serde_json::from_str::<CanApiEnvelope<ChargeLoginApiData>>(&body).and_then(|e| {
                e.data
                    .ok_or_else(|| serde_json::Error::io(std::io::Error::other("missing data")))
            })
        })
        .map_err(|error| http_error(status, error.to_string()))?;
    let account = data.account.unwrap_or_else(|| payload.account.clone());
    Ok(ChargeLoginResponse {
        token: data.access_token,
        user: ChargeUser {
            name: account.clone(),
            account,
            station: data.station.unwrap_or_default(),
            system: data.system.unwrap_or_default(),
            topic: data.topic,
        },
    })
}

#[tauri::command]
pub async fn charge_fetch_tasks(
    token: String,
    station: String,
) -> Result<Vec<ChargeTaskItem>, ChargeHttpError> {
    let station = station.trim().to_owned();
    if station.is_empty() {
        return Err(http_error(0, "station is required".into()));
    }
    let client = build_can_api_client().map_err(|message| http_error(0, message))?;
    let response = client
        .get(build_charge_api_url("/charge/task"))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| http_error(0, error.to_string()))?;
    let (status, body) = response_body(response).await?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, body));
    }
    let raw_tasks = serde_json::from_str::<Vec<serde_json::Value>>(&body)
        .or_else(|_| {
            serde_json::from_str::<CanApiEnvelope<Vec<serde_json::Value>>>(&body).and_then(|e| {
                e.data
                    .ok_or_else(|| serde_json::Error::io(std::io::Error::other("missing data")))
            })
        })
        .map_err(|error| http_error(status, error.to_string()))?;
    raw_tasks
        .into_iter()
        .map(transform_task)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|message| http_error(status, message))
        .map(|tasks| {
            tasks
                .into_iter()
                .filter(|task| task.station.trim() == station)
                .collect()
        })
}

#[tauri::command]
pub async fn charge_complete_task(
    token: String,
    station: String,
    serial_number: i64,
    is_done: bool,
) -> Result<(), ChargeHttpError> {
    if station.trim().is_empty() {
        return Err(http_error(0, "station is required".into()));
    }
    let client = build_can_api_client().map_err(|message| http_error(0, message))?;
    let response = client
        .patch(build_charge_api_url(&format!(
            "/charge/task/{}",
            serial_number
        )))
        .bearer_auth(token)
        .json(&ChargeUpdateTaskRequestBody { is_done })
        .send()
        .await
        .map_err(|error| http_error(0, error.to_string()))?;
    let (status, body) = response_body(response).await?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, body));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{transform_task, ChargeUpdateTaskRequestBody};
    use serde_json::json;
    #[test]
    fn transforms_new_charge_contract() {
        let task = transform_task(json!({"serialNumber":1,"deviceCode":"D1","station":"S1","isDone":0,"cleanAt":null,"informTime":1,"isDisable":false,"createdAt":"2026-01-01","updatedAt":"2026-01-02"})).unwrap();
        assert!(!task.is_done);
        assert_eq!(task.device_code, "D1");
    }
    #[test]
    fn serializes_update_body() {
        assert_eq!(
            serde_json::to_value(ChargeUpdateTaskRequestBody { is_done: true }).unwrap(),
            json!({"isDone":true})
        );
    }
}
