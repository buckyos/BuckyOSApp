//! A device's activation page: a page of a device in the local network (or of this computer), in a
//! window of its own. It gets the wallet methods of `window.BuckyApi` and nothing else; it is
//! neither a Zone's page nor a frame of a local one.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use super::bridge::{self, BridgeError, Caller, Env};
use super::{windows, OpenUrlRequest, OPEN_URL_EVENT};
use crate::did;
use crate::error::{CommandErrors, CommandResult};

pub const CLOSED_EVENT: &str = "activation://closed";
pub const LABEL_PREFIX: &str = "act_";
const WIDTH: f64 = 1024.0;
const HEIGHT: f64 = 760.0;

struct Page {
    /// The identity that activates.
    account: String,
    url: Url,
}

#[derive(Default)]
pub struct Activations {
    pages: Mutex<HashMap<String, Page>>,
    sequence: AtomicU32,
}

#[derive(Debug, Serialize)]
pub struct Activation {
    pub id: String,
}

fn same_origin(left: &Url, right: &Url) -> bool {
    left.scheme() == right.scheme() && left.host_str() == right.host_str() && left.port_or_known_default() == right.port_or_known_default()
}

/// Opens the page; the one that is open already with the same address comes to the front.
#[tauri::command]
pub async fn activation_open(app: AppHandle, url: String, title: String) -> CommandResult<Activation> {
    let url = Url::parse(&url)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some() && url.username().is_empty() && url.password().is_none())
        .ok_or_else(|| CommandErrors::not_found("activation_page"))?;
    let (account, _) = did::bridge_identity(&app).ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;
    let state = app.state::<Activations>();
    let open = state
        .pages
        .lock()
        .expect("activations poisoned")
        .iter()
        .find(|(_, page)| page.account == account && same_origin(&page.url, &url))
        .map(|(id, _)| id.clone());
    if let Some(window) = open.as_ref().and_then(|id| app.get_webview_window(id)) {
        let _ = window.set_focus();
        return Ok(Activation { id: open.unwrap_or_default() });
    }
    let id = format!("{LABEL_PREFIX}{}", state.sequence.fetch_add(1, Ordering::Relaxed) + 1);
    allow(&app, &id, &url)?;
    state.pages.lock().expect("activations poisoned").insert(id.clone(), Page { account, url: url.clone() });
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let build_app = app.clone();
    let build_id = id.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(build(&build_app, &build_id, &url, &title));
    })
    .map_err(|error| CommandErrors::internal(error.to_string()))?;
    let built = receiver.await.map_err(|error| CommandErrors::internal(error.to_string()))?;
    if let Err(error) = built {
        state.pages.lock().expect("activations poisoned").remove(&id);
        return Err(CommandErrors::internal(format!("window: {error}")));
    }
    Ok(Activation { id })
}

#[tauri::command]
pub async fn activation_close(app: AppHandle, id: String) -> CommandResult<()> {
    if id.starts_with(LABEL_PREFIX) {
        if let Some(window) = app.get_webview_window(&id) {
            let _ = window.destroy();
        }
    }
    Ok(())
}

fn build<R: Runtime>(app: &AppHandle<R>, id: &str, url: &Url, title: &str) -> tauri::Result<()> {
    let env = Env {
        container: "desktop-app",
        form_factor: "desktop",
        platform: bridge::PLATFORM,
        client_version: &app.package_info().version.to_string(),
        capabilities: Vec::new(),
        zone: "",
        app: "",
        app_instance: "",
        window_id: id,
        presentation: "window",
        accent: None,
    };
    let (navigation_app, navigation_url) = (app.clone(), url.clone());
    let (window_app, window_url) = (app.clone(), url.clone());
    let window = WebviewWindowBuilder::new(app, id, WebviewUrl::External(url.clone()))
        .title(if title.trim().is_empty() { "BuckyOS" } else { title })
        .inner_size(WIDTH, HEIGHT)
        .center()
        .initialization_script(bridge::init_script(&env))
        .on_navigation(move |target| {
            if windows::in_subframe() || same_origin(target, &navigation_url) || matches!(target.scheme(), "about" | "blob" | "data") {
                return true;
            }
            elsewhere(&navigation_app, target);
            false
        })
        .on_new_window(move |target, _features| {
            if !same_origin(&target, &window_url) || target != window_url {
                elsewhere(&window_app, &target);
            }
            NewWindowResponse::Deny
        })
        .build()?;
    windows::install_frame_tracking(&window);
    let (event_app, event_id) = (app.clone(), id.to_string());
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            closed(&event_app, &event_id);
        }
    });
    Ok(())
}

