//! One native WebView per content view, made and placed by the client plugin of the platform
//! (`ClientPlugin.kt`, `ClientPlugin.swift`), which has the same methods and events on both.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::plugin::mobile::PluginInvokeError;
use tauri::plugin::{PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url, Wry};
use tauri_plugin_opener::OpenerExt;

use super::{platform, ActivationView, Layout, MobileView, MobileViewChanged, NativeStatus, Overlay, Rect, ViewStatus, ACTIVATION_CLOSED_EVENT};
use crate::content::bridge::{self, BridgeError, Caller, Env};
use crate::content::policy::{self, Navigation, ViewPlace};
use crate::content::shelf::{page_path, profile_name, to_discard, Shelved, MAX_KEPT};
use crate::content::{OpenUrlRequest, OpenView, ViewInfo, OPEN_URL_EVENT, VIEW_EVENT};
use crate::error::{CommandErrors, CommandResult};
use crate::json_file::{read_json, write_json};
use crate::zone::api::{now_ms, ZoneError};
use crate::zone::host::{classify_host, web_url, ZoneHostKind};
use crate::zone::session::{LaunchTarget, ZoneKey};
use crate::zone::{ZoneHandle, ZoneManager};

const LABELS_FILE: &str = "native-labels.json";
/// A page sent back to the sign-in page this often is not going to get in.
const MAX_SIGN_INS: usize = 3;
const SIGN_IN_WINDOW: Duration = Duration::from_secs(30);
/// Seconds until a view in front that found no network tries again by itself.
const NETWORK_RETRIES: [u64; 4] = [3, 8, 20, 60];
const OPENED: [&str; 2] = ["focused", "blurred"];
const LAID_OUT: [&str; 2] = ["shown", "hidden"];
const PAGE_KNOWN: Duration = Duration::from_millis(300);
/// The profile of the activation page, and where it goes on the stage.
const ACTIVATION: &str = "activation";
const CRASH_WINDOW: Duration = Duration::from_secs(60);
const ROOT_REFRESH_COOKIE: &str = "buckyos_refresh_token";
const ROOT_SESSION_COOKIE: &str = "buckyos_session_token";
const ROOT_REFRESH_SECONDS: i64 = 604_800;
const ROOT_SESSION_SECONDS: i64 = 900;
const TAB: &str = "tab";

static APP: OnceLock<AppHandle> = OnceLock::new();
/// Asking Tauri for it waits for the UI thread.
static DATA_DIR: OnceLock<std::path::PathBuf> = OnceLock::new();

struct Native(PluginHandle<Wry>);

#[derive(Debug, Clone)]
struct View {
    info: ViewInfo,
    request: OpenView,
    zone_host: String,
    /// Where the app's pages are. Only a load of the client's own, or the AI Workspace, changes it.
    page_host: String,
    /// The host a sign-in of the client's own is about to arrive at.
    arriving: Option<String>,
    launch: Option<LaunchTarget>,
    profile: String,
    status: ViewStatus,
    detail: String,
    /// Has a WebView.
    live: bool,
    /// The page being opened, behind the sign-in round trip.
    target: String,
    /// The page to load once the Zone can be signed in to.
    waiting: Option<String>,
    sign_ins: Vec<Instant>,
    crashed: Option<Instant>,
    /// Failures for lack of network in a row.
    unreachable: usize,
    /// Counts loads: a sign-in that finishes after a newer one began is dropped.
    load: u64,
}

impl View {
    fn shown(&self) -> MobileView {
        MobileView {
            info: self.info.clone(),
            presentation: self.request.presentation.clone(),
            status: self.status,
            detail: self.detail.clone(),
            discarded: !self.live,
        }
    }

    fn place(&self) -> ViewPlace<'_> {
        ViewPlace { zone_host: &self.zone_host, page_host: &self.page_host, arriving: self.arriving.as_deref() }
    }

    fn page(&self) -> String {
        format!("https://{}{}", self.page_host, self.info.path.as_deref().unwrap_or("/"))
    }

    /// The app as the local page named it; what the page calls itself is not for questions about it.
    fn label(&self) -> String {
        match &self.request.zone_label {
            Some(zone) if !zone.is_empty() => format!("{} ({zone})", self.request.title),
            _ => self.request.title.clone(),
        }
    }
}

/// A device's activation page. It belongs to no Zone, so it is not among the views.
#[derive(Debug, Clone)]
struct Activation {
    id: String,
    /// The identity that activates.
    account: String,
    url: Url,
}

impl Activation {
    fn is_here(&self, url: &Url) -> bool {
        self.url.origin() == url.origin()
    }

    fn host(&self) -> String {
        match (self.url.host_str(), self.url.port()) {
            (Some(host), Some(port)) => format!("{host}:{port}"),
            (host, _) => host.unwrap_or_default().to_string(),
        }
    }
}

#[derive(Default)]
struct Inner {
    views: HashMap<String, View>,
    activation: Option<Activation>,
    front: Option<String>,
    /// Where views of each presentation go, as last laid out.
    rects: HashMap<String, Rect>,
    background: Option<String>,
    resumed: bool,
    /// Closed, maybe not yet on the native side.
    closed: Vec<String>,
}

#[derive(Default)]
pub struct ContentViews {
    inner: Mutex<Inner>,
    /// The stage is set one at a time, each time as it is then.
    stage: tokio::sync::Mutex<()>,
}

impl ContentViews {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("views poisoned")
    }

    fn get(&self, id: &str) -> Option<View> {
        self.lock().views.get(id).cloned()
    }

    fn update<T>(&self, id: &str, change: impl FnOnce(&mut View) -> T) -> Option<T> {
        self.lock().views.get_mut(id).map(change)
    }

    fn all(&self) -> Vec<View> {
        self.lock().views.values().cloned().collect()
    }

    fn activation(&self, id: &str) -> Option<Activation> {
        self.lock().activation.clone().filter(|activation| activation.id == id)
    }
}

