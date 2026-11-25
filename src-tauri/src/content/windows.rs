//! Content views on the desktop: one native window each.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::webview::{cookie, DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_store::StoreExt;

use super::bridge::{self, BridgeError, Caller, Env};
use super::policy::{self, Navigation, ViewPlace};
use super::{OpenUrlRequest, OpenView, ViewChanged, ViewInfo, CLOSE_REQUEST_EVENT, OPEN_URL_EVENT, VIEW_EVENT};
use crate::error::{CommandErrors, CommandResult};
use crate::zone::api::{now_ms, ZoneError};
use crate::zone::host::{classify_host, web_url, ZoneHostKind};
use crate::zone::session::{LaunchTarget, ZoneKey};
use crate::zone::{ZoneHandle, ZoneManager};

const GEOMETRY_FILE: &str = "windows.json";
const DEFAULT_WIDTH: f64 = 1080.0;
const DEFAULT_HEIGHT: f64 = 720.0;
const CASCADE: f64 = 28.0;
/// A page sent back to the sign-in page this often is not going to get in.
const MAX_SIGN_INS: usize = 3;
/// How long the local page has to take up that a window is to close.
const CLOSE_ANSWER: Duration = Duration::from_secs(5);
const ROOT_OWNERS_KEY: &str = "root_owners";
const SIGN_IN_WINDOW: Duration = Duration::from_secs(30);
const ROOT_REFRESH_COOKIE: &str = "buckyos_refresh_token";
const ROOT_SESSION_COOKIE: &str = "buckyos_session_token";
const ROOT_REFRESH_SECONDS: i64 = 604_800;
const ROOT_SESSION_SECONDS: i64 = 900;

#[derive(Debug, Clone)]
struct View {
    info: ViewInfo,
    /// The app's name as the catalog has it; the title is the page's to choose.
    app_name: String,
    label: String,
    zone_host: String,
    zone_label: Option<String>,
    page_host: String,
    launch: Option<LaunchTarget>,
    /// The page to load once the Zone can be signed in to.
    waiting: Option<String>,
    sign_ins: Vec<Instant>,
    /// Counts loads: a sign-in that finishes after a newer one began is dropped.
    load: u64,
    close_turn: u64,
    /// False from the start of a sign-in until the page it leads to loads.
    arrived: bool,
    /// The host a sign-in the client started leads to, until the page loads.
    arriving: Option<String>,
    closing: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct Geometry {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    maximized: bool,
}

#[derive(Default)]
pub struct ContentViews {
    views: Mutex<HashMap<String, View>>,
    sequence: AtomicU32,
}

impl ContentViews {
    fn get(&self, id: &str) -> Option<View> {
        self.views.lock().expect("views poisoned").get(id).cloned()
    }

    fn update<T>(&self, id: &str, change: impl FnOnce(&mut View) -> T) -> Option<T> {
        self.views.lock().expect("views poisoned").get_mut(id).map(change)
    }

    fn by_label(&self, label: &str) -> Option<View> {
        self.views
            .lock()
            .expect("views poisoned")
            .values()
            .find(|view| view.label == label)
            .cloned()
    }

    fn all(&self) -> Vec<View> {
        self.views.lock().expect("views poisoned").values().cloned().collect()
    }
}

fn views<R: Runtime>(app: &AppHandle<R>) -> State<'_, ContentViews> {
    app.state::<ContentViews>()
}

fn window_of<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<WebviewWindow<R>> {
    let label = views(app).get(id)?.label;
    app.get_webview_window(&label)
}

fn emit_view<R: Runtime>(app: &AppHandle<R>, kind: &'static str, view: ViewInfo) {
    let _ = app.emit_to("main", VIEW_EVENT, ViewChanged { kind, view });
}

fn page_path(url: &Url) -> String {
    let mut path = url.path().to_string();
    if let Some(query) = url.query() {
        path.push('?');
        path.push_str(query);
    }
    if let Some(fragment) = url.fragment() {
        path.push('#');
        path.push_str(fragment);
    }
    path
}

fn place(view: &View) -> ViewPlace<'_> {
    ViewPlace { zone_host: &view.zone_host, page_host: &view.page_host, arriving: view.arriving.as_deref() }
}

fn window_title(title: &str, zone_label: Option<&str>) -> String {
    match zone_label {
        Some(zone) if !zone.is_empty() => format!("{title} — {zone}"),
        _ => title.to_string(),
    }
}

fn geometry_key(info: &ViewInfo) -> String {
    format!("{}|{}", info.zone, info.app_instance)
}

fn saved_geometry<R: Runtime>(app: &AppHandle<R>, key: &str) -> Option<Geometry> {
    let value = app.store(GEOMETRY_FILE).ok()?.get(key)?;
    serde_json::from_value(value).ok()
}

fn remember_geometry<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, key: &str) {
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let (Ok(scale), Ok(position), Ok(size)) = (window.scale_factor(), window.outer_position(), window.inner_size()) else {
        return;
    };
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    if size.width < 50.0 || size.height < 50.0 {
        return;
    }
    let mut geometry = Geometry { x: position.x, y: position.y, width: size.width, height: size.height, maximized };
    if maximized {
        // keep the size to come back to
        match saved_geometry(app, key) {
            Some(saved) => geometry = Geometry { maximized, ..saved },
            None => return,
        }
    }
    if let Ok(store) = app.store(GEOMETRY_FILE) {
        store.set(key, json!(geometry));
    }
}