/// A Zone's page (the one just activated) is the client's to open; the rest is the browser's.
fn elsewhere<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    use tauri_plugin_opener::OpenerExt;
    if !matches!(url.scheme(), "http" | "https") {
        return;
    }
    if url.scheme() == "https" && windows::is_listed_host(app, url.host_str().unwrap_or_default()) {
        let request = OpenUrlRequest { url: url.to_string(), from: None, zone: None };
        let _ = app.emit_to("main", OPEN_URL_EVENT, request);
        return;
    }
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        log::warn!("[activation] opening {url} outside failed: {error}");
    }
}

fn closed<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if app.state::<Activations>().pages.lock().expect("activations poisoned").remove(id).is_some() {
        super::prompt::close_where(app, |caller| caller.view == id);
        let _ = app.emit_to("main", CLOSED_EVENT, serde_json::json!({ "id": id }));
    }
}

/// Pages of other identities go when the identity is switched.
pub fn account_changed<R: Runtime>(app: &AppHandle<R>, account: Option<&str>) {
    let Some(state) = app.try_state::<Activations>() else { return };
    let others: Vec<String> = state
        .pages
        .lock()
        .expect("activations poisoned")
        .iter()
        .filter(|(_, page)| Some(page.account.as_str()) != account)
        .map(|(id, _)| id.clone())
        .collect();
    for id in others {
        if let Some(window) = app.get_webview_window(&id) {
            let _ = window.destroy();
        }
    }
}

/// Lets exactly this window, on exactly this origin, call `bucky_api_call`.
fn allow<R: Runtime>(app: &AppHandle<R>, id: &str, url: &Url) -> CommandResult<()> {
    let capability = tauri::ipc::CapabilityBuilder::new(format!("activation-{id}"))
        .local(false)
        .remote(url.origin().ascii_serialization())
        .window(id)
        .permission("allow-bucky-api-call");
    app.add_capability(capability).map_err(|error| CommandErrors::internal(error.to_string()))
}

/// Who calls, when the window really shows the device's page.
pub fn caller<R: Runtime>(app: &AppHandle<R>, label: &str, page: &Url) -> Option<Caller> {
    let state = app.state::<Activations>();
    let pages = state.pages.lock().expect("activations poisoned");
    let known = pages.get(label).filter(|known| same_origin(&known.url, page))?;
    let host = match (page.host_str(), page.port()) {
        (Some(host), Some(port)) => format!("{host}:{port}"),
        (host, _) => host.unwrap_or_default().to_string(),
    };
    Some(Caller {
        view: label.to_string(),
        account: known.account.clone(),
        zone: String::new(),
        zone_label: host.clone(),
        host,
        activation: true,
        app: String::new(),
        app_instance: String::new(),
        title: String::new(),
    })
}

pub async fn call<R: Runtime>(app: &AppHandle<R>, label: &str, page: &Url, name: &str, payload: Value) -> Result<Value, BridgeError> {
    let caller = caller(app, label, page).ok_or_else(|| BridgeError::new("not_allowed", "this page may not call the client"))?;
    bridge::dispatch(app, &caller, name, payload).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_origin_is_scheme_host_and_port() {
        let same = |left: &str, right: &str| same_origin(&Url::parse(left).unwrap(), &Url::parse(right).unwrap());
        assert!(same("http://192.168.1.5:3182/index.html?lang=en", "http://192.168.1.5:3182/other"));
        assert!(same("https://box.example/", "https://box.example:443/a"));
        assert!(!same("http://192.168.1.5:3182/", "http://192.168.1.5/"));
        assert!(!same("http://192.168.1.5:3182/", "https://192.168.1.5:3182/"));
        assert!(!same("http://192.168.1.5:3182/", "http://192.168.1.6:3182/"));
    }
}