fn views(app: &AppHandle) -> State<'_, ContentViews> {
    app.state::<ContentViews>()
}

pub(super) fn app() -> Option<&'static AppHandle> {
    APP.get()
}

pub(super) fn spawn(work: impl std::future::Future<Output = ()> + Send + 'static) {
    tauri::async_runtime::spawn(work);
}

/// Asks the native side; its own failures are logged here, the caller decides what they mean.
pub async fn call<T: DeserializeOwned>(method: &str, args: impl Serialize) -> Result<T, BridgeError> {
    let failed = |message: String| BridgeError::new("failed", message);
    let native = app().and_then(|app| app.try_state::<Native>()).ok_or_else(|| failed("not started".into()))?;
    let handle = native.0.clone();
    handle.run_mobile_plugin_async::<T>(method, args).await.map_err(|error| {
        log::warn!("[content] {method}: {error}");
        match error {
            PluginInvokeError::InvokeRejected(rejected) => {
                BridgeError::new(rejected.code.as_deref().unwrap_or("failed"), rejected.message.unwrap_or_default())
            }
            other => failed(other.to_string()),
        }
    })
}

pub(super) async fn tell(method: &str, args: impl Serialize) {
    let _ = call::<Value>(method, args).await;
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("client")
        .setup(|app, api| {
            app.manage(ContentViews::default());
            let _ = APP.set(app.clone());
            app.manage(Native(platform::register(&api)?));
            Ok(())
        })
        .build()
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    views(app).lock().resumed = true;
    let _ = DATA_DIR.set(app.path().app_data_dir()?);
    Ok(())
}

fn emit_view(app: &AppHandle, kind: &'static str, view: MobileView) {
    let _ = app.emit_to("main", VIEW_EVENT, MobileViewChanged { kind, view });
}

/// Changes a view and tells the local page when that shows.
fn change(app: &AppHandle, id: &str, change: impl FnOnce(&mut View)) {
    let changed = views(app).update(id, |view| {
        let before = serde_json::to_value(view.shown()).ok();
        change(view);
        let after = view.shown();
        (serde_json::to_value(&after).ok() != before).then_some(after)
    });
    if let Some(view) = changed.flatten() {
        emit_view(app, "changed", view);
    }
}

// ---- the stage ----

async fn set_stage(app: &AppHandle) {
    let state = views(app);
    let _turn = state.stage.lock().await;
    let args = {
        let inner = state.lock();
        let front = inner.front.as_deref().and_then(|id| inner.views.get(id)).filter(|view| view.live);
        let place = front.and_then(|view| Some((view.info.id.clone(), *inner.rects.get(&view.request.presentation)?)));
        let activation = inner.activation.as_ref().filter(|activation| inner.front.as_ref() == Some(&activation.id));
        let place = place.or_else(|| Some((activation?.id.clone(), *inner.rects.get(ACTIVATION)?)));
        match place {
            Some((id, rect)) => json!({ "view": id, "rect": rect, "background": inner.background }),
            None => json!({ "view": null, "background": inner.background }),
        }
    };
    tell("show", args).await;
}

