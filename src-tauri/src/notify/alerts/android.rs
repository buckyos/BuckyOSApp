//! The notifications of a Zone come from the notification service (`notify/service.rs`); here are
//! only the client's own, and the permission.

use tauri::{AppHandle, Runtime};

use super::super::model::Alert;

pub fn show<R: Runtime>(_app: &AppHandle<R>, alert: &Alert) -> Result<(), Box<dyn std::error::Error>> {
    crate::android::show_alert(&serde_json::to_string(alert)?);
    Ok(())
}

pub async fn permission<R: Runtime>(_app: &AppHandle<R>) -> Option<bool> {
    crate::content::mobile::notification_permission(false).await
}

pub async fn request_permission<R: Runtime>(_app: &AppHandle<R>) -> bool {
    crate::content::mobile::notification_permission(true).await.unwrap_or(false)
}