fn save_geometry<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(store) = app.store(GEOMETRY_FILE) {
        if let Err(error) = store.save() {
            log::warn!("[content] saving window sizes failed: {error}");
        }
    }
}

/// A remembered position counts only while some screen still shows it.
fn on_screen<R: Runtime>(app: &AppHandle<R>, geometry: &Geometry) -> bool {
    let Ok(monitors) = app.available_monitors() else {
        return true;
    };
    monitors.iter().any(|monitor| {
        let scale = monitor.scale_factor();
        let position = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        geometry.x + geometry.width > position.x + 80.0
            && geometry.x < position.x + size.width - 80.0
            && geometry.y >= position.y - 8.0
            && geometry.y < position.y + size.height - 60.0
    })
}

const MAIN_KEY: &str = "main";

/// The main window is a tall panel: its place and height are the user's, its width is not.
pub fn restore_main<R: Runtime>(window: &WebviewWindow<R>) {
    let app = window.app_handle();
    let hidden = std::env::args().any(|argument| argument == "--hidden");
    if hidden {
        let _ = window.hide();
    }
    let Some(saved) = saved_geometry(app, MAIN_KEY) else { return };
    if let (Ok(scale), Ok(size)) = (window.scale_factor(), window.inner_size()) {
        let width = size.to_logical::<f64>(scale).width;
        let _ = window.set_size(tauri::LogicalSize::new(width, saved.height));
    }
    if on_screen(app, &saved) {
        let _ = window.set_position(tauri::LogicalPosition::new(saved.x, saved.y));
    }
}

pub fn remember_main<R: Runtime>(window: &WebviewWindow<R>) {
    if window.is_visible().unwrap_or(true) {
        remember_geometry(window.app_handle(), window, MAIN_KEY);
        save_geometry(window.app_handle());
    }
}

fn local_url<R: Runtime>(app: &AppHandle<R>, fragment: &str) -> Option<Url> {
    let mut url = app.get_webview_window("main")?.url().ok()?;
    url.set_path("/index.html");
    url.set_query(None);
    url.set_fragment(Some(fragment));
    Some(url)
}

fn status_fragment(id: &str, state: &str, detail: &str) -> String {
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("view", id)
        .append_pair("state", state)
        .append_pair("detail", detail)
        .finish();
    format!("/content-status?{query}")
}

fn show_status<R: Runtime>(app: &AppHandle<R>, id: &str, state: &str, detail: &str) {
    let (Some(window), Some(url)) = (window_of(app, id), local_url(app, &status_fragment(id, state, detail))) else {
        return;
    };
    let _ = window.navigate(url);
}

/// Loads a one-time sign-in address. The local page is replaced, so going back never shows it
/// again; any other page must not see the address, and only the local one runs the script.
fn go<R: Runtime>(window: &WebviewWindow<R>, url: &str) {
    let local = window.url().ok().filter(|url| is_local(window.app_handle(), url));
    let result = match (local, Url::parse(url)) {
        (Some(page), _) => {
            let text = |value: String| json!(value).to_string().replace('<', "\\u003c");
            let origin = page.as_str().split('/').take(3).collect::<Vec<_>>().join("/");
            window.eval(format!("if (location.href.startsWith({})) location.replace({})", text(origin + "/"), text(url.to_string())))
        }
        (None, Ok(url)) => window.navigate(url),
        (None, Err(error)) => {
            log::warn!("[content] not an address: {error}");
            return;
        }
    };
    if let Err(error) = result {
        log::warn!("[content] loading a page failed: {error}");
    }
}

/// Signs the view in and loads the page; failures show a local page that says why.
fn start<R: Runtime>(app: &AppHandle<R>, id: &str, target: String) {
    let app = app.clone();
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        let begun = views(&app).update(&id, |view| {
            view.load += 1;
            view.arrived = false;
            view.clone()
        });
        let Some(view) = begun else { return };
        let manager = app.state::<ZoneManager>();
        let result = match manager.handle_for(&view.info.account, &view.info.zone) {
            Ok(handle) => {
                prime_root(&app, &manager, &handle).await;
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
                if host.as_deref() == Some(view.zone_host.as_str()) {
                    let user = manager.sessions.credential(&ZoneKey { account: view.info.account.clone(), zone: view.info.zone.clone() });
                    let user = user.map(|credential| credential.username).unwrap_or_default();
                    set_root_owner(&app, &view.zone_host, &format!("{}|{user}", view.info.account));
                }
                views(&app).update(&id, |view| {
                    view.waiting = None;
                    view.arriving = host;
                });
                if let Some(window) = window_of(&app, &id) {
                    go(&window, &callback);
                }
            }
            Err(error) => {
                log::warn!("[content] opening {target} failed: {error}");
                views(&app).update(&id, |view| view.waiting = Some(target));
                let (state, detail) = match &error {
                    ZoneError::NeedPassword => ("password", String::new()),
                    ZoneError::Network(message) => ("network", message.clone()),
                    ZoneError::Rpc { code: Some(code), .. } if code == "access_denied" => ("denied", String::new()),
                    other => ("error", other.to_string()),
                };
                show_status(&app, &id, state, &detail);
            }
        }
    });
}

fn root_owner<R: Runtime>(app: &AppHandle<R>, host: &str) -> Option<String> {
    let store = app.store(GEOMETRY_FILE).ok()?;
    store.get(ROOT_OWNERS_KEY)?.get(host)?.as_str().map(str::to_string)
}