/// Makes a view (or none) the one in front. `told` are the names of the events: `focused` and
/// `blurred` change what the local page shows, `shown` and `hidden` follow it.
fn set_front(app: &AppHandle, id: Option<&str>, told: [&'static str; 2]) {
    let (old, new) = {
        let state = views(app);
        let mut inner = state.lock();
        if inner.front.as_deref() == id {
            if let Some(view) = id.and_then(|id| inner.views.get_mut(id)) {
                view.info.last_active = now_ms();
            }
            return;
        }
        let old = inner.front.take().and_then(|old| {
            let view = inner.views.get_mut(&old)?;
            view.info.focused = false;
            Some(view.shown())
        });
        let new = id.and_then(|id| {
            let view = inner.views.get_mut(id)?;
            view.info.focused = true;
            view.info.last_active = now_ms();
            Some(view.shown())
        });
        let activation = inner.activation.as_ref().map(|activation| activation.id.clone());
        inner.front = new.as_ref().map(|view| view.info.id.clone()).or(activation.filter(|activation| id == Some(activation)));
        (old, new)
    };
    if let Some(view) = old {
        emit_view(app, told[1], view);
    }
    if let Some(view) = new {
        emit_view(app, told[0], view);
    }
    tell_front(app);
}

/// The notification service does not announce messages the user is reading.
fn tell_front(app: &AppHandle) {
    static TOLD: Mutex<String> = Mutex::new(String::new());
    let zone = {
        let state = views(app);
        let inner = state.lock();
        inner
            .front
            .as_deref()
            .filter(|_| inner.resumed)
            .and_then(|id| inner.views.get(id))
            .filter(|view| view.info.app == "messagehub")
            .map(|view| view.info.zone.clone())
            .unwrap_or_default()
    };
    let mut told = TOLD.lock().expect("front poisoned");
    if *told != zone {
        told.clone_from(&zone);
        platform::front_zone(zone);
    }
}

/// Takes the WebView from views that were not used for long.
fn shelve(app: &AppHandle) {
    let held = crate::audio::held_views();
    let gone = {
        let state = views(app);
        let mut inner = state.lock();
        let front = inner.front.clone();
        let kept: Vec<Shelved> = inner
            .views
            .values()
            .filter(|view| view.live && view.request.presentation != TAB)
            .map(|view| Shelved {
                id: &view.info.id,
                last_active: view.info.last_active,
                held: front.as_deref() == Some(view.info.id.as_str()) || held.contains(&view.info.id),
            })
            .collect();
        let ids = to_discard(&kept, MAX_KEPT);
        for id in &ids {
            if let Some(view) = inner.views.get_mut(id) {
                view.live = false;
                view.load += 1;
            }
        }
        ids
    };
    for id in gone {
        if let Some(view) = views(app).get(&id) {
            emit_view(app, "changed", view.shown());
        }
        spawn(async move { tell("close", json!({ "id": id })).await });
    }
}

// ---- pages ----

/// Gives a view a WebView.
async fn make(app: &AppHandle, view: &View) -> Result<(), BridgeError> {
    let version = app.package_info().version.to_string();
    let script = bridge::init_script(&Env {
        container: "mobile-app",
        form_factor: "mobile",
        platform: bridge::PLATFORM,
        client_version: &version,
        capabilities: bridge::capabilities(),
        zone: &view.info.zone,
        app: &view.info.app,
        app_instance: &view.info.app_instance,
        window_id: &view.info.id,
        presentation: &view.request.presentation,
        accent: view.request.accent.as_deref(),
    });
    call::<Value>(
        "create",
        json!({
            "id": view.info.id,
            "profile": view.profile,
            "zoneHost": view.zone_host,
            "label": view.label(),
            "rules": [format!("https://{}", view.zone_host), format!("https://*.{}", view.zone_host)],
            "script": script,
        }),
    )
    .await?;
    views(app).update(&view.info.id, |view| view.live = true);
    Ok(())
}

/// Signs the view in and loads the page; a failure is the view's status.
fn start(app: &AppHandle, id: &str, target: String) {
    change(app, id, |view| {
        view.load += 1;
        view.target.clone_from(&target);
        view.status = ViewStatus::Loading;
        view.detail.clear();
    });
    let Some(view) = views(app).get(id) else { return };
    let app = app.clone();
    let id = id.to_string();
    spawn(async move {
        let manager = app.state::<ZoneManager>();
        let result = match manager.handle_for(&view.info.account, &view.info.zone) {
            Ok(handle) => {
                prime_root(&app, &manager, &handle, &view).await;
                manager.launch_url(&handle, view.launch.clone(), &target).await
            }
            Err(error) => Err(error),
        };
        if views(&app).get(&id).map(|now| now.load) != Some(view.load) {
            return;
        }
        match result {
            Ok(callback) => {
                let host = Url::parse(&callback).ok().and_then(|url| url.host_str().map(str::to_string));
                views(&app).update(&id, |view| {
                    view.waiting = None;
                    view.arriving = host;
                });
                tell("load", json!({ "id": id, "url": callback })).await;
            }
            Err(error) => {
                log::warn!("[content] opening {target} failed: {error}");
                let (status, detail) = match &error {
                    ZoneError::NeedPassword => (ViewStatus::Password, String::new()),
                    ZoneError::Network(message) => (ViewStatus::Network, message.clone()),
                    ZoneError::Rpc { code: Some(code), .. } if code == "access_denied" => (ViewStatus::Denied, String::new()),
                    other => (ViewStatus::Error, other.to_string()),
                };
                change(&app, &id, |view| {
                    view.waiting = Some(target);
                    view.status = status;
                    view.detail = detail;
                });
                retry_later(&app, &id);
            }
        }
    });
}

/// A view in front that found no network tries again: the first attempt after the network is back
/// may still use a connection that died with it.
fn retry_later(app: &AppHandle, id: &str) {
    let failed = views(app).update(id, |view| {
        let failures = view.unreachable;
        view.unreachable += 1;
        (view.status == ViewStatus::Network).then_some((view.load, failures))
    });
    let Some((load, failures)) = failed.flatten() else { return };
    let delay = NETWORK_RETRIES[failures.min(NETWORK_RETRIES.len() - 1)];
    let (app, id) = (app.clone(), id.to_string());
    spawn(async move {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        let target = {
            let state = views(&app);
            let inner = state.lock();
            let front = inner.resumed && inner.front.as_deref() == Some(id.as_str());
            inner
                .views
                .get(&id)
                .filter(|view| front && view.live && view.load == load && view.status == ViewStatus::Network)
                .map(|view| view.waiting.clone().unwrap_or_else(|| view.page()))
        };
        if let Some(target) = target {
            start(&app, &id, target);
        }
    });
}

/// Pages of the Zone root are also framed by apps (the file picker, Preview); they need the root's
/// own session cookies even when no root page was opened yet.
async fn prime_root(app: &AppHandle, manager: &ZoneManager, handle: &ZoneHandle, view: &View) {
    let profile = &view.profile;
    #[derive(serde::Deserialize)]
    struct Cookies {
        cookies: String,
    }
    let root = format!("https://{}/", handle.host());
    match call::<Cookies>("getCookies", json!({ "profile": profile, "url": root })).await {
        Ok(found) if found.cookies.contains(&format!("{ROOT_REFRESH_COOKIE}=")) => return,
        Ok(_) => {}
        Err(_) => return,
    }
    let tokens = match manager.sessions.separate_session(&handle.key, handle.host()).await {
        Ok(tokens) => tokens,
        Err(error) => {
            log::info!("[content] no root session for {}: {error}", handle.host());
            return;
        }
    };
    // Signed out meanwhile: the profile was cleared and stays so.
    if views(app).get(&view.info.id).is_none() {
        return;
    }
    let cookies = [
        format!("{ROOT_SESSION_COOKIE}={}; Path=/; Secure; SameSite=Lax; Max-Age={ROOT_SESSION_SECONDS}", tokens.session_token),
        format!("{ROOT_REFRESH_COOKIE}={}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={ROOT_REFRESH_SECONDS}", tokens.refresh_token),
    ];
    tell("setCookies", json!({ "profile": profile, "url": root, "cookies": cookies })).await;
}

/// The plugin waits for the UI thread, where this may be called.
fn open_external(app: &AppHandle, url: &Url) {
    let (app, url) = (app.clone(), url.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
            log::warn!("[content] opening {url} outside failed: {error}");
        }
    });
}

