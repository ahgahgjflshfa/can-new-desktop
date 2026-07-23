use std::sync::{atomic::AtomicBool, Mutex};

use crate::ipc_types::PopupNotificationBatch;

#[derive(Default)]
pub struct MinimizeToTrayState {
    pub enabled: AtomicBool,
}

#[derive(Default)]
pub struct PendingNotificationState {
    pub notification: Mutex<Option<PopupNotificationBatch>>,
    pub revision: Mutex<u64>,
    /// Revision currently represented by the popup window. This is advanced
    /// when a newer pending batch is emitted, before frontend acknowledgement.
    pub displayed: Mutex<Option<u64>>,
}

impl PendingNotificationState {
    /// Record the revision represented by the native popup. This happens when
    /// the command stores a batch, before the frontend receives its result.
    pub fn mark_popup_revision(&self, revision: u64) -> Result<(), String> {
        *self.displayed.lock().map_err(|e| e.to_string())? = Some(revision);
        Ok(())
    }

    /// Consume the native popup identity for its close event.
    pub fn take_popup_revision(&self) -> Result<Option<u64>, String> {
        Ok(self.displayed.lock().map_err(|e| e.to_string())?.take())
    }
}
