//! The routing as part of the client: the Zones it is for, what it remembers, what the pages are
//! told, and what makes it look again.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_store::StoreExt;

use super::net::{is_lan, SystemNet};
use super::proxy::{listen, Entry, Listening, BROWSER_PATH, BROWSER_PORT};
use super::{current, install, Attempt, KnownDevice, LineStatus, Options, RouteEvent, RouteZone, Router};
use crate::error::{CommandErrors, CommandResult};
use crate::zone::session::{SessionState, ZoneKey};
use crate::zone::{ZoneHandle, ZoneManager};

pub const LINE_EVENT: &str = "zone://line";
const STORE_FILE: &str = "route.json";
const BROWSER_KEY: &str = "browser";
const READ_AGAIN: Duration = Duration::from_secs(3600);
const READ_FAILED_AGAIN: Duration = Duration::from_secs(300);
#[cfg(desktop)]
const WATCH_EVERY: Duration = Duration::from_secs(5);

/// Kept as long as the process runs; a phone has to listen again now and then.
#[cfg_attr(desktop, allow(dead_code))]
struct Started {
    entry: Entry,
    listening: Option<Listening>,
}

static STARTED: Mutex<Option<Started>> = Mutex::new(None);

/// Must come before the first WebView: some learn only then that there is a proxy. Without it the
/// client works as it would without any of this.
pub fn start() {
    let mut secret = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut secret);
    let entry = Entry::Client { pac_path: format!("/{}/proxy.pac", hex::encode(secret)), pass_others: cfg!(target_os = "linux") };
    let started = tauri::async_runtime::block_on(async {
        let router = Router::new(Arc::new(SystemNet), Options::default());
        let listening = listen(router.clone(), 0, entry.clone())?;
        router.set_port(listening.port);
        Ok::<_, std::io::Error>((router, listening))
    });
    match started {
        Ok((router, listening)) => {
            #[cfg(target_os = "windows")]
            if let Entry::Client { pac_path, .. } = &entry {
                super::webview::use_script(&format!("http://127.0.0.1:{}{pac_path}", listening.port));
            }
            install(router);
            *STARTED.lock().expect("route poisoned") = Some(Started { entry, listening: Some(listening) });
        }
        Err(error) => log::error!("[route] the proxy of the client did not start: {error}"),
    }
}

#[derive(Default)]
pub struct Routes {
    /// When the devices of a Zone are to be read (again).
    read_at: Mutex<HashMap<ZoneKey, Instant>>,
    told: Mutex<HashMap<String, (Option<super::Line>, bool, bool)>>,
    browser: Mutex<Browser>,
    applied: Mutex<Option<(u16, Vec<String>)>>,
}

#[derive(Default)]
struct Browser {
    enabled: bool,
    listening: Option<Listening>,
    error: Option<String>,
}

pub fn attach<R: Runtime>(app: &AppHandle<R>) {
    app.manage(Routes::default());
    let Some(router) = current() else { return };
    let events = app.clone();
    router.on_event(move |event| on_event(&events, event));
    // Who reads the script does so once; a Zone activated after that is mostly one of this domain.
    #[cfg(desktop)]
    if let Ok(endpoints) = crate::config::get_service_endpoints(app.clone()) {
        router.set_family(&format!("web3.{}", endpoints.sn_host));
    }
    sync(app);
    let wanted = app.store(STORE_FILE).ok().and_then(|store| store.get(BROWSER_KEY)).is_some_and(|value| value == Value::Bool(true));
    if wanted {
        set_browser(app, true);
    }
    let looking = router.clone();
    tauri::async_runtime::spawn(async move { looking.keep_looking().await });
    let reading = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(READ_AGAIN / 6).await;
            let Some(manager) = reading.try_state::<ZoneManager>() else { continue };
            for handle in manager.handles(&reading) {
                read_devices(&reading, &handle).await;
            }
        }
    });
    #[cfg(desktop)]
    tauri::async_runtime::spawn(watch(app.clone()));
}

