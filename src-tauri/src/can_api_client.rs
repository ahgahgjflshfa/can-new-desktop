use std::time::Duration;

use serde::Deserialize;

const CAN_API_BASE_URL: &str = "https://www.tymetro.com.tw/can_api";

#[derive(Deserialize)]
pub(crate) struct CanApiEnvelope<T> {
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    pub(crate) data: Option<T>,
}

pub(crate) fn build_can_api_url(path: &str) -> String {
    format!("{}{}", CAN_API_BASE_URL.trim_end_matches('/'), path)
}

pub(crate) fn build_can_api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}
