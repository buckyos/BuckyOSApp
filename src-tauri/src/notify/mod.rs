//! Notifications: one connection per signed-in Zone that has them on, kept by the client itself
//! (no push service, no SN; TODO Q9). An event on the Zone's kevent stream only says that there is
//! something to read; what is read decides what alerts. A slow poll covers lost events.

mod alerts;
pub mod core;
pub mod model;
#[cfg(any(target_os = "android", test))]
pub mod service;

use serde::Serialize;
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_store::StoreExt;

use self::core::{make_alert, stream_client, zone_label, Changed, ConnectionState, Host, Labels, Pace};
use crate::error::CommandResult;
use crate::zone::session::SessionState;
use crate::zone::{ZoneHandle, ZoneManager};
use model::{Alert, AlertLevel, AlertTarget, Seen, Summary, MAX_ALERTS_AT_ONCE};

pub const STATUS_EVENT: &str = "notify://status";
pub const CHANGED_EVENT: &str = "notify://changed";
pub const ACTIVATE_EVENT: &str = "notify://activate";
const STORE_FILE: &str = "notify.json";
const SETTINGS_KEY: &str = "settings";
const RECENT_ALERTS: usize = 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoneStatus {
    pub zone: String,
    pub state: ConnectionState,
    pub summary: Summary,
    pub urgent: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, serde::Deserialize)]
#[serde(default)]
pub struct Settings {
    pub enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { enabled: true }
    }
}

struct Connection {
    handle: ZoneHandle,
    task: tauri::async_runtime::JoinHandle<()>,
    wake: Arc<tokio::sync::Notify>,
    state: ConnectionState,
    summary: Summary,
    urgent: HashSet<String>,
}

#[derive(Default)]
struct Inner {
    connections: HashMap<(String, String), Connection>,
    recent: VecDeque<Alert>,
    labels: Labels,
    settings: Settings,
    sync_queued: bool,
}

pub struct NotifyManager {
    inner: Mutex<Inner>,
    stream: reqwest::Client,
}

