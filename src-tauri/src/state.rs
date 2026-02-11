use std::sync::{atomic::AtomicBool, Mutex};

use crate::ipc_types::NotificationPayload;

#[derive(Default)]
pub struct MinimizeToTrayState {
    pub enabled: AtomicBool,
}

#[derive(Default)]
pub struct PendingNotificationState {
    pub notification: Mutex<Option<NotificationPayload>>,
}
