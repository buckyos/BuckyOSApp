//! What only Android has besides the views: the notification service, the files the local pages'
//! `<audio>` reads, and the plugin itself (`ClientPlugin.kt`).

use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::plugin::mobile::PluginInvokeError;
use tauri::plugin::{PluginApi, PluginHandle};
use tauri::{AppHandle, Manager, Runtime, Wry};

use super::views::{app, call, data_dir, spawn, tell};
use crate::json_file::write_json;
use crate::notify::model::Alert;
use crate::notify::service::{ServiceConfig, ServiceZone, CONFIG_FILE};
use crate::notify::NotifyManager;
use crate::zone::secret::SecretStore;
use crate::zone::{ZoneHandle, ZoneManager};

const MEDIA_WAIT: Duration = Duration::from_secs(20);

/// Alerts the user clicked before the local page was there.
static ALERTS: Mutex<(bool, Vec<Alert>)> = Mutex::new((false, Vec::new()));

pub(super) fn register(api: &PluginApi<Wry, ()>) -> Result<PluginHandle<Wry>, PluginInvokeError> {
    api.register_android_plugin("com.buckyos.buckyosapp.content", "ClientPlugin")
}

pub fn secrets<R: Runtime>(_app: &AppHandle<R>) -> SecretStore {
    crate::android::secrets()
}

/// The notification service does not announce messages of this Zone: the user is reading them.
pub(super) fn front_zone(zone: String) {
    spawn(async move { tell("service", json!({ "action": "front", "zone": zone })).await });
}

pub(super) async fn labels_changed() {
    tell("service", json!({ "action": "labels" })).await;
}

/// The events only Android has.
pub(super) fn own_event(kind: &str, event: &Value) -> bool {
    match kind {
        "alert" => {
            let alert = event.get("alert").and_then(Value::as_str).unwrap_or_default();
            if let Ok(alert) = serde_json::from_str::<Alert>(alert) {
                // Which identity is active is asked of the plugin, which waits for this thread.
                spawn(async move { on_alert(alert) });
            }
        }
        "focus" => {
            if let Some(app) = app() {
                nudge(app);
            }
        }
        _ => return false,
    }
    true
}

/// tao loses the wake-up of a message that arrives together with an event of the activity, and the
/// message (the answer of a command, an event for the page) stays until the next one. Right after
/// such an event there is one more.
pub(super) fn nudge(app: &AppHandle) {
    let app = app.clone();
    spawn(async move {
        for wait in [50, 500] {
            tokio::time::sleep(Duration::from_millis(wait)).await;
            let _ = app.run_on_main_thread(|| {});
        }
    });
}

/// A part of a Zone's file for the local pages, packed for `LocalClient.kt`. Blocks: on a thread
/// of the WebView that loads things.
pub fn read_media(url: &str, from: u64, length: u64) -> Option<Vec<u8>> {
    let app = app()?;
    let read = async { tokio::time::timeout(MEDIA_WAIT, crate::zone::media::read(app, url, from, length)).await };
    let piece = tauri::async_runtime::block_on(read).ok()??;
    let about = json!({ "status": piece.status, "type": piece.content_type, "total": piece.total }).to_string();
    let mut packed = (about.len() as u32).to_be_bytes().to_vec();
    packed.extend_from_slice(about.as_bytes());
    packed.extend_from_slice(&piece.data);
    Some(packed)
}

// ---- notifications ----

pub async fn notification_permission(ask: bool) -> Option<bool> {
    #[derive(serde::Deserialize)]
    struct Answer {
        granted: bool,
    }
    call::<Answer>("notificationPermission", json!({ "ask": ask })).await.ok().map(|answer| answer.granted)
}

/// Leaves the service's settings in its file and tells it, when they changed.
pub fn notifications_changed<R: Runtime>(_app: &AppHandle<R>) {
    static TOLD: Mutex<Option<(ServiceConfig, Vec<Option<String>>)>> = Mutex::new(None);
    let Some(app) = app() else { return };
    let (Some(zones), Some(notify)) = (app.try_state::<ZoneManager>(), app.try_state::<NotifyManager>()) else {
        return;
    };
    let handles: Vec<ZoneHandle> = zones
        .handles(app)
        .into_iter()
        // Without a credential (signed out) there is nothing the service could do.
        .filter(|handle| handle.record.notify && zones.sessions.credential(&handle.key).is_some())
        .collect();
    // A new password has to reach the service too.
    let credentials = handles.iter().map(|handle| zones.sessions.credential(&handle.key).map(|credential| credential.digest)).collect();
    let config = ServiceConfig {
        enabled: crate::notify::notify_settings(notify.clone()).enabled,
        zones: handles
            .into_iter()
            .map(|handle| ServiceZone { account: handle.key.account, record: crate::zone::registry::ZoneRecord { icon: None, ..handle.record } })
            .collect(),
        labels: notify.labels(),
    };
    let next = (config, credentials);
    let mut told = TOLD.lock().expect("service settings poisoned");
    if told.as_ref() == Some(&next) {
        return;
    }
    let Some(dir) = data_dir() else { return };
    if let Err(error) = write_json(&dir.join(CONFIG_FILE), &next.0) {
        log::error!("[notify] the service's settings were not saved: {error}");
        return;
    }
    let action = if next.0.enabled && !next.0.zones.is_empty() { "reload" } else { "stop" };
    *told = Some(next);
    spawn(async move { tell("service", json!({ "action": action })).await });
}

fn on_alert(alert: Alert) {
    let mut pending = ALERTS.lock().expect("alerts poisoned");
    match app() {
        Some(app) if pending.0 => crate::notify::activate(app, &alert),
        _ => pending.1.push(alert),
    }
}

/// The local page listens now; it gets the alerts clicked before.
pub fn page_ready<R: Runtime>(_app: &AppHandle<R>) {
    let Some(app) = app() else { return };
    let alerts = {
        let mut pending = ALERTS.lock().expect("alerts poisoned");
        pending.0 = true;
        std::mem::take(&mut pending.1)
    };
    for alert in alerts {
        crate::notify::activate(app, &alert);
    }
}