fn request_open(app: &AppHandle, view: &View, url: &Url) {
    let _ = app.emit_to(
        "main",
        OPEN_URL_EVENT,
        OpenUrlRequest { url: url.to_string(), from: Some(view.info.id.clone()), zone: Some(view.info.zone.clone()) },
    );
}

fn is_listed(app: &AppHandle, account: &str, host: &str) -> bool {
    app.try_state::<ZoneManager>()
        .is_some_and(|manager| manager.account_zones(account).by_host(host).is_some())
}

/// The page lost its session and went to the Zone's sign-in page; the user never sees that page.
fn sign_in_again(app: &AppHandle, id: &str, target: Option<Url>) {
    let now = Instant::now();
    let tried = views(app).update(id, |view| {
        view.sign_ins.retain(|at| now.duration_since(*at) < SIGN_IN_WINDOW);
        view.sign_ins.push(now);
        (view.sign_ins.len(), view.page())
    });
    let Some((tries, page)) = tried else { return };
    let target = target.map(String::from).unwrap_or(page);
    if tries > MAX_SIGN_INS {
        change(app, id, |view| {
            view.waiting = Some(target);
            view.status = ViewStatus::Denied;
        });
        return;
    }
    start(app, id, target);
}

// ---- from the native side ----

/// Whether a view may go to an address. On the UI thread: nothing here waits.
pub fn on_navigate(id: &str, url: &str, main_frame: bool, new_window: bool) -> bool {
    let Some(app) = app() else { return false };
    let Ok(url) = Url::parse(url) else { return false };
    if let Some(activation) = views(app).activation(id) {
        let stays = !new_window && (!main_frame || activation.is_here(&url) || matches!(url.scheme(), "about" | "blob" | "data"));
        if !stays {
            leave_activation(app, &activation, &url);
        }
        return stays;
    }
    let Some(view) = views(app).get(id) else { return false };
    let listed = |host: &str| is_listed(app, &view.info.account, host);
    let navigation = if new_window {
        policy::decide_new_window(&view.place(), &url, listed)
    } else {
        policy::decide(&view.place(), &url, Some(main_frame), listed)
    };
    follow(app, &view, &url, navigation)
}

/// Does what was decided; whether the view itself goes there.
fn follow(app: &AppHandle, view: &View, url: &Url, navigation: Navigation) -> bool {
    match navigation {
        Navigation::Allow => return true,
        Navigation::SignIn(target) => sign_in_again(app, &view.info.id, target),
        Navigation::OpenApp => request_open(app, view, url),
        Navigation::External => open_external(app, url),
        Navigation::DeepLink => crate::deeplink::open(app, url.as_str()),
        Navigation::Block => log::info!("[content] blocked {}{}", url.host_str().unwrap_or(url.scheme()), url.path()),
    }
    false
}

/// A Zone's page (the one just activated) is the client's to open; the rest is the browser's.
fn leave_activation(app: &AppHandle, activation: &Activation, url: &Url) {
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    if url.scheme() == "https" && is_listed(app, &activation.account, url.host_str().unwrap_or_default()) {
        let _ = app.emit_to("main", OPEN_URL_EVENT, OpenUrlRequest { url: url.to_string(), from: None, zone: None });
    } else {
        open_external(app, url);
    }
}

/// Where a page of the view's Zone is; the sign-in round trip does not count.
fn zone_page(view: &View, url: &Url) -> bool {
    matches!(url.scheme(), "https")
        && classify_host(url.host_str().unwrap_or_default(), &view.zone_host).is_some()
        && url.path() != "/sso_callback"
}

fn at_page(app: &AppHandle, id: &str, url: &str, kind: &str) {
    let Ok(url) = Url::parse(url) else { return };
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    let stop = || {
        let id = id.to_string();
        spawn(async move { tell("stop", json!({ "id": id })).await });
    };
    if let Some(activation) = views(app).activation(id) {
        if !activation.is_here(&url) && kind == "started" {
            stop();
            leave_activation(app, &activation, &url);
        }
        return;
    }
    let Some(view) = views(app).get(id) else { return };
    // Nothing is asked about a form that is posted: the page is there before it is known.
    let navigation = policy::decide(&view.place(), &url, Some(true), |host| is_listed(app, &view.info.account, host));
    if navigation != Navigation::Allow {
        if kind == "started" {
            stop();
            follow(app, &view, &url, navigation);
        }
        return;
    }
    if !zone_page(&view, &url) {
        return;
    }
    let host = url.host_str().unwrap_or_default().to_string();
    let own = classify_host(&host, &view.zone_host) != Some(ZoneHostKind::Sys);
    change(app, id, |view| {
        if own {
            if view.arriving.as_deref() == Some(host.as_str()) {
                view.arriving = None;
            }
            view.page_host = host;
            view.info.path = Some(page_path(&url));
        }
        if kind == "finished" && view.waiting.is_none() {
            view.status = ViewStatus::Ready;
            view.detail.clear();
            view.unreachable = 0;
        }
    });
}