impl NotifyManager {
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Self, reqwest::Error> {
        let settings = app
            .store(STORE_FILE)
            .ok()
            .and_then(|store| store.get(SETTINGS_KEY))
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        Ok(Self {
            inner: Mutex::new(Inner { settings, ..Inner::default() }),
            stream: stream_client(Pace::default())?,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("notify state poisoned")
    }

    pub fn recent(&self) -> Vec<Alert> {
        self.lock().recent.iter().rev().cloned().collect()
    }

    pub fn labels(&self) -> Labels {
        self.lock().labels.clone()
    }

    /// Unread over all Zones, and whether something urgent waits.
    #[cfg(desktop)]
    pub fn totals(&self) -> (u64, bool) {
        let inner = self.lock();
        inner.connections.values().fold((0, false), |(unread, urgent), connection| {
            (unread + connection.summary.total(), urgent || !connection.urgent.is_empty())
        })
    }

    fn statuses(&self) -> Vec<ZoneStatus> {
        let inner = self.lock();
        inner.connections.values().map(status_of).collect()
    }
}

fn status_of(connection: &Connection) -> ZoneStatus {
    ZoneStatus {
        zone: connection.handle.key.zone.clone(),
        state: connection.state,
        summary: connection.summary.clone(),
        urgent: !connection.urgent.is_empty(),
    }
}

/// Connections follow the Zone list, the sessions and the switches; callers only say that one of
/// them changed.
pub fn sync_soon<R: Runtime>(app: &AppHandle<R>) {
    let Some(manager) = app.try_state::<NotifyManager>() else { return };
    {
        let mut inner = manager.lock();
        if inner.sync_queued {
            return;
        }
        inner.sync_queued = true;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        app.state::<NotifyManager>().lock().sync_queued = false;
        sync(&app);
    });
}

fn sync<R: Runtime>(app: &AppHandle<R>) {
    let (Some(manager), Some(zones)) = (app.try_state::<NotifyManager>(), app.try_state::<ZoneManager>()) else {
        return;
    };
    let wanted: HashMap<(String, String), ZoneHandle> = zones
        .handles(app)
        .into_iter()
        .filter(|handle| handle.record.notify && zones.sessions.status(&handle.key).state != SessionState::SignedOut)
        .map(|handle| ((handle.key.account.clone(), handle.key.zone.clone()), handle))
        .collect();
    let listed: HashSet<(String, String)> =
        zones.handles(app).into_iter().map(|handle| (handle.key.account, handle.key.zone)).collect();
    {
        let mut inner = manager.lock();
        let enabled = inner.settings.enabled;
        // Another identity's, or a Zone's that left the list.
        inner.recent.retain(|alert| listed.contains(&(alert.account.clone(), alert.zone.clone())));
        inner.connections.retain(|key, connection| {
            let keep = enabled && wanted.get(key).is_some_and(|handle| handle.host() == connection.handle.host());
            if !keep {
                connection.task.abort();
            }
            keep
        });
        if enabled {
            for (key, handle) in wanted {
                if let Some(connection) = inner.connections.get_mut(&key) {
                    let signed_in = zones.sessions.status(&handle.key).state == SessionState::SignedIn;
                    connection.handle = handle;
                    // Only one that waits for the sign-in; the others have their own pace.
                    if signed_in && connection.state == ConnectionState::NeedLogin {
                        connection.wake.notify_one();
                    }
                    continue;
                }
                let wake = Arc::new(tokio::sync::Notify::new());
                let host = Arc::new(ClientHost { app: app.clone() });
                let task = tauri::async_runtime::spawn(self::core::run(host, zones.sessions.clone(), manager.stream.clone(), handle.clone(), wake.clone()));
                inner.connections.insert(
                    key,
                    Connection { handle, task, wake, state: ConnectionState::Connecting, summary: Summary::default(), urgent: HashSet::new() },
                );
            }
        }
    }
    publish(app);
}

/// Reads again now: the network changed, the device woke up, a page acted on a notification.
pub fn wake_all<R: Runtime>(app: &AppHandle<R>) {
    if let Some(manager) = app.try_state::<NotifyManager>() {
        for connection in manager.lock().connections.values() {
            connection.wake.notify_one();
        }
    }
}

fn publish<R: Runtime>(app: &AppHandle<R>) {
    let manager = app.state::<NotifyManager>();
    let _ = app.emit(STATUS_EVENT, manager.statuses());
    #[cfg(desktop)]
    crate::tray::notifications_changed(app);
    #[cfg(target_os = "android")]
    crate::content::mobile::notifications_changed(app);
}

fn update<R: Runtime>(app: &AppHandle<R>, handle: &ZoneHandle, change: impl FnOnce(&mut Connection)) {
    let changed = {
        let manager = app.state::<NotifyManager>();
        let mut inner = manager.lock();
        let Some(connection) = inner.connections.get_mut(&(handle.key.account.clone(), handle.key.zone.clone())) else {
            return;
        };
        let before = (connection.state, connection.summary.clone(), connection.urgent.clone());
        change(connection);
        before != (connection.state, connection.summary.clone(), connection.urgent.clone())
    };
    if changed {
        publish(app);
    }
}

fn seen_key(handle: &ZoneHandle) -> String {
    format!("seen|{}|{}", handle.key.account, handle.key.zone)
}

struct ClientHost<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> Host for ClientHost<R> {
    fn load_seen(&self, zone: &ZoneHandle) -> Seen {
        self.app
            .store(STORE_FILE)
            .ok()
            .and_then(|store| store.get(seen_key(zone)))
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default()
    }

    fn save_seen(&self, zone: &ZoneHandle, seen: &Seen) {
        if let (Ok(store), Ok(value)) = (self.app.store(STORE_FILE), serde_json::to_value(seen)) {
            store.set(seen_key(zone), value);
            if let Err(error) = store.save() {
                log::warn!("[notify] saving failed: {error}");
            }
        }
    }

    fn labels(&self) -> Labels {
        self.app.state::<NotifyManager>().labels()
    }

    fn state(&self, zone: &ZoneHandle, state: ConnectionState) {
        update(&self.app, zone, |connection| connection.state = state);
    }

    fn counts(&self, zone: &ZoneHandle, summary: Summary, urgent: HashSet<String>) {
        update(&self.app, zone, |connection| {
            connection.summary = summary;
            connection.urgent = urgent;
        });
    }

    fn changed(&self, zone: &ZoneHandle, what: Changed) {
        let _ = self.app.emit(CHANGED_EVENT, json!({ "zone": zone.key.zone, "source": what }));
    }