/// The Zone list changed, or which account it is for.
pub fn sync<R: Runtime>(app: &AppHandle<R>) {
    let (Some(router), Some(manager)) = (current(), app.try_state::<ZoneManager>()) else { return };
    let mut zones: Vec<RouteZone> = Vec::new();
    for handle in manager.handles(app) {
        if !zones.iter().any(|zone| zone.host == handle.host()) {
            zones.push(RouteZone { host: handle.host().to_string(), memory: handle.record.route.clone() });
        }
    }
    router.set_zones(zones);
    apply(app);
}

/// Tells the WebViews which hosts go through the proxy, where it can be told while they run.
fn apply<R: Runtime>(app: &AppHandle<R>) {
    let (Some(router), Some(routes)) = (current(), app.try_state::<Routes>()) else { return };
    let wanted = (router.port(), router.hosts());
    {
        let mut applied = routes.applied.lock().expect("route poisoned");
        if applied.as_ref() == Some(&wanted) {
            return;
        }
        *applied = Some(wanted.clone());
    }
    #[cfg(desktop)]
    super::webview::apply(app, wanted.0, wanted.1);
    #[cfg(mobile)]
    crate::content::mobile::set_proxy(wanted.0, wanted.1);
}

#[derive(Debug, Clone, Serialize)]
struct LineChanged {
    host: String,
    line: LineStatus,
}

fn on_event<R: Runtime>(app: &AppHandle<R>, event: RouteEvent) {
    match event {
        RouteEvent::Line { host, status } => {
            let _ = app.emit(LINE_EVENT, LineChanged { host: host.clone(), line: status.clone() });
            let now = (status.line, status.waiting, status.unreachable);
            let before = app.state::<Routes>().told.lock().expect("route poisoned").insert(host, now);
            if before != Some(now) && status.line.is_some() && !status.waiting && !status.unreachable {
                crate::notify::wake_all(app);
            }
        }
        RouteEvent::Memory { host, memory } => {
            let Some(manager) = app.try_state::<ZoneManager>() else { return };
            manager.remember_route(app, &host, &memory);
        }
        RouteEvent::Port => apply(app),
    }
}

/// This device is in another network, or woke up.
pub async fn network_changed<R: Runtime>(app: &AppHandle<R>) {
    let Some(router) = current() else { return };
    #[cfg(mobile)]
    ensure_listening().await;
    router.network_changed().await;
    if let Some(manager) = app.try_state::<ZoneManager>() {
        manager.sessions.transport().reset();
    }
    crate::notify::wake_all(app);
}

/// The client is about to be on the screen again: its pages ask for things before it is.
#[cfg(mobile)]
pub async fn waking() {
    ensure_listening().await;
}

/// The client is on the screen again, or not any more.
#[cfg(mobile)]
pub async fn shown(shown: bool) {
    let Some(router) = current() else { return };
    router.set_active(shown);
    if shown {
        ensure_listening().await;
        router.network_changed().await;
    }
}

/// The system takes the sockets of an app it put to sleep away.
#[cfg(mobile)]
async fn ensure_listening() {
    let Some(router) = current() else { return };
    let port = router.port();
    if super::proxy::answers(port).await {
        return;
    }
    let mut started = STARTED.lock().expect("route poisoned");
    let Some(started) = started.as_mut() else { return };
    started.listening = None;
    let again = listen(router.clone(), port, started.entry.clone()).or_else(|_| listen(router.clone(), 0, started.entry.clone()));
    match again {
        Ok(listening) => {
            log::info!("[route] listening again");
            let port = listening.port;
            started.listening = Some(listening);
            router.set_port(port);
        }
        Err(error) => log::error!("[route] listening again: {error}"),
    }
}