/// Whose the Zone root's own session cookies are.
fn set_root_owner<R: Runtime>(app: &AppHandle<R>, host: &str, owner: &str) {
    let Ok(store) = app.store(GEOMETRY_FILE) else { return };
    let mut owners = store.get(ROOT_OWNERS_KEY).filter(Value::is_object).unwrap_or_else(|| json!({}));
    owners[host] = json!(owner);
    store.set(ROOT_OWNERS_KEY, owners);
    if let Err(error) = store.save() {
        log::warn!("[content] saving failed: {error}");
    }
}

fn is_root_refresh(cookie: &cookie::Cookie<'_>, host: &str) -> bool {
    cookie.name() == ROOT_REFRESH_COOKIE
        && cookie.domain().is_some_and(|domain| domain.trim_start_matches('.').eq_ignore_ascii_case(host))
}

/// Pages of the Zone root are also framed by apps (the file picker, Preview); they need the root's
/// own session cookies even when no root page was opened yet.
async fn prime_root<R: Runtime>(app: &AppHandle<R>, manager: &ZoneManager, handle: &ZoneHandle) {
    let Some(main) = app.get_webview_window("main") else { return };
    // Not `cookies_for_url`: it keeps the main WebView locked while it waits for the main thread,
    // which may itself be waiting to send that WebView an event.
    let user = manager.sessions.credential(&handle.key).map(|credential| credential.username).unwrap_or_default();
    let owner = format!("{}|{user}", handle.key.account);
    match main.cookies() {
        Ok(cookies) if cookies.iter().any(|cookie| is_root_refresh(cookie, handle.host())) => {
            if root_owner(app, handle.host()).as_deref() == Some(owner.as_str()) {
                return;
            }
            // Another identity's, or another user's.
            clear_cookies(app, handle.host()).await;
        }
        Ok(_) => {}
        Err(error) => {
            log::warn!("[content] reading cookies failed: {error}");
            return;
        }
    }
    let tokens = match manager.sessions.separate_session(&handle.key, handle.host()).await {
        Ok(tokens) => tokens,
        Err(error) => {
            log::info!("[content] no root session for {}: {error}", handle.host());
            return;
        }
    };
    // Signed out or switched while asking: nothing is left behind.
    let wanted = crate::did::active_account(app).as_deref() == Some(handle.key.account.as_str())
        && manager.handle_for(&handle.key.account, &handle.key.zone).is_ok_and(|now| !now.record.signed_out);
    if !wanted {
        return;
    }
    set_root_owner(app, handle.host(), &owner);
    let make = |name: &'static str, value: String, seconds: i64, http_only: bool| {
        cookie::Cookie::build((name, value))
            .domain(handle.host().to_string())
            .path("/")
            .secure(true)
            .http_only(http_only)
            .same_site(cookie::SameSite::Lax)
            .max_age(cookie::time::Duration::seconds(seconds))
            .expires(cookie::time::OffsetDateTime::now_utc() + cookie::time::Duration::seconds(seconds))
            .build()
    };
    for cookie in [
        make(ROOT_SESSION_COOKIE, tokens.session_token, ROOT_SESSION_SECONDS, false),
        make(ROOT_REFRESH_COOKIE, tokens.refresh_token, ROOT_REFRESH_SECONDS, true),
    ] {
        if let Err(error) = main.set_cookie(cookie) {
            log::warn!("[content] setting a cookie failed: {error}");
        }
    }
}

fn open_external<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        log::warn!("[content] opening {url} outside failed: {error}");
    }
}

fn request_open<R: Runtime>(app: &AppHandle<R>, view: &View, url: &Url) {
    let _ = app.emit_to(
        "main",
        OPEN_URL_EVENT,
        OpenUrlRequest {
            url: url.to_string(),
            from: Some(view.info.id.clone()),
            zone: Some(view.info.zone.clone()),
        },
    );
}

fn is_listed<R: Runtime>(app: &AppHandle<R>, account: &str, host: &str) -> bool {
    app.try_state::<ZoneManager>()
        .is_some_and(|manager| manager.account_zones(account).by_host(host).is_some())
}

pub(super) fn is_listed_host<R: Runtime>(app: &AppHandle<R>, host: &str) -> bool {
    crate::did::active_account(app).is_some_and(|account| is_listed(app, &account, host))
}

fn follow<R: Runtime>(app: &AppHandle<R>, view: &View, url: &Url, navigation: Navigation) -> bool {
    match navigation {
        Navigation::Allow => return true,
        Navigation::SignIn(target) => sign_in_again(app, &view.info.id, target),
        Navigation::OpenApp => request_open(app, view, url),
        Navigation::External => open_external(app, url),
        Navigation::DeepLink => crate::deeplink::open(app, url.as_str()),
        Navigation::Block => log::info!("[content] blocked {}", url.scheme()),
    }
    false
}

/// The page lost its session and went to the Zone's sign-in page; the user never sees that page.
fn sign_in_again<R: Runtime>(app: &AppHandle<R>, id: &str, target: Option<Url>) {
    let app = app.clone();
    let id = id.to_string();
    tauri::async_runtime::spawn(async move {
        let now = Instant::now();
        let Some((tries, home)) = views(&app).update(&id, |view| {
            view.sign_ins.retain(|at| now.duration_since(*at) < SIGN_IN_WINDOW);
            view.sign_ins.push(now);
            (view.sign_ins.len(), format!("https://{}/", view.page_host))
        }) else {
            return;
        };
        let target = target.map(String::from).unwrap_or(home);
        log::info!("[content] {id}: signing in again ({tries})");
        if tries > MAX_SIGN_INS {
            views(&app).update(&id, |view| view.waiting = Some(target));
            show_status(&app, &id, "denied", "");
            return;
        }
        start(&app, &id, target);
    });
}

