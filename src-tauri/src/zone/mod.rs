//! The Zones of the signed-in account: the list, the client's own sessions, and calls into them.
//!
//! Every command names its Zone by DID. The current Zone only decides what the local pages show;
//! no code here takes it as an implied argument.

pub mod api;
pub mod host;
pub mod media;
pub mod registry;
pub mod secret;
pub mod session;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_store::StoreExt;

use crate::did::active_account;
use crate::error::{CommandErrors, CommandResult};
use crate::route::{LineMode, LineStatus, RouteMemory};
use api::{krpc, HttpRequest, ReqwestTransport, ZoneError};
use host::{classify_host, normalize_host, web_url, ZoneHostKind};
use registry::{AccountZones, OwnerZone, Registry, ZoneRecord, ZoneSource};
use secret::SecretStore;
use session::{password_digest, rejected_credential, Credential, LaunchTarget, SessionStatus, Sessions, ZoneKey};

const STORE_FILE: &str = "zones.json";
const STORE_KEY: &str = "registry";
pub const ZONES_CHANGED_EVENT: &str = "zone://changed";
pub const SESSION_CHANGED_EVENT: &str = "zone://session";
const ICON_MAX_BYTES: usize = 256 * 1024;

pub struct ZoneManager {
    registry: Mutex<Registry>,
    pub sessions: Arc<Sessions>,
}

/// One Zone as the local pages see it.
#[derive(Debug, Clone, Serialize)]
pub struct ZoneView {
    #[serde(flatten)]
    pub record: ZoneRecord,
    pub session: SessionStatus,
    pub line: Option<LineStatus>,
}

