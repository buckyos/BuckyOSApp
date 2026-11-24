//! System notifications, with the click coming back to the client.

#[cfg(target_os = "windows")]
#[path = "windows.rs"]
mod platform;
#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;
#[cfg(target_os = "linux")]
#[path = "linux.rs"]
mod platform;
#[cfg(target_os = "android")]
#[path = "android.rs"]
mod platform;
#[cfg(target_os = "ios")]
#[path = "ios.rs"]
mod platform;

use tauri::{AppHandle, Runtime};

use super::model::Alert;

/// The second line names the Zone: several may be connected at once.
#[allow(dead_code)]
fn attribution(alert: &Alert) -> &str {
    &alert.zone_label
}

pub fn show<R: Runtime>(app: &AppHandle<R>, alert: &Alert) {
    if let Err(error) = platform::show(app, alert) {
        log::warn!("[notify] showing a notification failed: {error}");
    }
}

/// `None` where the system has no such permission, or it was not asked yet.
pub async fn permission<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    platform::permission(app).await
}

pub async fn request_permission<R: Runtime>(app: &AppHandle<R>) -> bool {
    platform::request_permission(app).await
}