fn build<R: Runtime>(app: &AppHandle<R>, view: &View, request: &OpenView) -> tauri::Result<WebviewWindow<R>> {
    let id = view.info.id.clone();
    let env = Env {
        container: "desktop-app",
        form_factor: "desktop",
        platform: bridge::PLATFORM,
        client_version: &app.package_info().version.to_string(),
        capabilities: bridge::capabilities(),
        zone: &request.zone,
        app: &request.app,
        app_instance: &request.app_instance,
        window_id: &request.id,
        presentation: "window",
        accent: request.accent.as_deref(),
    };
    let declaration = &request.window;
    let key = geometry_key(&view.info);
    let siblings = views(app)
        .all()
        .iter()
        .filter(|other| other.label != view.label && geometry_key(&other.info) == key)
        .count() as f64;
    let saved = saved_geometry(app, &key);
    let declared_width = declaration.width.unwrap_or(DEFAULT_WIDTH);
    let declared_height = declaration.height.unwrap_or(DEFAULT_HEIGHT);
    let (width, height) = match saved {
        Some(saved) if declaration.resizable => (saved.width, saved.height),
        _ => (declared_width, declared_height),
    };
    let maximized = match saved {
        Some(saved) => saved.maximized,
        None => declaration.default_mode.as_deref() == Some("maximized"),
    } && declaration.allow_maximize;

    let navigation_app = app.clone();
    let navigation_id = id.clone();
    let window_app = app.clone();
    let window_id = id.clone();
    let load_id = id.clone();
    let title_id = id.clone();

    let mut builder = WebviewWindowBuilder::new(
        app,
        &view.label,
        WebviewUrl::App(format!("index.html#{}", status_fragment(&id, "loading", "")).into()),
    )
    .title(window_title(&view.info.title, view.zone_label.as_deref()))
    .inner_size(width, height)
    .resizable(declaration.resizable)
    .maximizable(declaration.resizable && declaration.allow_maximize)
    .minimizable(declaration.allow_minimize)
    .maximized(maximized)
    .background_throttling(BackgroundThrottlingPolicy::Disabled)
    .initialization_script(bridge::init_script(&env))
    .on_navigation(move |url| {
        let Some(view) = views(&navigation_app).get(&navigation_id) else {
            return true;
        };
        let navigation = policy::decide(
            &place(&view),
            url,
            main_frame(),
            |host| is_listed(&navigation_app, &view.info.account, host),
        );
        follow(&navigation_app, &view, url, navigation)
    })
    .on_new_window(move |url, _features| {
        if let Some(view) = views(&window_app).get(&window_id) {
            let navigation = policy::decide_new_window(
                &place(&view),
                &url,
                |host| is_listed(&window_app, &view.info.account, host),
            );
            follow(&window_app, &view, &url, navigation);
        }
        NewWindowResponse::Deny
    })
    .on_page_load(move |window, payload| {
        if payload.event() != PageLoadEvent::Started {
            return;
        }
        let app = window.app_handle();
        let url = payload.url();
        let changed = views(app).update(&load_id, |view| {
            let host = url.host_str().unwrap_or_default();
            if classify_host(host, &view.zone_host).is_none() {
                return None;
            }
            view.page_host = host.to_string();
            if url.path() != "/sso_callback" {
                if view.arriving.as_deref().is_none_or(|arriving| arriving.eq_ignore_ascii_case(host)) {
                    view.arrived = true;
                    view.arriving = None;
                }
                view.info.path = Some(page_path(url));
            }
            Some(view.info.clone())
        });
        match changed.flatten() {
            Some(info) => emit_view(app, "changed", info),
            None if matches!(url.scheme(), "http" | "https") && !is_local(app, url) => {
                // Platforms that do not tell frames apart let the page leave; it comes back here.
                leave(app, &load_id, url);
            }
            None => {}
        }
    })
    .on_document_title_changed(move |window, title| {
        let app = window.app_handle();
        let title = title.trim().to_string();
        if title.is_empty() || window.url().is_ok_and(|url| is_local(app, &url)) {
            return;
        }
        set_title(app, &title_id, &title);
    })
    .on_download(|webview, event| on_download(&webview, event));

    if let Some(min_width) = declaration.min_width {
        builder = builder.min_inner_size(min_width, declaration.min_height.unwrap_or(120.0));
    }
    match saved.filter(|saved| on_screen(app, saved)) {
        Some(saved) => builder = builder.position(saved.x + siblings * CASCADE, saved.y + siblings * CASCADE),
        None => builder = builder.center(),
    }
    let window = builder.build()?;

    let event_app = app.clone();
    let event_window = window.clone();
    window.on_window_event(move |event| on_window_event(&event_app, &event_window, &id, event));
    Ok(window)
}

fn is_local<R: Runtime>(app: &AppHandle<R>, url: &Url) -> bool {
    local_url(app, "").is_some_and(|local| local.origin() == url.origin() && local.scheme() == url.scheme())
        || url.scheme() == "tauri"
}