/// No system says the same way that the network changed or that it slept.
#[cfg(desktop)]
async fn watch<R: Runtime>(app: AppHandle<R>) {
    let mut own = super::net::interfaces();
    let mut seen = std::time::SystemTime::now();
    loop {
        tokio::time::sleep(WATCH_EVERY).await;
        let slept = seen.elapsed().is_ok_and(|gone| gone > WATCH_EVERY * 4);
        seen = std::time::SystemTime::now();
        let now = super::net::interfaces();
        if slept || now != own {
            log::info!("[route] {}", if slept { "woke up" } else { "another network" });
            own = now;
            network_changed(&app).await;
        }
    }
}

// ---- the addresses of a Zone's devices ----

/// A session came to be usable: the devices are read when they have not been for a while.
pub fn session_changed<R: Runtime>(app: &AppHandle<R>, key: &ZoneKey, state: SessionState) {
    if state != SessionState::SignedIn || current().is_none() {
        return;
    }
    let (app, key) = (app.clone(), key.clone());
    tauri::async_runtime::spawn(async move {
        let handle = app.try_state::<ZoneManager>().and_then(|manager| manager.handle_for(&key.account, &key.zone).ok());
        if let Some(handle) = handle {
            read_devices(&app, &handle).await;
        }
    });
}

async fn read_devices<R: Runtime>(app: &AppHandle<R>, handle: &ZoneHandle) {
    let (Some(manager), Some(routes)) = (app.try_state::<ZoneManager>(), app.try_state::<Routes>()) else { return };
    if manager.sessions.status(&handle.key).state != SessionState::SignedIn {
        return;
    }
    {
        let mut read_at = routes.read_at.lock().expect("route poisoned");
        if read_at.get(&handle.key).is_some_and(|at| *at > Instant::now()) {
            return;
        }
        read_at.insert(handle.key.clone(), Instant::now() + READ_FAILED_AGAIN);
    }
    match manager.sessions.call(&handle.key, handle.host(), "control-panel", "zone.devices.list", json!({})).await {
        Ok(answer) => {
            routes.read_at.lock().expect("route poisoned").insert(handle.key.clone(), Instant::now() + READ_AGAIN);
            let devices = known_devices(&answer);
            #[cfg(target_os = "android")]
            if !devices.is_empty() {
                crate::content::mobile::ask_local_network();
            }
            manager.change(app, &handle.key.account, |zones| {
                if let Some(zone) = zones.get_mut(&handle.record.did) {
                    zone.route.devices = devices;
                }
            });
        }
        Err(error) => log::info!("[route] the devices of {}: {error}", handle.host()),
    }
}

/// The devices of `zone.devices.list` with an address of a local network.
fn known_devices(answer: &Value) -> Vec<KnownDevice> {
    let addresses = |device: &Value| {
        let listed = device.get("ips").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str);
        let seen = device.get("endpoints").and_then(Value::as_array).into_iter().flatten().filter_map(|endpoint| endpoint.get("ip")?.as_str());
        let mut addresses: Vec<IpAddr> = Vec::new();
        for address in listed.chain(seen).filter_map(|text| text.parse().ok()) {
            if is_lan(&address) && !addresses.contains(&address) {
                addresses.push(address);
            }
        }
        addresses.sort();
        addresses
    };
    answer
        .get("devices")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|device| {
            Some(KnownDevice {
                name: device.get("name")?.as_str()?.to_string(),
                is_ood: device.get("is_ood").and_then(Value::as_bool).unwrap_or(false),
                ips: addresses(device),
            })
        })
        .filter(|device| !device.ips.is_empty())
        .collect()
}

// ---- the system's browser ----

