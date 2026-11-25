//! Content views on a phone: native WebViews below the local pages' own.

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "ios")]
mod ios;
mod views;

#[cfg(target_os = "android")]
use android as platform;
#[cfg(target_os = "ios")]
use ios as platform;

pub use platform::*;
pub use views::*;

use serde::{Deserialize, Serialize};

use super::ViewInfo;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What the local pages show, and where (`content_layout`).
#[derive(Debug, Clone, Deserialize)]
pub struct Layout {
    pub view: Option<String>,
    #[serde(default)]
    pub rect: Option<Rect>,
    #[serde(default)]
    pub background: Option<String>,
}

/// Whose the touches are where a content view shows (`content_overlay`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Overlay {
    #[serde(default)]
    pub modal: bool,
    #[serde(default)]
    pub blocks: Vec<Rect>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewStatus {
    Loading,
    Ready,
    /// The Zone wants its password again.
    Password,
    Network,
    Denied,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileView {
    #[serde(flatten)]
    pub info: ViewInfo,
    pub presentation: String,
    pub status: ViewStatus,
    pub detail: String,
    /// It has no WebView any more and loads again when it comes to the front.
    pub discarded: bool,
}

pub const ACTIVATION_CLOSED_EVENT: &str = "activation://closed";
/// The page of an activation view could not be loaded.
pub const ACTIVATION_FAILED_EVENT: &str = "activation://failed";

#[derive(Debug, Clone, Serialize)]
pub struct ActivationView {
    pub id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MobileViewChanged {
    pub kind: &'static str,
    pub view: MobileView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStatus {
    pub battery_unrestricted: bool,
    pub service_running: bool,
    pub multi_profile: bool,
    pub webview: String,
}