/// A page outside the Zone became the top document: show it in the system browser instead.
fn leave<R: Runtime>(app: &AppHandle<R>, id: &str, url: &Url) {
    let Some(view) = views(app).get(id) else { return };
    let Some(window) = window_of(app, id) else { return };
    if is_listed(app, &view.info.account, url.host_str().unwrap_or_default()) {
        request_open(app, &view, url);
    } else {
        open_external(app, url);
    }
    let _ = window.eval("history.length > 1 ? history.back() : undefined");
}

fn set_title<R: Runtime>(app: &AppHandle<R>, id: &str, title: &str) {
    let changed = views(app).update(id, |view| {
        if view.info.title == title {
            return None;
        }
        view.info.title = title.to_string();
        Some((view.info.clone(), window_title(title, view.zone_label.as_deref())))
    });
    if let Some((info, full)) = changed.flatten() {
        if let Some(window) = window_of(app, id) {
            let _ = window.set_title(&full);
        }
        emit_view(app, "changed", info);
    }
}

fn on_download<R: Runtime>(webview: &tauri::Webview<R>, event: DownloadEvent<'_>) -> bool {
    let app = webview.app_handle();
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Ok(folder) = app.path().download_dir() else {
                return true;
            };
            let name = destination
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .filter(|name| !name.is_empty())
                .or_else(|| url.path_segments().and_then(|mut parts| parts.next_back()).map(str::to_string))
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| "download".into());
            *destination = unused_path(&folder, &name);
        }
        DownloadEvent::Finished { path, success, .. } => {
            let name = path
                .as_ref()
                .and_then(|path| path.file_name())
                .map(|name| name.to_string_lossy().to_string());
            let _ = app.emit_to(
                "main",
                "content://download",
                json!({ "view": views(app).by_label(webview.label()).map(|view| view.info.id), "name": name, "path": path, "success": success }),
            );
        }
        _ => {}
    }
    true
}

fn unused_path(folder: &std::path::Path, name: &str) -> std::path::PathBuf {
    let first = folder.join(name);
    if !first.exists() {
        return first;
    }
    let path = std::path::Path::new(name);
    let stem = path.file_stem().map(|stem| stem.to_string_lossy().to_string()).unwrap_or_default();
    let extension = path.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default();
    (2..10_000)
        .map(|number| folder.join(format!("{stem} ({number}){extension}")))
        .find(|candidate| !candidate.exists())
        .unwrap_or(first)
}

fn on_window_event<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, id: &str, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            let Some(view) = views(app).get(id) else { return };
            remember_geometry(app, window, &geometry_key(&view.info));
            save_geometry(app);
            if !view.closing {
                api.prevent_close();
                request_close(app, id);
            }
        }
        WindowEvent::Focused(focused) => {
            let changed = views(app).update(id, |view| {
                view.info.focused = *focused;
                if *focused {
                    view.info.last_active = now_ms();
                }
                view.info.clone()
            });
            if let Some(info) = changed {
                if !focused {
                    remember_geometry(app, window, &geometry_key(&info));
                    save_geometry(app);
                }
                emit_view(app, if *focused { "focused" } else { "blurred" }, info);
            }
        }
        WindowEvent::Resized(_) => note_minimized(app, window, id),
        WindowEvent::Destroyed => {
            let removed = views(app).views.lock().expect("views poisoned").remove(id);
            if let Some(view) = removed {
                emit_view(app, "closed", view.info);
            }
        }
        _ => {}
    }
}

/// WebView2 does not tell a page that its window is minimized; the page would take what arrives
/// meanwhile for seen.
fn note_minimized<R: Runtime>(app: &AppHandle<R>, window: &WebviewWindow<R>, id: &str) {
    let minimized = window.is_minimized().unwrap_or(false);
    let changed = views(app).update(id, |view| {
        let changed = view.info.minimized != minimized;
        view.info.minimized = minimized;
        changed
    });
    if changed != Some(true) {
        return;
    }
    #[cfg(target_os = "windows")]
    if let Err(error) = window.with_webview(move |webview| {
        if let Err(error) = unsafe { webview.controller().SetIsVisible(!minimized) } {
            log::warn!("[content] page visibility: {error}");
        }
    }) {
        log::warn!("[content] page visibility: {error}");
    }
}

/// Asks the local page, which asks the app; a local page that does not take it up cannot keep the
/// window open.
fn request_close<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if app.get_webview_window("main").is_none() || app.emit_to("main", CLOSE_REQUEST_EVENT, json!({ "view": id })).is_err() {
        destroy(app, id);
        return;
    }
    let turn = views(app).update(id, |view| {
        view.close_turn += 1;
        view.close_turn
    });
    let (app, id) = (app.clone(), id.to_string());
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLOSE_ANSWER).await;
        if turn.is_some() && views(&app).get(&id).map(|view| view.close_turn) == turn {
            log::warn!("[content] the main page did not take up closing {id}");
            destroy(&app, &id);
        }
    });
}

/// The local page is asking the app now.
#[tauri::command]
pub async fn content_closing(app: AppHandle, id: String) -> CommandResult<()> {
    views(&app).update(&id, |view| view.close_turn += 1);
    Ok(())
}

fn destroy<R: Runtime>(app: &AppHandle<R>, id: &str) {
    views(app).update(id, |view| view.closing = true);
    super::prompt::close_where(app, |caller| caller.view == id);
    if let Some(window) = window_of(app, id) {
        let _ = window.destroy();
    }
}

