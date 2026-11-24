//! Not in this version (TODO Q18).

use tauri::{AppHandle, Runtime};

use super::super::model::Alert;

pub fn show<R: Runtime>(_app: &AppHandle<R>, _alert: &Alert) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

pub async fn permission<R: Runtime>(_app: &AppHandle<R>) -> Option<bool> {
    None
}

pub async fn request_permission<R: Runtime>(_app: &AppHandle<R>) -> bool {
    false
}
