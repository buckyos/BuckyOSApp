use notify_rust::{Hint, Notification, Urgency};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Runtime};

use super::super::model::{Alert, AlertLevel};

fn shown() -> &'static Mutex<HashMap<String, u32>> {
    static SHOWN: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    SHOWN.get_or_init(Mutex::default)
}

pub fn show<R: Runtime>(app: &AppHandle<R>, alert: &Alert) -> Result<(), Box<dyn std::error::Error>> {
    let app = app.clone();
    let alert = alert.clone();
    std::thread::spawn(move || {
        let mut notification = Notification::new();
        notification
            .appname("BuckyOS")
            .summary(&alert.title)
            .body(&format!("{}\n{}", alert.body, super::attribution(&alert)))
            .action("default", "Open")
            .hint(Hint::SuppressSound(alert.level == AlertLevel::Silent))
            .urgency(if alert.level == AlertLevel::Urgent { Urgency::Critical } else { Urgency::Normal });
        if let Some(id) = shown().lock().expect("notifications poisoned").get(&alert.tag) {
            notification.id(*id);
        }
        match notification.show() {
            Ok(handle) => {
                shown().lock().expect("notifications poisoned").insert(alert.tag.clone(), handle.id());
                handle.wait_for_action(|action| {
                    if action == "default" {
                        super::super::activate(&app, &alert);
                    }
                });
            }
            Err(error) => log::warn!("[notify] showing a notification failed: {error}"),
        }
    });
    Ok(())
}

pub async fn permission<R: Runtime>(_app: &AppHandle<R>) -> Option<bool> {
    None
}

pub async fn request_permission<R: Runtime>(_app: &AppHandle<R>) -> bool {
    true
}