pub fn on_event(text: &str) {
    let Ok(event) = serde_json::from_str::<Value>(text) else { return };
    let string = |key: &str| event.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    let kind = string("kind");
    if platform::own_event(&kind, &event) {
        return;
    }
    let Some(app) = app() else { return };
    let id = string("view");
    match kind.as_str() {
        "started" | "visited" | "finished" => at_page(app, &id, &string("url"), &kind),
        "failed" => on_failed(app, &id, &string("url"), string("detail")),
        "title" => set_title(app, &id, string("title").trim()),
        "gone" => on_gone(app, &id),
        "download" => {
            let _ = app.emit_to(
                "main",
                "content://download",
                json!({ "view": id, "name": event.get("name"), "path": null, "success": event.get("success") }),
            );
        }
        "resumed" | "paused" => {
            platform::nudge(app);
            views(app).lock().resumed = kind == "resumed";
            tell_front(app);
            if kind == "resumed" {
                crate::notify::wake_all(app);
                retry_front(app);
            }
        }
        "online" => {
            if let Some(manager) = app.try_state::<ZoneManager>() {
                manager.sessions.transport().reset();
            }
            crate::notify::wake_all(app);
            retry_front(app);
        }
        "media" => crate::audio::on_media(&id, &string("command")),
        "record" => crate::audio::on_record(&event),
        _ => {}
    }
}

fn on_failed(app: &AppHandle, id: &str, url: &str, detail: String) {
    change(app, id, |view| {
        let own = Url::parse(url).is_ok_and(|url| zone_page(view, &url) && url.host_str() == Some(view.page_host.as_str()));
        view.waiting = Some(if own { url.to_string() } else { view.target.clone() });
        view.status = ViewStatus::Network;
        view.detail = detail;
    });
    retry_later(app, id);
}

fn retry_front(app: &AppHandle) {
    let front = views(app).lock().front.clone();
    if let Some(view) = front.and_then(|id| views(app).get(&id)) {
        if view.live && view.status == ViewStatus::Network {
            start(app, &view.info.id, view.waiting.clone().unwrap_or_else(|| view.page()));
        }
    }
}

/// The renderer of a view ended.
fn on_gone(app: &AppHandle, id: &str) {
    end_activation(app, Some(id));
    let now = Instant::now();
    let front = views(app).lock().front.as_deref() == Some(id);
    let mut again = None;
    change(app, id, |view| {
        let twice = view.crashed.is_some_and(|at| now.duration_since(at) < CRASH_WINDOW);
        view.crashed = Some(now);
        view.live = false;
        view.load += 1;
        if front && !twice {
            again = Some(view.page());
        } else if front {
            view.status = ViewStatus::Error;
            view.detail = "the page ended".into();
            view.waiting = Some(view.page());
        }
    });
    crate::audio::view_gone(id);
    if let Some(page) = again {
        let (app, id) = (app.clone(), id.to_string());
        spawn(async move {
            revive(&app, &id, Some(page)).await;
            set_stage(&app).await;
        });
    }
}

fn set_title(app: &AppHandle, id: &str, title: &str) {
    if !title.is_empty() {
        change(app, id, |view| view.info.title = title.to_string());
    }
}

pub fn on_call(id: String, origin: String, main_frame: bool, message: String, reply_id: i64) {
    let Some(app) = app() else { return };
    spawn(async move {
        #[derive(serde::Deserialize)]
        struct Call {
            id: Value,
            name: String,
            #[serde(default)]
            payload: Value,
        }
        let (call_id, result) = match serde_json::from_str::<Call>(&message) {
            Ok(call) => (call.id.clone(), dispatch(app, &id, &origin, main_frame, &call.name, call.payload).await),
            Err(error) => (Value::Null, Err(BridgeError::new("failed", error.to_string()))),
        };
        let answer = match result {
            Ok(data) => json!({ "id": call_id, "ok": true, "data": data }),
            Err(error) => json!({ "id": call_id, "ok": false, "error": error }),
        };
        tell("reply", json!({ "replyId": reply_id, "json": answer.to_string() })).await;
    });
}

async fn dispatch(app: &AppHandle, id: &str, origin: &str, main_frame: bool, name: &str, payload: Value) -> Result<Value, BridgeError> {
    let denied = || BridgeError::new("not_allowed", "this page may not call the client");
    let url = Url::parse(origin).map_err(|_| denied())?;
    if let Some(activation) = views(app).activation(id) {
        if !main_frame || !activation.is_here(&url) {
            return Err(denied());
        }
        let host = activation.host();
        let caller = Caller {
            view: activation.id,
            account: activation.account,
            zone: String::new(),
            zone_label: host.clone(),
            host,
            activation: true,
            app: String::new(),
            app_instance: String::new(),
            title: String::new(),
        };
        return bridge::dispatch(app, &caller, name, payload).await;
    }
    let host = url.host_str().unwrap_or_default();
    let find = || views(app).get(id).ok_or_else(denied);
    let mut view = find()?;
    if host != view.page_host {
        // The page of a workspace may be heard before it is known that the view went there.
        tokio::time::sleep(PAGE_KNOWN).await;
        view = find()?;
    }
    // The page is the app's that the view was opened for; a page of the Zone's sign-in has no bridge.
    let own = main_frame
        && url.scheme() == "https"
        && host == view.page_host
        && !matches!(classify_host(host, &view.zone_host), None | Some(ZoneHostKind::Sys));
    if !own || !is_listed(app, &view.info.account, host) {
        return Err(denied());
    }
    let caller = Caller {
        view: view.info.id,
        account: view.info.account,
        zone: view.info.zone,
        zone_label: view.request.zone_label.unwrap_or_else(|| view.zone_host.clone()),
        host: view.zone_host,
        activation: false,
        app: view.info.app,
        app_instance: view.info.app_instance,
        title: view.request.title,
    };
    bridge::dispatch(app, &caller, name, payload).await
}

/// Runs a script in a view's page.
pub async fn eval(id: &str, script: String) {
    tell("eval", json!({ "id": id, "script": script })).await;
}

pub fn has_view(id: &str) -> bool {
    app().is_some_and(|app| views(app).get(id).is_some())
}

