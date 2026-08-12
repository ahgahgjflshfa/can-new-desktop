use std::time::Duration;

use serde::Deserialize;

const DEFAULT_CAN_API_BASE_URL: &str = "https://www-u.tymetro.com.tw/can_api/api";
const DEFAULT_CHARGE_API_BASE_URL: &str = "https://www.tymetro.com.tw/can_api/api";

#[derive(Deserialize)]
pub(crate) struct CanApiEnvelope<T> {
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    pub(crate) data: Option<T>,
}

pub(crate) fn build_can_api_url(path: &str) -> String {
    let base_url =
        std::env::var("CAN_API_BASE").unwrap_or_else(|_| DEFAULT_CAN_API_BASE_URL.to_string());
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

pub(crate) fn build_charge_api_url(path: &str) -> String {
    let base_url = std::env::var("CHARGE_API_BASE")
        .unwrap_or_else(|_| DEFAULT_CHARGE_API_BASE_URL.to_string());
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

pub(crate) fn build_can_api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}