fn focus<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn live_info<R: Runtime>(app: &AppHandle<R>, view: &View) -> ViewInfo {
    let mut info = view.info.clone();
    if let Some(window) = app.get_webview_window(&view.label) {
        info.minimized = window.is_minimized().unwrap_or(false);
        if let Ok(url) = window.url() {
            if classify_host(url.host_str().unwrap_or_default(), &view.zone_host).is_some() {
                info.path = Some(page_path(&url));
            }
        }
    }
    info
}

fn checked_page<R: Runtime>(app: &AppHandle<R>, zone: &str, url: &str) -> CommandResult<(ZoneHandle, Url)> {
    let handle = app.state::<ZoneManager>().handle(app, zone)?;
    let url = web_url(url)
        .filter(|url| classify_host(url.host_str().unwrap_or_default(), handle.host()).is_some())
        .ok_or_else(|| CommandErrors::ZoneRequestFailed("the page is not in this Zone".into()))?;
    Ok((handle, url))
}

#[tauri::command]
pub async fn content_open(app: AppHandle, view: OpenView) -> CommandResult<ViewInfo> {
    let (handle, url) = checked_page(&app, &view.zone, &view.url)?;
    if views(&app).get(&view.id).is_some() {
        return content_focus(app, view.id.clone(), Some(view.url.clone())).await;
    }
    let sequence = views(&app).sequence.fetch_add(1, Ordering::Relaxed) + 1;
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
            focused: true,
            minimized: false,
        },
        app_name: view.title.clone(),
        label: format!("app_{sequence}"),
        zone_host: handle.host().to_string(),
        zone_label: view.zone_label.clone(),
        page_host: url.host_str().unwrap_or_default().to_string(),
        launch: view.app_instance.contains('@').then(|| LaunchTarget::App(view.app_instance.clone())),
        waiting: None,
        arrived: false,
        arriving: None,
        sign_ins: Vec::new(),
        load: 0,
        close_turn: 0,
        closing: false,
    };
    let reserved = match views(&app).views.lock().expect("views poisoned").entry(view.id.clone()) {
        std::collections::hash_map::Entry::Occupied(_) => false,
        std::collections::hash_map::Entry::Vacant(entry) => {
            entry.insert(record.clone());
            true
        }
    };
    if !reserved {
        return content_focus(app, view.id.clone(), Some(view.url.clone())).await;
    }

    let (sender, receiver) = tokio::sync::oneshot::channel();
    let build_app = app.clone();
    let build_view = record.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(build(&build_app, &build_view, &view).map(|window| install_frame_tracking(&window)));
    })
    .map_err(|error| CommandErrors::internal(error.to_string()))?;
    let built = receiver
        .await
        .map_err(|error| CommandErrors::internal(error.to_string()))?;
    if let Err(error) = built {
        views(&app).views.lock().expect("views poisoned").remove(&record.info.id);
        return Err(CommandErrors::internal(format!("window: {error}")));
    }
    emit_view(&app, "opened", record.info.clone());
    start(&app, &record.info.id, url.to_string());
    Ok(record.info)
}

/// Brings a view to the front and, with a page, goes there in it.
#[tauri::command]
pub async fn content_focus(app: AppHandle, id: String, url: Option<String>) -> CommandResult<ViewInfo> {
    let view = views(&app).get(&id).ok_or_else(|| CommandErrors::not_found("view"))?;
    // Just being opened by another click.
    let Some(window) = window_of(&app, &id) else {
        return Ok(view.info);
    };
    if let Some(url) = url {
        let (_, url) = checked_page(&app, &view.info.zone, &url)?;
        if view.arrived && view.waiting.is_none() && url.host_str() == Some(view.page_host.as_str()) {
            window
                .navigate(url)
                .map_err(|error| CommandErrors::internal(error.to_string()))?;
        } else {
            start(&app, &id, url.into());
        }
    }
    focus(&window);
    Ok(live_info(&app, &view))
}

/// Closes a view the app agreed to close.
#[tauri::command]
pub async fn content_close(app: AppHandle, id: String) -> CommandResult<()> {
    destroy(&app, &id);
    Ok(())
}

#[tauri::command]
pub async fn content_list(app: AppHandle) -> Vec<ViewInfo> {
    views(&app).all().iter().map(|view| live_info(&app, view)).collect()
}

/// Hands an event to the page's `BuckyApi.on` handlers.
#[tauri::command]
pub async fn content_emit(app: AppHandle, id: String, event: String, payload: Value) -> CommandResult<()> {
    let window = window_of(&app, &id).ok_or_else(|| CommandErrors::not_found("view"))?;
    window
        .eval(bridge::emit_script(&event, &payload))
        .map_err(|error| CommandErrors::internal(error.to_string()))
}

#[tauri::command]
pub async fn content_set_title(app: AppHandle, id: String, title: String) -> CommandResult<()> {
    set_title(&app, &id, title.trim());
    Ok(())
}

/// The status page of a view asks to try again.
#[tauri::command]
pub async fn content_retry(app: AppHandle, webview: tauri::Webview) -> CommandResult<()> {
    let view = views(&app)
        .by_label(webview.label())
        .ok_or_else(|| CommandErrors::not_found("view"))?;
    let target = view
        .waiting
        .clone()
        .unwrap_or_else(|| format!("https://{}{}", view.page_host, view.info.path.as_deref().unwrap_or("/")));
    views(&app).update(&view.info.id, |view| view.sign_ins.clear());
    show_status(&app, &view.info.id, "loading", "");
    start(&app, &view.info.id, target);
    Ok(())
}