/// The live views of an app instance.
pub fn views_of(zone: &str, app_instance: &str) -> Vec<String> {
    let Some(app) = app() else { return Vec::new() };
    views(app)
        .all()
        .into_iter()
        .filter(|view| view.live && view.info.zone == zone && view.info.app_instance == app_instance)
        .map(|view| view.info.id)
        .collect()
}

pub fn emit_to_page(payload: impl Serialize + Clone, event: &str) {
    if let Some(app) = app() {
        let _ = app.emit_to("main", event, payload);
    }
}

pub fn data_dir() -> Option<std::path::PathBuf> {
    DATA_DIR.get().cloned()
}

// ---- commands ----

fn checked_page(app: &AppHandle, zone: &str, url: &str) -> CommandResult<(ZoneHandle, Url)> {
    let handle = app.state::<ZoneManager>().handle(app, zone)?;
    let url = web_url(url)
        .filter(|url| classify_host(url.host_str().unwrap_or_default(), handle.host()).is_some())
        .ok_or_else(|| CommandErrors::ZoneRequestFailed("the page is not in this Zone".into()))?;
    Ok((handle, url))
}

fn shown(app: &AppHandle, id: &str) -> CommandResult<MobileView> {
    views(app).get(id).map(|view| view.shown()).ok_or_else(|| CommandErrors::not_found("view"))
}

/// Gives a view its WebView back, with the page it was on or another.
async fn revive(app: &AppHandle, id: &str, url: Option<String>) {
    let Some(view) = views(app).get(id) else { return };
    let page = url.or(view.waiting.clone()).unwrap_or_else(|| view.page());
    match make(app, &view).await {
        Ok(()) => {
            shelve(app);
            start(app, id, page);
        }
        Err(error) => change(app, id, |view| {
            view.status = ViewStatus::Error;
            view.detail = error.message;
            view.waiting = Some(page);
        }),
    }
}

#[tauri::command]
pub async fn content_open(app: AppHandle, view: OpenView) -> CommandResult<MobileView> {
    let (handle, url) = checked_page(&app, &view.zone, &view.url)?;
    if views(&app).get(&view.id).is_some() {
        return content_focus(app, view.id.clone(), Some(view.url.clone())).await;
    }
    let id = view.id.clone();
    let record = View {
        info: ViewInfo {
            id: view.id.clone(),
            account: handle.key.account.clone(),
            zone: view.zone.clone(),
            app: view.app.clone(),
            app_instance: view.app_instance.clone(),
            window_path: view.window_path.clone(),
            path: Some(page_path(&url)),
            title: view.title.clone(),
            last_active: now_ms(),
            focused: false,
            minimized: false,
        },
        zone_host: handle.host().to_string(),
        page_host: url.host_str().unwrap_or_default().to_string(),
        arriving: None,
        launch: view.app_instance.contains('@').then(|| LaunchTarget::App(view.app_instance.clone())),
        profile: profile_name(&handle.key.account, &handle.key.zone),
        request: view,
        status: ViewStatus::Loading,
        detail: String::new(),
        live: false,
        target: url.to_string(),
        waiting: None,
        sign_ins: Vec::new(),
        crashed: None,
        unreachable: 0,
        load: 0,
    };
    views(&app).lock().views.insert(id.clone(), record.clone());
    if let Err(error) = make(&app, &record).await {
        views(&app).lock().views.remove(&id);
        return Err(CommandErrors::internal(format!("view: {}", error.message)));
    }
    emit_view(&app, "opened", shown(&app, &id)?);
    set_front(&app, Some(&id), OPENED);
    shelve(&app);
    start(&app, &id, url.to_string());
    set_stage(&app).await;
    shown(&app, &id)
}

/// Brings a view to the front and, with a page, goes there in it.
#[tauri::command]
pub async fn content_focus(app: AppHandle, id: String, url: Option<String>) -> CommandResult<MobileView> {
    let view = views(&app).get(&id).ok_or_else(|| CommandErrors::not_found("view"))?;
    let url = match url {
        Some(url) => Some(checked_page(&app, &view.info.zone, &url)?.1),
        None => None,
    };
    set_front(&app, Some(&id), OPENED);
    if !view.live {
        revive(&app, &id, url.map(String::from)).await;
    } else if let Some(url) = url {
        if view.waiting.is_none() && view.status == ViewStatus::Ready && url.host_str() == Some(view.page_host.as_str()) {
            tell("goTo", json!({ "id": id, "url": url })).await;
        } else {
            start(&app, &id, url.into());
        }
    }
    set_stage(&app).await;
    shown(&app, &id)
}

#[tauri::command]
pub async fn content_close(app: AppHandle, id: String) -> CommandResult<()> {
    destroy(&app, &id);
    Ok(())
}

#[tauri::command]
pub async fn content_list(app: AppHandle) -> Vec<MobileView> {
    views(&app).all().iter().map(View::shown).collect()
}

/// Hands an event to the page's `BuckyApi.on` handlers.
#[tauri::command]
pub async fn content_emit(app: AppHandle, id: String, event: String, payload: Value) -> CommandResult<()> {
    shown(&app, &id)?;
    eval(&id, bridge::emit_script(&event, &payload)).await;
    Ok(())
}

#[tauri::command]
pub async fn content_set_title(app: AppHandle, id: String, title: String) -> CommandResult<()> {
    set_title(&app, &id, title.trim());
    Ok(())
}

