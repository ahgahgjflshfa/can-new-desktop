use std::sync::{atomic::AtomicBool, Mutex};

use crate::ipc_types::NotificationPayload;

#[derive(Default)]
pub struct MinimizeToTrayState {
    pub enabled: AtomicBool,
}

#[derive(Default)]
pub struct PendingNotificationState {
    pub notification: Mutex<Option<NotificationPayload>>,
    pub revision: Mutex<u64>,
    pub displayed: Mutex<Option<(String, u64)>>,
}
