//! Content views: the Zone pages the client shows. On the desktop each one is a native window, on
//! a phone a native WebView; both load the page as their top document, because a Zone's session
//! cookies (`SameSite=Lax`, host-only) are not sent from a frame inside a local page.

#[cfg(desktop)]
pub mod activation;
pub mod bridge;
pub mod policy;
#[cfg(desktop)]
pub mod prompt;
#[cfg(desktop)]
pub mod window_icon;
#[cfg(desktop)]
pub mod windows;
#[cfg(mobile)]
pub mod mobile;
#[cfg(any(mobile, test))]
pub mod shelf;

#[cfg(desktop)]
use windows as platform;
#[cfg(mobile)]
use mobile as platform;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::zone::session::ZoneKey;
use crate::zone::ZoneHandle;

/// Asks the local page to open something: a page address of a listed Zone, or a `buckyos://` link.
pub const OPEN_URL_EVENT: &str = "content://open-url";
/// An app-frame message from a page to its host in the local page.
pub const FRAME_EVENT: &str = "content://frame";
/// Views opened, closed, focused, renamed, navigated.
pub const VIEW_EVENT: &str = "content://view";
/// The user (or the system) asks to close a view; the local page asks the app and answers with
/// `content_close`.
#[cfg(desktop)]
pub const CLOSE_REQUEST_EVENT: &str = "content://close-request";

/// The AppDoc `window` section, as the WebSDK's `readAppWindowDeclaration` completes it.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WindowDeclaration {
    #[serde(default)]
    pub default_mode: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
    #[serde(default)]
    pub min_width: Option<f64>,
    #[serde(default)]
    pub min_height: Option<f64>,
    #[serde(default = "default_true")]
    pub resizable: bool,
    #[serde(default = "default_true")]
    pub allow_minimize: bool,
    #[serde(default = "default_true")]
    pub allow_maximize: bool,
}

fn default_true() -> bool {
    true
}

/// What the local page asks for after the open rules decided to create a view.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenView {
    /// `appWindowId(zone, appInstance, windowPath)`.
    pub id: String,
    pub zone: String,
    pub app: String,
    pub app_instance: String,
    #[serde(default)]
    pub window_path: String,
    /// The page, an https address of that Zone.
    pub url: String,
    pub title: String,
    #[cfg_attr(mobile, allow(dead_code))]
    pub window: WindowDeclaration,
    /// The Zone's name and color, shown on the window when the account has more than one Zone.
    #[serde(default)]
    pub zone_label: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default = "default_presentation")]
    #[cfg_attr(desktop, allow(dead_code))]
    pub presentation: String,
}

fn default_presentation() -> String {
    "window".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewInfo {
    pub id: String,
    pub account: String,
    pub zone: String,
    pub app: String,
    pub app_instance: String,
    pub window_path: String,
    /// Path, query and fragment of the page now shown.
    pub path: Option<String>,
    pub title: String,
    pub last_active: u64,
    pub focused: bool,
    pub minimized: bool,
}

#[cfg(desktop)]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewChanged {
    /// `opened`, `closed`, `changed`, `focused`, `blurred`.
    pub kind: &'static str,
    pub view: ViewInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenUrlRequest {
    pub url: String,
    /// The view the request came from; none for links from outside.
    pub from: Option<String>,
    /// The Zone that view belongs to.
    pub zone: Option<String>,
}

/// The account's Zone list changed: views of Zones that left it go.
pub fn zones_changed<R: Runtime>(app: &AppHandle<R>) {
    platform::zones_changed(app);
}

pub fn close_zone<R: Runtime>(app: &AppHandle<R>, account: &str, zone: &str) {
    platform::close_zone(app, account, zone);
}

/// The Zone has a usable session again: views that were waiting for it go on.
pub fn session_restored<R: Runtime>(app: &AppHandle<R>, handle: &ZoneHandle) {
    platform::session_restored(app, handle);
}

/// Removes what the pages of a Zone stored: on the desktop the cookies of every host of it from the
/// shared WebView store, on a phone the account's profile of the Zone.
pub async fn clear_cookies<R: Runtime>(app: &AppHandle<R>, key: &ZoneKey, zone_host: &str) {
    #[cfg(desktop)]
    let _ = key;
    #[cfg(desktop)]
    platform::clear_cookies(app, zone_host).await;
    #[cfg(mobile)]
    platform::clear_cookies(app, key, zone_host).await;
}
