use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct NotificationPayload {
    pub id: String,
    pub title: String,
    pub body: String,
    pub priority: String,
    pub category: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "unreadCount")]
    pub unread_count: u32,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    pub revision: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DismissPayload {
    #[serde(rename = "notificationId")]
    pub notification_id: Option<String>,
    #[serde(rename = "dismissAll")]
    pub dismiss_all: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PopupClosedPayload {
    #[serde(rename = "notificationId")]
    pub notification_id: Option<String>,
    pub revision: u64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PopupClearedPayload {
    pub system: String,
    pub revision: u64,
}