fn set_browser<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    let (Some(router), Some(routes)) = (current(), app.try_state::<Routes>()) else { return };
    let mut browser = routes.browser.lock().expect("route poisoned");
    browser.enabled = enabled;
    browser.error = None;
    if !enabled {
        browser.listening = None;
    } else if browser.listening.is_none() {
        match listen(router.clone(), BROWSER_PORT, Entry::Browser) {
            Ok(listening) => browser.listening = Some(listening),
            Err(error) => browser.error = Some(error.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserStatus {
    enabled: bool,
    /// Why the script is not there though it is to be: mostly somebody else's port.
    error: Option<String>,
    port: u16,
    address: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RouteStatus {
    /// Whether the pages of this device can take other ways than the system's.
    pages: bool,
    /// Whether the system lets the client at devices in the local network, where it is known.
    local_network: bool,
    platform: &'static str,
    browser: BrowserStatus,
}

fn status(routes: &Routes) -> RouteStatus {
    let browser = routes.browser.lock().expect("route poisoned");
    RouteStatus {
        pages: current().is_some() && pages_supported(),
        local_network: local_network_allowed(),
        platform: crate::content::bridge::PLATFORM,
        browser: BrowserStatus {
            enabled: browser.enabled,
            error: browser.error.clone(),
            port: BROWSER_PORT,
            address: format!("http://127.0.0.1:{BROWSER_PORT}{BROWSER_PATH}"),
        },
    }
}

#[cfg(desktop)]
fn local_network_allowed() -> bool {
    true
}

#[cfg(mobile)]
fn local_network_allowed() -> bool {
    crate::content::mobile::local_network_allowed()
}

#[cfg(desktop)]
fn pages_supported() -> bool {
    super::webview::supported()
}

#[cfg(mobile)]
fn pages_supported() -> bool {
    crate::content::mobile::proxy_supported()
}

#[tauri::command]
pub fn route_status(routes: State<'_, Routes>) -> RouteStatus {
    status(&routes)
}

#[tauri::command]
pub async fn route_set_browser(app: AppHandle, routes: State<'_, Routes>, enabled: bool) -> CommandResult<RouteStatus> {
    set_browser(&app, enabled);
    let store = app.store(STORE_FILE).map_err(|error| CommandErrors::internal(error.to_string()))?;
    store.set(BROWSER_KEY, enabled);
    store.save().map_err(|error| CommandErrors::internal(error.to_string()))?;
    Ok(status(&routes))
}

// ---- about one Zone ----

/// Every way to the Zone and what is wrong with it, tried now.
#[tauri::command]
pub async fn zone_lines(app: AppHandle, manager: State<'_, ZoneManager>, zone: String) -> CommandResult<Vec<Attempt>> {
    let handle = manager.handle(&app, &zone)?;
    Ok(lines_of(handle.host()).await)
}

pub async fn lines_of(host: &str) -> Vec<Attempt> {
    match current() {
        Some(router) => router.diagnose(host).await,
        None => Vec::new(),
    }
}

/// Looks for the Zone in the network this device is in.
#[tauri::command]
pub async fn zone_find(app: AppHandle, manager: State<'_, ZoneManager>, zone: String) -> CommandResult<bool> {
    let handle = manager.handle(&app, &zone)?;
    match current() {
        Some(router) => Ok(router.find(handle.host()).await),
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_local_addresses_of_the_devices() {
        let devices = known_devices(&json!({ "devices": [
            { "name": "ood1", "is_ood": true, "ips": ["203.0.113.7", "192.168.1.8", "fe80::1"], "endpoints": [{ "ip": "192.168.1.8" }, { "ip": "10.1.1.1" }, {}] },
            { "name": "vps", "ips": ["203.0.113.9"] },
            { "name": "laptop", "ips": ["100.64.0.3", "nonsense"], "endpoints": null },
            { "ips": ["192.168.1.9"] },
        ] }));
        let shown: Vec<(&str, bool, Vec<String>)> =
            devices.iter().map(|device| (device.name.as_str(), device.is_ood, device.ips.iter().map(ToString::to_string).collect())).collect();
        assert_eq!(shown, [("ood1", true, vec!["10.1.1.1".to_string(), "192.168.1.8".into()]), ("laptop", false, vec!["100.64.0.3".into()])]);
        assert!(known_devices(&json!({})).is_empty());
    }
}
