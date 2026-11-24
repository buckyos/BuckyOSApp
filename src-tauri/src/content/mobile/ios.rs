//! Not in this version (TODO Q18): the client's own pages run, Zone pages do not open.

use serde_json::Value;
use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Runtime, Wry};

use super::{ActivationView, Layout, MobileView, NativeStatus, Overlay};
use crate::content::bridge::Caller;
use crate::content::OpenView;
use crate::did;
use crate::error::{CommandErrors, CommandResult};
use crate::zone::secret::SecretStore;
use crate::zone::session::ZoneKey;
use crate::zone::ZoneHandle;

fn unsupported<T>(what: &str) -> CommandResult<T> {
    Err(CommandErrors::Unsupported(what.to_string()))
}

pub fn plugin() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("client").build()
}

pub fn setup(_app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

pub fn secrets<R: Runtime>(_app: &AppHandle<R>) -> SecretStore {
    SecretStore::memory()
}

pub fn zones_changed<R: Runtime>(_app: &AppHandle<R>) {}

pub fn close_zone<R: Runtime>(_app: &AppHandle<R>, _account: &str, _zone: &str) {}

pub fn session_restored<R: Runtime>(_app: &AppHandle<R>, _handle: &ZoneHandle) {}

pub async fn clear_cookies<R: Runtime>(_app: &AppHandle<R>, _key: &ZoneKey, _zone_host: &str) {}

pub fn is_app_focused<R: Runtime>(_app: &AppHandle<R>, _zone: &str, _app_id: &str) -> bool {
    false
}

pub async fn sign_json<R: Runtime>(_app: &AppHandle<R>, _caller: &Caller, _payload: &Value) -> Value {
    did::bridge_failure("unsupported")
}

#[tauri::command]
pub async fn content_open(view: OpenView) -> CommandResult<MobileView> {
    unsupported(&view.id)
}

#[tauri::command]
pub async fn content_focus(id: String, _url: Option<String>) -> CommandResult<MobileView> {
    unsupported(&id)
}

#[tauri::command]
pub async fn content_close(id: String) -> CommandResult<()> {
    unsupported(&id)
}

#[tauri::command]
pub async fn activation_open(_url: String, title: String) -> CommandResult<ActivationView> {
    unsupported(&title)
}

#[tauri::command]
pub async fn activation_close(_id: String) -> CommandResult<()> {
    Ok(())
}

#[tauri::command]
pub async fn content_list() -> Vec<MobileView> {
    Vec::new()
}

#[tauri::command]
pub async fn content_emit(id: String, _event: String, _payload: Value) -> CommandResult<()> {
    unsupported(&id)
}

#[tauri::command]
pub async fn content_set_title(id: String, _title: String) -> CommandResult<()> {
    unsupported(&id)
}

#[tauri::command]
pub async fn content_layout(_layout: Layout) -> CommandResult<()> {
    unsupported("layout")
}

#[tauri::command]
pub async fn content_overlay(_overlay: Overlay) -> CommandResult<()> {
    Ok(())
}

#[tauri::command]
pub async fn content_back(_id: String) -> CommandResult<bool> {
    Ok(false)
}

#[tauri::command]
pub async fn content_retry(id: String) -> CommandResult<()> {
    unsupported(&id)
}

#[tauri::command]
pub async fn app_to_background() -> CommandResult<()> {
    unsupported("background")
}

#[tauri::command]
pub async fn native_set_labels(_labels: serde_json::Map<String, Value>) -> CommandResult<()> {
    Ok(())
}

#[tauri::command]
pub async fn native_status() -> CommandResult<NativeStatus> {
    unsupported("status")
}

#[tauri::command]
pub async fn native_open_settings(page: String) -> CommandResult<()> {
    unsupported(&page)
}
