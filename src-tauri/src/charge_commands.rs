use serde::{Deserialize, Serialize};

use crate::can_api_client::{build_can_api_client, build_can_api_url, CanApiEnvelope};

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
    pub status: String,
    pub fault_description: String,
    pub fault_type: String,
    pub resolution_type: i64,
    pub is_disable: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn value<'a>(object: &'a serde_json::Map<String, serde_json::Value>, names: &[&str]) -> Option<&'a serde_json::Value> {
    names.iter().find_map(|name| object.get(*name))
}

fn string_value(object: &serde_json::Map<String, serde_json::Value>, names: &[&str]) -> Option<String> {
    value(object, names).and_then(|item| item.as_str().map(str::to_owned).or_else(|| item.as_i64().map(|number| number.to_string())))
}

fn required_integer(object: &serde_json::Map<String, serde_json::Value>, name: &str) -> Result<i64, String> {
    value(object, &[name]).and_then(|item| item.as_i64().or_else(|| item.as_u64().and_then(|number| i64::try_from(number).ok())).or_else(|| item.as_str()?.trim().parse().ok())).ok_or_else(|| format!("charge task field '{}' is required", name))
}

fn bool_value(object: &serde_json::Map<String, serde_json::Value>, names: &[&str]) -> bool {
    value(object, names).map(|item| match item {
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(number) => number.as_i64().unwrap_or(0) != 0,
        serde_json::Value::String(text) => matches!(text.trim().to_ascii_lowercase().as_str(), "true" | "1" | "yes" | "y"),
        _ => false,
    }).unwrap_or(false)
}

fn transform_task(raw: serde_json::Value) -> Result<ChargeTaskItem, String> {
    let object = raw.as_object().ok_or_else(|| "charge task must be an object".to_string())?;
    let required_string = |name: &str| string_value(object, &[name]).filter(|value| !value.is_empty()).ok_or_else(|| format!("charge task field '{}' is required", name));
    Ok(ChargeTaskItem {
        serial_number: required_integer(object, "serialNumber")?,
        device_code: required_string("deviceCode")?,
        station: required_string("station")?,
        status: required_string("status")?,
        fault_description: required_string("faultDescription")?,
        fault_type: required_string("faultType")?,
        resolution_type: required_integer(object, "resolutionType")?,
        is_disable: bool_value(object, &["isDisable"]),
        created_at: required_string("createdAt")?,
        updated_at: required_string("updatedAt")?,
    })
}

#[derive(Serialize)]
struct ChargeCompleteTaskRequestBody {
    status: &'static str,
    #[serde(rename = "resolutionType")]
    resolution_type: i64,
}

fn http_error(status: u16, message: String) -> ChargeHttpError {
    ChargeHttpError { status, message }
}

async fn response_body(response: reqwest::Response) -> Result<(u16, String), ChargeHttpError> {
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|error| http_error(status, error.to_string()))?;
    Ok((status, body))
}

#[tauri::command]
pub async fn charge_login(payload: ChargeLoginRequest) -> Result<ChargeLoginResponse, ChargeHttpError> {
    let client = build_can_api_client().map_err(|message| http_error(0, message))?;
    let response = client
        .post(build_can_api_url("/api/auth/login"))
        .json(&serde_json::json!({ "account": payload.account, "password": payload.password }))
        .send().await.map_err(|error| http_error(0, error.to_string()))?;
    let (status, body) = response_body(response).await?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, body));
    }
    let data = serde_json::from_str::<ChargeLoginApiData>(&body)
        .or_else(|_| serde_json::from_str::<CanApiEnvelope<ChargeLoginApiData>>(&body)
            .and_then(|e| e.data.ok_or_else(|| serde_json::Error::io(std::io::Error::other("missing data")))) )
        .map_err(|error| http_error(status, error.to_string()))?;
    let account = data.account.unwrap_or_else(|| payload.account.clone());
    Ok(ChargeLoginResponse {
        token: data.access_token,
        user: ChargeUser { name: account.clone(), account, station: data.station.unwrap_or_default(), system: data.system.unwrap_or_default(), topic: data.topic },
    })
}

#[tauri::command]
pub async fn charge_fetch_tasks(token: String, station: String) -> Result<Vec<ChargeTaskItem>, ChargeHttpError> {
    let station = station.trim().to_owned();
    if station.is_empty() { return Err(http_error(0, "station is required".into())); }
    let client = build_can_api_client().map_err(|message| http_error(0, message))?;
    let response = client.get(build_can_api_url("/api/charge/task")).bearer_auth(token).send().await.map_err(|error| http_error(0, error.to_string()))?;
    let (status, body) = response_body(response).await?;
    if !(200..300).contains(&status) { return Err(http_error(status, body)); }
    let raw_tasks = serde_json::from_str::<Vec<serde_json::Value>>(&body)
        .or_else(|_| serde_json::from_str::<CanApiEnvelope<Vec<serde_json::Value>>>(&body).and_then(|e| e.data.ok_or_else(|| serde_json::Error::io(std::io::Error::other("missing data")))))
        .map_err(|error| http_error(status, error.to_string()))?;
    raw_tasks.into_iter().map(transform_task).collect::<Result<Vec<_>, _>>().map_err(|message| http_error(status, message)).map(|tasks| tasks.into_iter().filter(|task| task.station.trim() == station).collect())
}

#[tauri::command]
pub async fn charge_complete_task(token: String, station: String, serial_number: i64) -> Result<(), ChargeHttpError> {
    if station.trim().is_empty() { return Err(http_error(0, "station is required".into())); }
    let client = build_can_api_client().map_err(|message| http_error(0, message))?;
    let response = client.patch(build_can_api_url(&format!("/api/charge/task/{}", serial_number))).bearer_auth(token).json(&ChargeCompleteTaskRequestBody { status: "done", resolution_type: 1 }).send().await.map_err(|error| http_error(0, error.to_string()))?;
    let (status, body) = response_body(response).await?;
    if !(200..300).contains(&status) { return Err(http_error(status, body)); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{transform_task, ChargeCompleteTaskRequestBody, ChargeHttpError};
    use serde_json::json;

    #[test]
    fn completion_payload_is_charge_contract() {
        assert_eq!(serde_json::to_value(ChargeCompleteTaskRequestBody { status: "done", resolution_type: 1 }).unwrap(), json!({"status":"done","resolutionType":1}));
    }

    #[test]
    fn transforms_full_task_shape_and_string_primitives() {
        let task = transform_task(json!({
            "serialNumber": "42", "deviceCode": "D-1", "station": " S1 ", "status": "processing",
            "faultDescription": "overheat", "faultType": "electrical", "resolutionType": "1",
            "isDisable": 1, "createdAt": "2026-01-01", "updatedAt": "2026-01-02"
        })).unwrap();
        assert_eq!(serde_json::to_value(task).unwrap(), json!({
            "serialNumber": 42, "deviceCode": "D-1", "station": " S1 ", "status": "processing",
            "faultDescription": "overheat", "faultType": "electrical", "resolutionType": 1, "isDisable": true,
            "createdAt": "2026-01-01", "updatedAt": "2026-01-02"
        }));
    }

    #[test]
    fn serializes_structured_forbidden_error() {
        assert_eq!(serde_json::to_value(ChargeHttpError { status: 403, message: "forbidden".into() }).unwrap(), json!({"status": 403, "message": "forbidden"}));
    }
}