    #[cfg(desktop)]
    fn messages_in_front(&self, zone: &ZoneHandle) -> bool {
        crate::content::windows::is_app_focused(&self.app, &zone.key.zone, "messagehub")
    }

    #[cfg(mobile)]
    fn messages_in_front(&self, zone: &ZoneHandle) -> bool {
        crate::content::mobile::is_app_focused(&self.app, &zone.key.zone, "messagehub")
    }

    fn alerts(&self, zone: &ZoneHandle, alerts: Vec<Alert>) {
        let manager = self.app.state::<NotifyManager>();
        {
            let mut inner = manager.lock();
            for alert in &alerts {
                inner.recent.retain(|recent| recent.tag != alert.tag);
                inner.recent.push_back(alert.clone());
                while inner.recent.len() > RECENT_ALERTS {
                    inner.recent.pop_front();
                }
            }
        }
        // Android's own service shows them, whether or not the client runs.
        #[cfg(not(target_os = "android"))]
        for alert in shown_alerts(zone, alerts, &manager.labels()) {
            alerts::show(&self.app, &alert);
        }
        #[cfg(target_os = "android")]
        let _ = zone;
        publish(&self.app);
    }
}

/// Many at once (after a long time offline) are one notification.
pub fn shown_alerts(zone: &ZoneHandle, alerts: Vec<Alert>, labels: &Labels) -> Vec<Alert> {
    if alerts.len() <= MAX_ALERTS_AT_ONCE {
        return alerts;
    }
    let urgent = alerts.iter().any(|alert| alert.level == AlertLevel::Urgent);
    let body = labels.many.replace("{count}", &alerts.len().to_string());
    let level = if urgent { AlertLevel::Urgent } else { AlertLevel::Sound };
    vec![make_alert(zone, "many", zone_label(zone), body, level, AlertTarget::Activity)]
}

/// An alert was clicked (a system notification, the tray menu, the tray popover).
pub fn activate<R: Runtime>(app: &AppHandle<R>, alert: &Alert) {
    // It may have been there since before the identity was switched.
    if crate::did::active_account(app).as_deref() != Some(alert.account.as_str()) {
        return;
    }
    let _ = app.emit_to("main", ACTIVATE_EVENT, alert.clone());
}

#[tauri::command]
pub fn notify_status(manager: State<'_, NotifyManager>) -> Vec<ZoneStatus> {
    manager.statuses()
}

#[tauri::command]
pub fn notify_recent(manager: State<'_, NotifyManager>) -> Vec<Alert> {
    manager.recent()
}

// Not on the main thread: the tray's menu is changed through it.
#[tauri::command(async)]
pub fn notify_set_labels(app: AppHandle, manager: State<'_, NotifyManager>, labels: Labels) {
    manager.lock().labels = labels;
    publish(&app);
}

#[tauri::command]
pub fn notify_settings(manager: State<'_, NotifyManager>) -> Settings {
    manager.lock().settings
}

/// Turning notifications on asks the system for permission; the answer comes back with the
/// settings so the page can point to the system settings when it was refused.
#[tauri::command]
pub async fn notify_set_enabled(app: AppHandle, enabled: bool) -> CommandResult<bool> {
    {
        let manager = app.state::<NotifyManager>();
        manager.lock().settings.enabled = enabled;
        if let Ok(store) = app.store(STORE_FILE) {
            store.set(SETTINGS_KEY, json!({ "enabled": enabled }));
            let _ = store.save();
        }
    }
    sync(&app);
    if !enabled {
        return Ok(true);
    }
    Ok(alerts::request_permission(&app).await)
}

#[tauri::command]
pub async fn notify_permission(app: AppHandle) -> Option<bool> {
    alerts::permission(&app).await
}

/// A page read, answered or dismissed something: the counts change now rather than at the next poll.
#[tauri::command]
pub fn notify_refresh(app: AppHandle) {
    wake_all(&app);
}

/// The user clicked an alert in a window of the client.
#[tauri::command]
pub fn notify_activate(app: AppHandle, alert: Alert) {
    activate(&app, &alert);
}

/// Shows an alert of the client itself (a finished download).
#[tauri::command]
pub fn notify_show(app: AppHandle, alert: Alert) {
    alerts::show(&app, &alert);
}
