//! What only iOS has besides the views: the plugin itself (`ClientPlugin.swift`), and the calls of
//! it that do not go through Tauri because the answer is needed at once (may this view go there?).

use serde_json::Value;
use std::ffi::{c_char, CStr};
use tauri::plugin::mobile::PluginInvokeError;
use tauri::plugin::{PluginApi, PluginHandle};
use tauri::{AppHandle, Runtime, Wry};

use super::views;
use crate::zone::secret::SecretStore;

tauri::ios_plugin_binding!(init_plugin_client);

pub(super) fn register(api: &PluginApi<Wry, ()>) -> Result<PluginHandle<Wry>, PluginInvokeError> {
    api.register_ios_plugin(init_plugin_client)
}

pub fn secrets<R: Runtime>(_app: &AppHandle<R>) -> SecretStore {
    SecretStore::system()
}

/// There is no notification service to tell: the client itself hears from the Zones.
pub(super) fn front_zone(_zone: String) {}

pub(super) async fn labels_changed() {}

pub(super) fn own_event(_kind: &str, _event: &Value) -> bool {
    false
}

pub(super) fn nudge(_app: &AppHandle) {}

// ---- from Swift (`ClientBridge.h`), on the main thread ----

fn guarded<T>(default: T, work: impl FnOnce() -> T) -> T {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(work)).unwrap_or_else(|_| {
        log::error!("[ios] a call from Swift panicked");
        default
    })
}

/// SAFETY: a C string that lives through the call, or null.
unsafe fn text(value: *const c_char) -> String {
    if value.is_null() {
        return String::new();
    }
    CStr::from_ptr(value).to_string_lossy().into_owned()
}

/// # Safety
/// `json` is a C string.
#[no_mangle]
pub unsafe extern "C" fn bucky_on_event(json: *const c_char) {
    let json = text(json);
    guarded((), || views::on_event(&json));
}

/// # Safety
/// `view` and `url` are C strings.
#[no_mangle]
pub unsafe extern "C" fn bucky_on_navigate(view: *const c_char, url: *const c_char, main_frame: bool, new_window: bool) -> bool {
    let (view, url) = (text(view), text(url));
    guarded(false, || views::on_navigate(&view, &url, main_frame, new_window))
}

/// # Safety
/// `view`, `origin` and `message` are C strings.
#[no_mangle]
pub unsafe extern "C" fn bucky_on_call(view: *const c_char, origin: *const c_char, main_frame: bool, message: *const c_char, reply_id: i64) {
    let (view, origin, message) = (text(view), text(origin), text(message));
    guarded((), || views::on_call(view, origin, main_frame, message, reply_id));
}