/// The status page of a view asks why the Zone cannot be reached.
#[tauri::command]
pub async fn content_lines(app: AppHandle, webview: tauri::Webview) -> CommandResult<Vec<crate::route::Attempt>> {
    let view = views(&app)
        .by_label(webview.label())
        .ok_or_else(|| CommandErrors::not_found("view"))?;
    Ok(crate::route::client::lines_of(&view.zone_host).await)
}

/// The status page of a view asks the main window to sign in to the view's Zone.
#[tauri::command]
pub async fn content_sign_in(app: AppHandle, webview: tauri::Webview) -> CommandResult<()> {
    let view = views(&app)
        .by_label(webview.label())
        .ok_or_else(|| CommandErrors::not_found("view"))?;
    if let Some(main) = app.get_webview_window("main") {
        focus(&main);
    }
    let _ = app.emit_to("main", "content://sign-in", json!({ "zone": view.info.zone }));
    Ok(())
}

/// The one command a content view's page may call (`capabilities/`); everything else is refused
/// before it gets here.
#[tauri::command]
pub async fn bucky_api_call(
    app: AppHandle,
    webview: tauri::Webview,
    request: tauri::ipc::Request<'_>,
    name: String,
    payload: Option<Value>,
) -> Result<Value, BridgeError> {
    let denied = || BridgeError::new("not_allowed", "this page may not call the client");
    let url = webview.url().map_err(|_| denied())?;
    // WebView2 lets frames send the same request; their origin tells them apart from the page.
    let origin = request.headers().get("origin").and_then(|value| value.to_str().ok());
    if origin.is_some_and(|origin| origin != url.origin().ascii_serialization()) {
        return Err(denied());
    }
    if webview.label().starts_with(super::activation::LABEL_PREFIX) {
        let label = webview.label().to_string();
        return super::activation::call(&app, &label, &url, &name, payload.unwrap_or(Value::Null)).await;
    }
    let view = views(&app).by_label(webview.label()).ok_or_else(denied)?;
    let host = url.host_str().unwrap_or_default();
    // The page is the app's that the view was opened for: the policy lets it go nowhere else.
    let own = url.scheme() == "https"
        && host.eq_ignore_ascii_case(&view.page_host)
        && !matches!(classify_host(host, &view.zone_host), None | Some(ZoneHostKind::Sys));
    if !own || !is_listed(&app, &view.info.account, host) {
        return Err(denied());
    }
    let caller = Caller {
        view: view.info.id,
        account: view.info.account,
        zone: view.info.zone,
        zone_label: view.zone_label.unwrap_or_else(|| view.zone_host.clone()),
        host: view.zone_host,
        activation: false,
        app: view.info.app,
        app_instance: view.info.app_instance,
        title: view.app_name,
    };
    bridge::dispatch(&app, &caller, &name, payload.unwrap_or(Value::Null)).await
}

pub async fn sign_json<R: Runtime>(app: &AppHandle<R>, caller: &Caller, payload: &Value) -> Value {
    super::prompt::sign_json(app, caller, payload).await
}

pub fn zones_changed<R: Runtime>(app: &AppHandle<R>) {
    let (Some(state), Some(manager)) = (app.try_state::<ContentViews>(), app.try_state::<ZoneManager>()) else {
        return;
    };
    let active = crate::did::active_account(app);
    for view in state.all() {
        let listed = manager.account_zones(&view.info.account).get(&view.info.zone).is_some();
        if !listed || active.as_deref() != Some(view.info.account.as_str()) {
            destroy(app, &view.info.id);
        }
    }
    super::activation::account_changed(app, active.as_deref());
    super::prompt::close_where(app, |caller| active.as_deref() != Some(caller.account.as_str()));
    allow_zones(app);
}

pub fn close_zone<R: Runtime>(app: &AppHandle<R>, account: &str, zone: &str) {
    let Some(state) = app.try_state::<ContentViews>() else { return };
    for view in state.all() {
        if view.info.account == account && view.info.zone == zone {
            destroy(app, &view.info.id);
        }
    }
}

pub fn session_restored<R: Runtime>(app: &AppHandle<R>, handle: &ZoneHandle) {
    for view in views(app).all() {
        if view.info.account == handle.key.account && view.info.zone == handle.key.zone {
            if let Some(target) = view.waiting.clone() {
                views(app).update(&view.info.id, |view| view.sign_ins.clear());
                start(app, &view.info.id, target);
            }
        }
    }
}

pub async fn clear_cookies<R: Runtime>(app: &AppHandle<R>, zone_host: &str) {
    let Some(main) = app.get_webview_window("main") else { return };
    let cookies = match main.cookies() {
        Ok(cookies) => cookies,
        Err(error) => {
            log::warn!("[content] reading cookies failed: {error}");
            return;
        }
    };
    for cookie in cookies {
        let domain = cookie.domain().unwrap_or_default().trim_start_matches('.').to_string();
        if classify_host(&domain, zone_host).is_some() {
            if let Err(error) = main.delete_cookie(cookie) {
                log::warn!("[content] deleting a cookie failed: {error}");
            }
        }
    }
}