fn line_of(host: &str) -> Option<LineStatus> {
    crate::route::current().and_then(|router| router.status(host))
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneListView {
    pub account: Option<String>,
    pub zones: Vec<ZoneView>,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct SessionChanged<'a> {
    account: &'a str,
    zone: &'a str,
    session: &'a SessionStatus,
}

/// A Zone on the active account's list, with everything needed to talk to it.
#[derive(Debug, Clone)]
pub struct ZoneHandle {
    pub key: ZoneKey,
    pub record: ZoneRecord,
}

impl ZoneHandle {
    pub fn host(&self) -> &str {
        &self.record.host
    }
}

impl ZoneManager {
    pub fn load<R: Runtime>(app: &AppHandle<R>, secrets: SecretStore) -> Result<Self, Box<dyn std::error::Error>> {
        let registry = match app.store(STORE_FILE) {
            Ok(store) => store
                .get(STORE_KEY)
                .and_then(|value| serde_json::from_value(value).ok())
                .unwrap_or_default(),
            Err(error) => {
                log::error!("[zone] opening the Zone list failed: {error}");
                Registry::default()
            }
        };
        let sessions = Arc::new(Sessions::new(Arc::new(ReqwestTransport::new()?), secrets));
        let handle = app.clone();
        sessions.on_change(move |key, session| {
            let _ = handle.emit(
                SESSION_CHANGED_EVENT,
                SessionChanged { account: &key.account, zone: &key.zone, session },
            );
            crate::route::client::session_changed(&handle, key, session.state);
            crate::notify::sync_soon(&handle);
        });
        Ok(Self { registry: Mutex::new(registry), sessions })
    }

    fn save<R: Runtime>(&self, app: &AppHandle<R>) {
        let value = serde_json::to_value(&*self.registry.lock().expect("zones poisoned"));
        match (app.store(STORE_FILE), value) {
            (Ok(store), Ok(value)) => {
                store.set(STORE_KEY, value);
                if let Err(error) = store.save() {
                    log::error!("[zone] saving the Zone list failed: {error}");
                }
            }
            (Err(error), _) => log::error!("[zone] saving the Zone list failed: {error}"),
            (_, Err(error)) => log::error!("[zone] encoding the Zone list failed: {error}"),
        }
    }

    pub fn change<R: Runtime, T>(&self, app: &AppHandle<R>, account: &str, change: impl FnOnce(&mut AccountZones) -> T) -> T {
        let (result, changed) = {
            let mut registry = self.registry.lock().expect("zones poisoned");
            let zones = registry.accounts.entry(account.to_string()).or_default();
            let before = zones.clone();
            let result = change(zones);
            (result, *zones != before)
        };
        if changed {
            self.save(app);
            let _ = app.emit(ZONES_CHANGED_EVENT, self.view(app));
            crate::content::zones_changed(app);
            crate::route::client::sync(app);
            crate::notify::sync_soon(app);
        }
        result
    }

    /// What was found out about the ways to a Zone.
    pub fn remember_route<R: Runtime>(&self, app: &AppHandle<R>, host: &str, memory: &RouteMemory) {
        let Some(account) = active_account(app) else { return };
        self.change(app, &account, |zones| {
            for zone in zones.zones.iter_mut().filter(|zone| zone.host == host) {
                // The rest is the user's, or was read meanwhile.
                zone.route.local = memory.local;
                zone.route.last_lan = memory.last_lan;
            }
        });
    }

    pub fn account_zones(&self, account: &str) -> AccountZones {
        self.registry
            .lock()
            .expect("zones poisoned")
            .accounts
            .get(account)
            .cloned()
            .unwrap_or_default()
    }

    pub fn view<R: Runtime>(&self, app: &AppHandle<R>) -> ZoneListView {
        let Some(account) = active_account(app) else {
            return ZoneListView { account: None, zones: Vec::new(), current: None };
        };
        let zones = self.account_zones(&account);
        ZoneListView {
            zones: zones
                .visible()
                .map(|record| ZoneView {
                    line: line_of(&record.host),
                    session: self.sessions.status(&ZoneKey { account: account.clone(), zone: record.did.clone() }),
                    record: record.clone(),
                })
                .collect(),
            current: zones.current.clone(),
            account: Some(account),
        }
    }

    pub fn handle<R: Runtime>(&self, app: &AppHandle<R>, zone: &str) -> Result<ZoneHandle, ZoneError> {
        let account = active_account(app).ok_or(ZoneError::NotFound)?;
        self.handle_for(&account, zone)
    }

    pub fn handle_for(&self, account: &str, zone: &str) -> Result<ZoneHandle, ZoneError> {
        let record = self
            .account_zones(account)
            .get(zone)
            .cloned()
            .ok_or(ZoneError::NotFound)?;
        Ok(ZoneHandle {
            key: ZoneKey { account: account.to_string(), zone: zone.to_string() },
            record,
        })
    }

    pub fn handles<R: Runtime>(&self, app: &AppHandle<R>) -> Vec<ZoneHandle> {
        let Some(account) = active_account(app) else {
            return Vec::new();
        };
        self.account_zones(&account)
            .visible()
            .map(|record| ZoneHandle {
                key: ZoneKey { account: account.clone(), zone: record.did.clone() },
                record: record.clone(),
            })
            .collect()
    }

    /// The address to load first so that `target` opens signed in.
    pub async fn launch_url(&self, handle: &ZoneHandle, launch: Option<LaunchTarget>, target: &str) -> Result<String, ZoneError> {
        let url = web_url(target).ok_or_else(|| ZoneError::Protocol(format!("not a page address: {target}")))?;
        let kind = url
            .host_str()
            .and_then(|host| classify_host(host, handle.host()))
            .ok_or_else(|| ZoneError::Protocol("the page is not in this Zone".into()))?;
        let launch = match kind {
            ZoneHostKind::Sub(label) if launch.is_none() => self.launch_target_of(handle, label).await,
            ZoneHostKind::Sub(_) => launch,
            ZoneHostKind::Root | ZoneHostKind::Sys => None,
        };
        if let Some(launch) = launch {
            match self.sessions.app_callback(&handle.key, handle.host(), &launch, target).await {
                Ok(Some(callback)) => return Ok(callback),
                Ok(None) => {}
                Err(error) => return Err(error),
            }
        }
        self.sessions.page_callback(&handle.key, handle.host(), target).await
    }

    /// What a `<label>.<zone>` host belongs to: an app of the user's list, or a system service
    /// with its own origin.
    async fn launch_target_of(&self, handle: &ZoneHandle, label: &str) -> Option<LaunchTarget> {
        let label = label.to_ascii_lowercase();
        if label.starts_with("aiws-") {
            return Some(LaunchTarget::Service("aiworkspace".into()));
        }
        if label == "reflow" {
            return Some(LaunchTarget::Service("nfs-server".into()));
        }
        let list = self
            .sessions
            .call(&handle.key, handle.host(), "control-panel", "apps.list", json!({}))
            .await
            .map_err(|error| log::warn!("[zone] apps.list for a launch failed: {error}"))
            .ok()?;
        list.get("apps")?.as_array()?.iter().find_map(|app| {
            let hosts = app.get("web_hosts")?.as_array()?;
            hosts
                .iter()
                .filter_map(Value::as_str)
                .any(|host| host.eq_ignore_ascii_case(&label))
                .then(|| app.get("app_instance_id")?.as_str().map(str::to_string))
                .flatten()
                .map(LaunchTarget::App)
        })
    }
}

/// Brings the saved sessions of the active account back.
pub fn resume<R: Runtime>(app: &AppHandle<R>) {
    let Some(manager) = app.try_state::<ZoneManager>() else { return };
    for handle in manager.handles(app) {
        let sessions = manager.sessions.clone();
        tauri::async_runtime::spawn(async move { sessions.resume(&handle.key, handle.host()).await });
    }
}

/// Called with a wallet password right after it was proven correct: its digest is the
/// administrator credential of the Zones activated from this client (TODO Z3).
pub fn remember_wallet_password<R: Runtime>(app: &AppHandle<R>, account: &str, username: Option<&str>, password: &str) {
    let Some(username) = username.map(str::trim).filter(|name| !name.is_empty()) else {
        return;
    };
    let Some(manager) = app.try_state::<ZoneManager>() else {
        return;
    };
    manager.sessions.remember_wallet_credential(
        account,
        &Credential { username: username.to_string(), digest: password_digest(username, password) },
    );
}

pub fn forget_account<R: Runtime>(app: &AppHandle<R>, account: &str) {
    let Some(manager) = app.try_state::<ZoneManager>() else {
        return;
    };
    let zones = manager.account_zones(account);
    for record in &zones.zones {
        crate::content::close_zone(app, account, &record.did);
        let key = ZoneKey { account: account.to_string(), zone: record.did.clone() };
        let sessions = manager.sessions.clone();
        let host = record.host.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            crate::content::clear_cookies(&app, &key, &host).await;
            sessions.logout(&key, &host).await;
        });
    }
    manager.sessions.forget_account(account);
    manager.registry.lock().expect("zones poisoned").accounts.remove(account);
    manager.save(app);
    crate::route::client::sync(app);
    let _ = app.emit(ZONES_CHANGED_EVENT, manager.view(app));
}