#[tauri::command]
pub async fn content_layout(app: AppHandle, layout: Layout) -> CommandResult<()> {
    let discarded = {
        let state = views(&app);
        let mut inner = state.lock();
        if layout.background.is_some() {
            inner.background = layout.background;
        }
        match &layout.view {
            Some(id) if inner.activation.as_ref().is_some_and(|activation| activation.id == *id) => {
                let rect = layout.rect.ok_or_else(|| CommandErrors::internal("a layout needs a rect"))?;
                inner.rects.insert(ACTIVATION.into(), rect);
                false
            }
            Some(id) => {
                let view = inner.views.get(id).ok_or_else(|| CommandErrors::not_found("view"))?;
                let (presentation, live) = (view.request.presentation.clone(), view.live);
                let rect = layout.rect.ok_or_else(|| CommandErrors::internal("a layout needs a rect"))?;
                inner.rects.insert(presentation, rect);
                !live
            }
            None => false,
        }
    };
    set_front(&app, layout.view.as_deref(), LAID_OUT);
    if discarded {
        if let Some(id) = &layout.view {
            revive(&app, id, None).await;
        }
    }
    set_stage(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn content_overlay(overlay: Overlay) -> CommandResult<()> {
    tell("overlay", overlay).await;
    Ok(())
}

/// One page back in the view's own history; false when there is none.
#[tauri::command]
pub async fn content_back(id: String) -> CommandResult<bool> {
    #[derive(serde::Deserialize)]
    struct Back {
        moved: bool,
    }
    Ok(call::<Back>("back", json!({ "id": id })).await.is_ok_and(|back| back.moved))
}

#[tauri::command]
pub async fn content_retry(app: AppHandle, id: String) -> CommandResult<()> {
    let view = views(&app).get(&id).ok_or_else(|| CommandErrors::not_found("view"))?;
    views(&app).update(&id, |view| view.sign_ins.clear());
    if view.live {
        start(&app, &id, view.waiting.clone().unwrap_or_else(|| view.page()));
    } else {
        revive(&app, &id, None).await;
        set_stage(&app).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn app_to_background() -> CommandResult<()> {
    tell("toBackground", json!({})).await;
    Ok(())
}

/// Texts of what is drawn natively (`Labels.kt` and `Labels.swift` read the file).
#[tauri::command]
pub async fn native_set_labels(labels: serde_json::Map<String, Value>) -> CommandResult<()> {
    let path = data_dir().ok_or_else(|| CommandErrors::internal("no data folder"))?.join(LABELS_FILE);
    let labels = Value::Object(labels);
    if read_json::<Value>(&path).as_ref() == Some(&labels) {
        return Ok(());
    }
    write_json(&path, &labels).map_err(|error| CommandErrors::internal(error.to_string()))?;
    platform::labels_changed().await;
    Ok(())
}

#[tauri::command]
pub async fn native_status() -> CommandResult<NativeStatus> {
    call("status", json!({})).await.map_err(|error: BridgeError| CommandErrors::internal(error.message))
}

#[tauri::command]
pub async fn native_open_settings(page: String) -> CommandResult<()> {
    tell("openSettings", json!({ "page": page })).await;
    Ok(())
}

// ---- a device's activation page ----

/// Opens a device's activation page, with nothing left of the one before. `content_layout` shows it.
#[tauri::command]
pub async fn activation_open(app: AppHandle, url: String, title: String) -> CommandResult<ActivationView> {
    static SEQUENCE: AtomicU32 = AtomicU32::new(0);
    let url = Url::parse(&url)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some() && url.username().is_empty() && url.password().is_none())
        .ok_or_else(|| CommandErrors::not_found("activation_page"))?;
    let account = crate::did::active_account(&app).ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;
    end_activation(&app, None);
    let origin = url.origin().ascii_serialization();
    let failed = |error: BridgeError| CommandErrors::internal(format!("view: {}", error.message));
    call::<Value>("clearProfile", json!({ "profile": ACTIVATION, "origins": [format!("{origin}/")] })).await.map_err(failed)?;
    let id = format!("act_{}", SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1);
    let version = app.package_info().version.to_string();
    let script = bridge::init_script(&Env {
        container: "mobile-app",
        form_factor: "mobile",
        platform: bridge::PLATFORM,
        client_version: &version,
        capabilities: Vec::new(),
        zone: "",
        app: "",
        app_instance: "",
        window_id: &id,
        presentation: "window",
        accent: None,
    });
    let view = json!({ "id": id, "profile": ACTIVATION, "zoneHost": "", "label": title, "rules": [origin], "script": script });
    call::<Value>("create", view).await.map_err(failed)?;
    views(&app).lock().activation = Some(Activation { id: id.clone(), account, url: url.clone() });
    tell("load", json!({ "id": id, "url": url })).await;
    Ok(ActivationView { id })
}

#[tauri::command]
pub async fn activation_close(app: AppHandle, id: String) -> CommandResult<()> {
    end_activation(&app, Some(&id));
    Ok(())
}

/// The given one, or whichever there is.
fn end_activation(app: &AppHandle, id: Option<&str>) {
    let ended = {
        let state = views(app);
        let mut inner = state.lock();
        let ended = inner.activation.take_if(|activation| id.is_none_or(|id| activation.id == id));
        if let Some(activation) = &ended {
            inner.front.take_if(|front| *front == activation.id);
        }
        ended
    };
    let Some(Activation { id, .. }) = ended else { return };
    close_question(&id);
    let _ = app.emit_to("main", ACTIVATION_CLOSED_EVENT, json!({ "id": id }));
    spawn(async move { tell("close", json!({ "id": id })).await });
}

// ---- Zones ----

fn destroy(app: &AppHandle, id: &str) {
    let removed = {
        let state = views(app);
        let mut inner = state.lock();
        let removed = inner.views.remove(id);
        if removed.is_some() {
            inner.closed.push(id.to_string());
            if inner.front.as_deref() == Some(id) {
                inner.front = None;
            }
        }
        removed
    };
    let Some(view) = removed else { return };
    close_question(id);
    crate::audio::view_gone(id);
    emit_view(app, "closed", view.shown());
    tell_front(app);
    let id = id.to_string();
    spawn(async move { tell("close", json!({ "id": id })).await });
}

pub fn zones_changed<R: Runtime>(_app: &AppHandle<R>) {
    let Some(app) = app() else { return };
    let Some(manager) = app.try_state::<ZoneManager>() else { return };
    let account = crate::did::active_account(app);
    let activation = views(app).lock().activation.clone();
    if let Some(activation) = activation.filter(|activation| account.as_ref() != Some(&activation.account)) {
        end_activation(app, Some(&activation.id));
    }
    for view in views(app).all() {
        let listed = manager.account_zones(&view.info.account).get(&view.info.zone).is_some();
        // Another identity's views go too: the phone shows one account at a time.
        if !listed || account.as_deref() != Some(view.info.account.as_str()) {
            destroy(app, &view.info.id);
        }
    }
}

pub fn close_zone<R: Runtime>(_app: &AppHandle<R>, account: &str, zone: &str) {
    let Some(app) = app() else { return };
    for view in views(app).all() {
        if view.info.account == account && view.info.zone == zone {
            destroy(app, &view.info.id);
        }
    }
}

pub fn session_restored<R: Runtime>(_app: &AppHandle<R>, handle: &ZoneHandle) {
    let Some(app) = app() else { return };
    for view in views(app).all() {
        if view.info.account == handle.key.account && view.info.zone == handle.key.zone && view.live {
            if let Some(target) = view.waiting.clone() {
                views(app).update(&view.info.id, |view| view.sign_ins.clear());
                start(app, &view.info.id, target);
            }
        }
    }
}

/// Everything the pages of a Zone stored.
pub async fn clear_cookies<R: Runtime>(_app: &AppHandle<R>, key: &ZoneKey, zone_host: &str) {
    let Some(app) = app() else { return };
    let closed = std::mem::take(&mut views(app).lock().closed);
    for id in closed {
        tell("close", json!({ "id": id })).await;
    }
    let origins = [format!("https://{zone_host}/"), format!("https://sys.{zone_host}/")];
    tell("clearProfile", json!({ "profile": profile_name(&key.account, &key.zone), "origins": origins })).await;
}

/// Whether the app's view is what the user is looking at.
pub fn is_app_focused<R: Runtime>(_app: &AppHandle<R>, zone: &str, app_id: &str) -> bool {
    app().is_some_and(|app| {
        let state = views(app);
        let inner = state.lock();
        inner.resumed
            && inner
                .front
                .as_deref()
                .and_then(|id| inner.views.get(id))
                .is_some_and(|view| view.info.zone == zone && view.info.app == app_id)
    })
}

// ---- signing ----

/// The view whose signature the user is asked for.
static SIGNING: Mutex<Option<String>> = Mutex::new(None);

/// The view that asked is gone: the question goes too, and counts as refused.
fn close_question(view: &str) {
    if SIGNING.lock().expect("signing poisoned").as_deref() == Some(view) {
        spawn(async { tell("signDone", json!({})).await });
    }
}

/// The password is typed into a dialog of the client; the page waits and sees the answer only.
pub async fn sign_json<R: Runtime>(_app: &AppHandle<R>, caller: &Caller, payload: &Value) -> Value {
    #[derive(serde::Deserialize)]
    struct Answer {
        password: Option<String>,
    }
    use crate::did;
    let Some(app) = app() else { return did::bridge_cancelled() };
    let payloads = match did::bridge_sign_payloads(app, payload) {
        Ok(payloads) => payloads,
        Err(failure) => return failure,
    };
    let identity = match did::bridge_identity(app) {
        Some((account, name)) if account == caller.account => if name.is_empty() { account } else { name },
        _ => return did::bridge_cancelled(),
    };
    {
        let mut signing = SIGNING.lock().expect("signing poisoned");
        if signing.is_some() {
            return did::bridge_busy();
        }
        *signing = Some(caller.view.clone());
    }
    // What a Zone calls itself is its own choice; its host is not.
    let zone = if caller.zone_label == caller.host { caller.host.clone() } else { format!("{}, {}", caller.zone_label, caller.host) };
    let content = payloads
        .iter()
        .map(|payload| serde_json::to_string_pretty(payload).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\n\n");
    let mut wrong = false;
    let result = loop {
        let args = json!({
            "zone": zone,
            "app": caller.title,
            "identity": identity,
            "device": caller.activation,
            "content": content,
            "wrong": wrong,
        });
        let password = match call::<Answer>("signPrompt", args).await {
            Ok(Answer { password: Some(password) }) => password,
            Ok(Answer { password: None }) => break did::bridge_cancelled(),
            Err(error) => break did::bridge_failure(error.message),
        };
        let (sign_app, payloads, caller) = (app.clone(), payloads.clone(), caller.clone());
        let signed = tauri::async_runtime::spawn_blocking(move || {
            did::bridge_sign(&sign_app, &caller.account, &password, payloads, caller.activation)
        })
        .await;
        match signed {
            Ok(Ok(answer)) => break answer,
            Ok(Err(CommandErrors::InvalidPassword)) => wrong = true,
            Ok(Err(CommandErrors::Canceled)) => break did::bridge_cancelled(),
            Ok(Err(error)) => break did::bridge_failure(error.message()),
            Err(error) => break did::bridge_failure(error.to_string()),
        }
    };
    tell("signDone", json!({})).await;
    *SIGNING.lock().expect("signing poisoned") = None;
    result
}

pub async fn ask_microphone(view: &str) -> bool {
    #[derive(serde::Deserialize)]
    struct Answer {
        granted: bool,
    }
    call::<Answer>("askMicrophone", json!({ "view": view })).await.is_ok_and(|answer| answer.granted)
}