/// Lets pages of the account's Zones call `bucky_api_call`. A capability can only be added, so a
/// Zone that left the list is refused by the command itself.
pub fn allow_zones<R: Runtime>(app: &AppHandle<R>) {
    static ALLOWED: Mutex<Vec<String>> = Mutex::new(Vec::new());
    let Some(manager) = app.try_state::<ZoneManager>() else { return };
    for handle in manager.handles(app) {
        let host = handle.host().to_string();
        let mut allowed = ALLOWED.lock().expect("allowed hosts poisoned");
        if allowed.contains(&host) {
            continue;
        }
        let capability = tauri::ipc::CapabilityBuilder::new(format!("content-zone-{}", allowed.len()))
            .local(false)
            .remote(format!("https://{host}"))
            .remote(format!("https://*.{host}"))
            .window("app_*")
            .permission("allow-bucky-api-call");
        match app.add_capability(capability) {
            Ok(()) => allowed.push(host),
            Err(error) => log::error!("[content] allowing {host} failed: {error}"),
        }
    }
}

/// Whether the app's window is the one the user is looking at.
pub fn is_app_focused<R: Runtime>(app: &AppHandle<R>, zone: &str, app_id: &str) -> bool {
    app.try_state::<ContentViews>().is_some_and(|state| {
        state
            .all()
            .iter()
            .any(|view| view.info.focused && view.info.zone == zone && view.info.app == app_id)
    })
}

pub fn open_views<R: Runtime>(app: &AppHandle<R>) -> bool {
    !views(app).all().is_empty()
}

// ---- which frame a navigation belongs to ----

pub(super) fn in_subframe() -> bool {
    main_frame() == Some(false)
}

#[cfg(target_os = "windows")]
fn main_frame() -> Option<bool> {
    // WebView2 reports NavigationStarting for the top document only.
    Some(true)
}

#[cfg(target_os = "macos")]
fn main_frame() -> Option<bool> {
    mac_frames::current()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn main_frame() -> Option<bool> {
    None
}

#[cfg(not(target_os = "macos"))]
pub(super) fn install_frame_tracking<R: Runtime>(_window: &WebviewWindow<R>) {}

#[cfg(target_os = "macos")]
pub(super) fn install_frame_tracking<R: Runtime>(window: &WebviewWindow<R>) {
    if let Err(error) = window.with_webview(|webview| mac_frames::install(webview.inner())) {
        log::warn!("[content] frame tracking: {error}");
    }
}

/// WKWebView asks its delegate about every frame's navigation and wry passes only the address on.
/// The delegate's method is wrapped once so that, while wry's handler runs, the kind of frame is
/// known.
#[cfg(target_os = "macos")]
mod mac_frames {
    use objc2::ffi;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, Imp, Sel};
    use objc2::{msg_send, sel};
    use std::cell::Cell;
    use std::ffi::c_void;
    use std::sync::OnceLock;

    thread_local! {
        static MAIN_FRAME: Cell<Option<bool>> = const { Cell::new(None) };
    }

    type Decide = unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject, *mut AnyObject, *mut c_void);
    static ORIGINAL: OnceLock<Decide> = OnceLock::new();

    pub fn current() -> Option<bool> {
        MAIN_FRAME.with(Cell::get)
    }

    unsafe extern "C-unwind" fn decide(this: *mut AnyObject, cmd: Sel, webview: *mut AnyObject, action: *mut AnyObject, handler: *mut c_void) {
        // A navigation without a target frame asks for a new window.
        let frame: Option<Retained<AnyObject>> = msg_send![action, targetFrame];
        let main = match frame {
            Some(frame) => {
                let main: Bool = msg_send![&*frame, isMainFrame];
                main.as_bool()
            }
            None => true,
        };
        MAIN_FRAME.with(|cell| cell.set(Some(main)));
        if let Some(original) = ORIGINAL.get() {
            original(this, cmd, webview, action, handler);
        }
        MAIN_FRAME.with(|cell| cell.set(None));
    }

    pub fn install(webview: *mut c_void) {
        if ORIGINAL.get().is_some() || webview.is_null() {
            return;
        }
        // SAFETY: `webview` is the live WKWebView of a window, on the main thread; the replaced
        // method keeps its type encoding and calls the original.
        unsafe {
            let webview = webview as *mut AnyObject;
            let delegate: Option<Retained<AnyObject>> = msg_send![webview, navigationDelegate];
            let Some(delegate) = delegate else { return };
            let selector = sel!(webView:decidePolicyForNavigationAction:decisionHandler:);
            let Some(method) = delegate.class().instance_method(selector) else { return };
            let replacement: Imp = std::mem::transmute::<Decide, Imp>(decide);
            let original = ffi::method_setImplementation(method as *const _ as *mut _, replacement);
            if let Some(original) = original {
                let _ = ORIGINAL.set(std::mem::transmute::<Imp, Decide>(original));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_its_path_query_and_fragment() {
        assert_eq!(page_path(&Url::parse("https://a.b/c?d=1#e").unwrap()), "/c?d=1#e");
        assert_eq!(page_path(&Url::parse("https://a.b").unwrap()), "/");
    }

    #[test]
    fn the_zone_is_part_of_the_title_when_it_matters() {
        assert_eq!(window_title("Notes", Some("Team")), "Notes — Team");
        assert_eq!(window_title("Notes", None), "Notes");
    }

    #[test]
    fn downloads_do_not_replace_files() {
        let folder = std::env::temp_dir().join(format!("buckyosapp-download-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("a.tar.gz"), b"1").unwrap();
        assert_eq!(unused_path(&folder, "a.tar.gz"), folder.join("a.tar (2).gz"));
        assert_eq!(unused_path(&folder, "b.txt"), folder.join("b.txt"));
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