/// The active identity changed: its own list and current Zone take over.
pub fn account_changed<R: Runtime>(app: &AppHandle<R>) {
    let Some(manager) = app.try_state::<ZoneManager>() else {
        return;
    };
    crate::route::client::sync(app);
    let _ = app.emit(ZONES_CHANGED_EVENT, manager.view(app));
    crate::content::zones_changed(app);
    crate::notify::sync_soon(app);
    resume(app);
}

fn require_account<R: Runtime>(app: &AppHandle<R>) -> CommandResult<String> {
    active_account(app).ok_or_else(|| CommandErrors::not_found("wallet_not_found"))
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ZonePresentation {
    pub hostname: String,
    pub zone_did: String,
    #[serde(default)]
    document: Value,
    #[serde(default)]
    settings: Value,
}

impl ZonePresentation {
    fn text(&self, key: &str) -> Option<String> {
        [&self.settings, &self.document].into_iter().find_map(|fields| {
            fields
                .get(key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
    }
}

async fn presentation(manager: &ZoneManager, host: &str) -> Result<ZonePresentation, ZoneError> {
    let value = krpc(manager.sessions.transport(), host, "control-panel", "zone.presentation.get", json!({}), None).await?;
    serde_json::from_value(value).map_err(|error| ZoneError::Protocol(format!("zone.presentation.get: {error}")))
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneProbe {
    pub did: String,
    pub host: String,
    pub name: Option<String>,
    pub icon: Option<String>,
}

/// Finds a Zone from what the user typed: a host, an https address or a DID.
#[tauri::command]
pub async fn zone_probe(app: AppHandle, manager: State<'_, ZoneManager>, address: String) -> CommandResult<ZoneProbe> {
    probe(&app, &manager, address).await.map(|(found, _)| found)
}

/// With whether the DID's own document says so too.
async fn probe(app: &AppHandle, manager: &ZoneManager, address: String) -> CommandResult<(ZoneProbe, bool)> {
    let address = address.trim();
    let host = if address.starts_with("did:") {
        resolve_zone_host(app, address).await?
    } else if address.contains("://") {
        let url = web_url(address).ok_or_else(|| CommandErrors::ZoneRequestFailed("invalid_zone_address".into()))?;
        url.host_str().unwrap_or_default().to_string()
    } else {
        address.split(['/', '?', '#']).next().unwrap_or_default().to_string()
    };
    let host = normalize_host(&host);
    if host.is_empty() || host.contains(char::is_whitespace) {
        return Err(CommandErrors::ZoneRequestFailed("invalid_zone_address".into()));
    }
    let found = presentation(manager, &host).await?;
    let zone_host = normalize_host(&found.hostname);
    if classify_host(&host, &zone_host).is_none() {
        return Err(CommandErrors::ZoneRequestFailed("zone_host_mismatch".into()));
    }
    if address.starts_with("did:") && found.zone_did != address {
        return Err(CommandErrors::ZoneRequestFailed("zone_did_mismatch".into()));
    }
    // The host speaks for a DID; where the DID's own document can be read it has to agree.
    let confirmed = match resolve_zone_host(app, &found.zone_did).await {
        Ok(resolved) if normalize_host(&resolved) != zone_host => {
            return Err(CommandErrors::ZoneRequestFailed("zone_host_mismatch".into()));
        }
        Ok(_) => true,
        Err(error) => {
            log::info!("[zone] {} could not be resolved: {error}", found.zone_did);
            false
        }
    };
    let probe = ZoneProbe {
        name: found.text("display_name"),
        icon: found.text("icon"),
        did: found.zone_did,
        host: zone_host,
    };
    Ok((probe, confirmed))
}

async fn resolve_zone_host(app: &AppHandle, did: &str) -> CommandResult<String> {
    let document = crate::name_resolution::resolve_document(app, did, Some("zone")).await?;
    document
        .get("hostname")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| CommandErrors::ZoneRequestFailed("zone_without_hostname".into()))
}

#[tauri::command]
pub fn zone_list(app: AppHandle, manager: State<'_, ZoneManager>) -> ZoneListView {
    manager.view(&app)
}

/// The owner document's Zone list, resolved by the page (`resolveZoneBindingSnapshot`). Zones with
/// no session yet try the wallet's own credential.
#[tauri::command]
pub async fn zone_sync_owner(app: AppHandle, manager: State<'_, ZoneManager>, account: String, zones: Vec<OwnerZone>) -> CommandResult<ZoneListView> {
    // Reading the document took a while; the identity may have been switched meanwhile.
    if require_account(&app)? != account {
        return Err(CommandErrors::Canceled);
    }
    let removed = manager.change(&app, &account, |list| list.sync_owner(&zones));
    for zone in removed {
        crate::content::close_zone(&app, &account, &zone.did);
        let key = ZoneKey { account: account.clone(), zone: zone.did };
        crate::content::clear_cookies(&app, &key, &zone.host).await;
        manager.sessions.logout(&key, &zone.host).await;
    }
    for zone in &zones {
        let Ok(handle) = manager.handle_for(&account, &zone.did) else { continue };
        ensure_session(&manager, &handle).await;
        refresh_presentation(&app, &manager, &handle).await;
    }
    Ok(manager.view(&app))
}

async fn ensure_session(manager: &ZoneManager, handle: &ZoneHandle) {
    if handle.record.signed_out {
        return;
    }
    if manager.sessions.credential(&handle.key).is_some() {
        let _ = manager.sessions.check(&handle.key, handle.host()).await;
        return;
    }
    // Only in the account's own Zones: nothing made with the wallet's password goes to anyone else's.
    if handle.record.source != ZoneSource::Owner {
        return;
    }
    let Some(credential) = manager.sessions.wallet_credential(&handle.key.account) else {
        return;
    };
    if let Err(error) = manager.sessions.login_unasked(&handle.key, handle.host(), credential).await {
        log::info!("[zone] the wallet credential does not sign in to {}: {error}", handle.host());
    }
}

async fn refresh_presentation<R: Runtime>(app: &AppHandle<R>, manager: &ZoneManager, handle: &ZoneHandle) {
    match presentation(manager, handle.host()).await {
        Ok(found) if found.zone_did == handle.record.did => {
            manager.change(app, &handle.key.account, |zones| {
                if let Some(zone) = zones.get_mut(&handle.record.did) {
                    zone.name = found.text("display_name");
                    zone.icon = found.text("icon");
                }
            });
        }
        Ok(found) => log::warn!("[zone] {} answers as {}", handle.host(), found.zone_did),
        Err(error) => log::info!("[zone] presentation of {}: {error}", handle.host()),
    }
}

/// Signs in to a Zone by its address; only a Zone that could be signed in to goes on the list.
#[tauri::command]
pub async fn zone_add(app: AppHandle, manager: State<'_, ZoneManager>, address: String, username: String, password: String) -> CommandResult<ZoneView> {
    let account = require_account(&app)?;
    let (probe, confirmed) = probe(&app, &manager, address).await?;
    // A host that only claims to be a Zone already on the list does not get its place.
    let listed = manager.registry.lock().expect("zones poisoned").accounts.get(&account).and_then(|list| {
        list.zones.iter().find(|zone| zone.did == probe.did).map(|zone| zone.host.clone())
    });
    if !confirmed && listed.is_some_and(|host| host != probe.host) {
        return Err(CommandErrors::ZoneRequestFailed("zone_host_mismatch".into()));
    }
    let key = ZoneKey { account: account.clone(), zone: probe.did.clone() };
    let username = username.trim().to_string();
    let credential = Credential { digest: password_digest(&username, &password), username };
    let known = manager.account_zones(&account).get(&probe.did).is_some();
    let before = manager.sessions.credential(&key).map(|known| known.username);
    let user = credential.username.clone();
    if let Err(error) = manager.sessions.login(&key, &probe.host, credential).await {
        if !known {
            manager.sessions.logout(&key, &probe.host).await;
        }
        return Err(login_error(error));
    }
    user_changed(&app, &key, &probe.host, before, &user).await;
    manager.change(&app, &account, |zones| {
        zones.add(&probe.did, &probe.host);
        if let Some(zone) = zones.get_mut(&probe.did) {
            zone.name = probe.name.clone();
            zone.icon = probe.icon.clone();
        }
    });
    zone_view(&app, &manager, &probe.did)
}

/// Another user of the same Zone: nothing of the last one stays on screen or in the cookies.
async fn user_changed(app: &AppHandle, key: &ZoneKey, host: &str, before: Option<String>, user: &str) {
    if before.is_some_and(|before| before != user) {
        crate::content::close_zone(app, &key.account, &key.zone);
        crate::content::clear_cookies(app, key, host).await;
    }
}

fn zone_view(app: &AppHandle, manager: &ZoneManager, zone: &str) -> CommandResult<ZoneView> {
    let handle = manager.handle(app, zone)?;
    Ok(ZoneView { line: line_of(handle.host()), session: manager.sessions.status(&handle.key), record: handle.record })
}

/// Says why the sign-in was refused before the message; the session status has the same reason.
fn login_error(error: ZoneError) -> CommandErrors {
    match error {
        ZoneError::Rpc { .. } => match rejected_credential(&error) {
            Some(reason) => CommandErrors::ZoneLoginFailed(format!("{reason}: {error}")),
            None => CommandErrors::ZoneLoginFailed(error.to_string()),
        },
        other => other.into(),
    }
}

#[tauri::command]
pub async fn zone_login(app: AppHandle, manager: State<'_, ZoneManager>, zone: String, username: String, password: String) -> CommandResult<ZoneView> {
    let handle = manager.handle(&app, &zone)?;
    let username = username.trim().to_string();
    let credential = Credential { digest: password_digest(&username, &password), username };
    let before = manager.sessions.credential(&handle.key).map(|known| known.username);
    let user = credential.username.clone();
    manager
        .sessions
        .login(&handle.key, handle.host(), credential)
        .await
        .map_err(login_error)?;
    manager.change(&app, &handle.key.account, |zones| {
        if let Some(zone) = zones.get_mut(&handle.record.did) {
            zone.signed_out = false;
        }
    });
    user_changed(&app, &handle.key, handle.host(), before, &user).await;
    crate::content::session_restored(&app, &handle);
    zone_view(&app, &manager, &zone)
}

/// Tries to get a usable session again (the network came back, the user asked).
#[tauri::command]
pub async fn zone_reconnect(app: AppHandle, manager: State<'_, ZoneManager>, zone: String) -> CommandResult<ZoneView> {
    let handle = manager.handle(&app, &zone)?;
    ensure_session(&manager, &handle).await;
    refresh_presentation(&app, &manager, &handle).await;
    zone_view(&app, &manager, &zone)
}

#[tauri::command]
pub async fn zone_logout(app: AppHandle, manager: State<'_, ZoneManager>, zone: String) -> CommandResult<()> {
    let handle = manager.handle(&app, &zone)?;
    crate::content::close_zone(&app, &handle.key.account, &zone);
    manager.change(&app, &handle.key.account, |zones| {
        if let Some(zone) = zones.get_mut(&handle.record.did) {
            zone.signed_out = true;
        }
    });
    manager.sessions.logout(&handle.key, handle.host()).await;
    crate::content::clear_cookies(&app, &handle.key, handle.host()).await;
    Ok(())
}

#[tauri::command]
pub async fn zone_remove(app: AppHandle, manager: State<'_, ZoneManager>, zone: String) -> CommandResult<ZoneListView> {
    zone_logout(app.clone(), manager.clone(), zone.clone()).await?;
    let account = require_account(&app)?;
    manager.change(&app, &account, |zones| zones.remove(&zone));
    Ok(manager.view(&app))
}

#[tauri::command]
pub fn zone_set_current(app: AppHandle, manager: State<'_, ZoneManager>, zone: String) -> CommandResult<ZoneListView> {
    let account = require_account(&app)?;
    if !manager.change(&app, &account, |zones| zones.set_current(&zone)) {
        return Err(CommandErrors::ZoneNotFound);
    }
    Ok(manager.view(&app))
}

#[derive(Debug, Deserialize)]
pub struct ZonePatch {
    /// The accent as just read from (or written to) the Zone; `Some(None)` clears it.
    #[serde(default, deserialize_with = "present")]
    accent: Option<Option<String>>,
    #[serde(default)]
    notify: Option<bool>,
    /// Which ways may be taken.
    #[serde(default)]
    line_mode: Option<LineMode>,
}

fn present<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
}

#[tauri::command]
pub fn zone_update(app: AppHandle, manager: State<'_, ZoneManager>, zone: String, patch: ZonePatch) -> CommandResult<ZoneListView> {
    let account = require_account(&app)?;
    let accent = patch.accent.map(|accent| accent.filter(|value| is_color(value)));
    let known = manager.change(&app, &account, |zones| match zones.get_mut(&zone) {
        Some(record) => {
            if let Some(accent) = accent {
                record.accent = accent;
            }
            if let Some(notify) = patch.notify {
                record.notify = notify;
            }
            if let Some(mode) = patch.line_mode {
                record.route.mode = mode;
            }
            true
        }
        None => false,
    });
    if !known {
        return Err(CommandErrors::ZoneNotFound);
    }
    Ok(manager.view(&app))
}

fn is_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
}

/// The WebSDK kRPC client's transport: the request body in, the answer's text out.
#[tauri::command]
pub async fn zone_rpc(app: AppHandle, manager: State<'_, ZoneManager>, zone: String, service: String, body: String) -> CommandResult<String> {
    let handle = manager.handle(&app, &zone)?;
    Ok(manager.sessions.forward(&handle.key, handle.host(), &service, &body).await?)
}

#[derive(Debug, Deserialize)]
pub struct ZoneFetchRequest {
    /// Path and query on the Zone root.
    path: String,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    body_base64: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ZoneFetchResponse {
    status: u16,
    headers: Vec<(String, String)>,
    body_base64: String,
}

#[tauri::command]
pub async fn zone_fetch(app: AppHandle, manager: State<'_, ZoneManager>, zone: String, request: ZoneFetchRequest) -> CommandResult<ZoneFetchResponse> {
    let handle = manager.handle(&app, &zone)?;
    if !request.path.starts_with('/') || request.path.starts_with("//") {
        return Err(CommandErrors::ZoneRequestFailed("path must be on the Zone root".into()));
    }
    let body = match request.body_base64 {
        Some(body) => Some(
            STANDARD
                .decode(body)
                .map_err(|error| CommandErrors::ZoneRequestFailed(error.to_string()))?,
        ),
        None => None,
    };
    let response = manager
        .sessions
        .fetch(
            &handle.key,
            handle.host(),
            HttpRequest {
                method: request.method.unwrap_or_else(|| "GET".into()),
                url: format!("https://{}{}", handle.host(), request.path),
                headers: request.headers,
                body,
            },
        )
        .await?;
    Ok(ZoneFetchResponse {
        status: response.status,
        headers: response.headers,
        body_base64: STANDARD.encode(response.body),
    })
}

/// An image of the Zone (an app icon) as a `data:` address: local pages carry no Zone cookies.
#[tauri::command]
pub async fn zone_image(app: AppHandle, manager: State<'_, ZoneManager>, zone: String, url: String) -> CommandResult<Option<String>> {
    let handle = manager.handle(&app, &zone)?;
    let Some(url) = web_url(&url) else {
        return Ok(None);
    };
    let kind = url.host_str().and_then(|host| classify_host(host, handle.host()));
    let is_root = kind == Some(ZoneHostKind::Root);
    if kind.is_none() {
        return Ok(None);
    }
    let request = HttpRequest { method: "GET".into(), url: url.into(), headers: Vec::new(), body: None };
    // An app's own host must never see the client's session.
    let response = if is_root {
        manager.sessions.fetch(&handle.key, handle.host(), request).await?
    } else {
        manager.sessions.transport().send(request).await?
    };
    let content_type = response
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| value.split(';').next().unwrap_or_default().trim().to_string())
        .unwrap_or_default();
    if response.status != 200 || !content_type.starts_with("image/") || response.body.len() > ICON_MAX_BYTES {
        return Ok(None);
    }
    Ok(Some(format!("data:{content_type};base64,{}", STANDARD.encode(response.body))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_patch_tells_a_cleared_accent_from_an_untouched_one() {
        let patch: ZonePatch = serde_json::from_value(json!({ "accent": null })).unwrap();
        assert_eq!(patch.accent, Some(None));
        let patch: ZonePatch = serde_json::from_value(json!({ "notify": false })).unwrap();
        assert_eq!(patch.accent, None);
        assert_eq!(patch.notify, Some(false));
    }

    #[test]
    fn colors_are_plain_hex() {
        assert!(is_color("#12aBcd"));
        assert!(!is_color("#123"));
        assert!(!is_color("red;}"));
    }

    #[test]
    fn the_settings_win_over_the_document() {
        let presentation: ZonePresentation = serde_json::from_value(json!({
            "hostname": "bob.example", "zone_did": "did:bns:bob",
            "document": { "display_name": "Bob", "icon": "i1" }, "settings": { "display_name": " Bob's home " }
        }))
        .unwrap();
        assert_eq!(presentation.text("display_name").as_deref(), Some("Bob's home"));
        assert_eq!(presentation.text("icon").as_deref(), Some("i1"));
    }
}
