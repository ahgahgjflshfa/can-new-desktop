use std::time::Duration;

use serde::Deserialize;

const API_BASE_URL: &str = "https://www-u.tymetro.com.tw/station_services/api";

#[derive(Deserialize)]
pub(crate) struct ApiEnvelope<T> {
    pub(crate) status: String,
    pub(crate) message: Option<String>,
    pub(crate) data: Option<T>,
}

pub(crate) fn build_api_url(path: &str) -> String {
    format!("{}{}", API_BASE_URL.trim_end_matches('/'), path)
}

pub(crate) fn build_api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}
