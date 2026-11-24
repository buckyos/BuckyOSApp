use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, Runtime};
use windows::core::{IInspectable, HSTRING};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

use super::super::model::{Alert, AlertLevel};

const GROUP: &str = "buckyos";

/// Toasts shown, kept so that their click handlers stay alive; a tag's newest replaces the rest.
fn shown() -> &'static Mutex<HashMap<String, ToastNotification>> {
    static SHOWN: OnceLock<Mutex<HashMap<String, ToastNotification>>> = OnceLock::new();
    SHOWN.get_or_init(Mutex::default)
}

/// An unpackaged program shows toasts under an id registered for the user.
fn register<R: Runtime>(app: &AppHandle<R>) -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(|| {
        let id = app.config().identifier.clone();
        let register = || -> Result<(), Box<dyn std::error::Error>> {
            let key = windows_registry::CURRENT_USER.create(format!("Software\\Classes\\AppUserModelId\\{id}"))?;
            key.set_string("DisplayName", "BuckyOS")?;
            let folder = app.path().app_data_dir()?;
            std::fs::create_dir_all(&folder)?;
            let icon = folder.join("notification-icon.png");
            std::fs::write(&icon, include_bytes!("../../../icons/128x128.png"))?;
            key.set_string("IconUri", icon.to_string_lossy().as_ref())?;
            Ok(())
        };
        if let Err(error) = register() {
            log::warn!("[notify] registering for toasts failed: {error}");
        }
        id
    })
}

fn escape(text: &str) -> String {
    text.chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\t'))
        .flat_map(|ch| match ch {
            '&' => "&amp;".chars().collect::<Vec<_>>(),
            '<' => "&lt;".chars().collect(),
            '>' => "&gt;".chars().collect(),
            '"' => "&quot;".chars().collect(),
            other => vec![other],
        })
        .collect()
}

/// Toast tags hold 64 characters.
fn short_tag(tag: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(&Sha256::digest(tag)[..16])
}

pub fn show<R: Runtime>(app: &AppHandle<R>, alert: &Alert) -> Result<(), Box<dyn std::error::Error>> {
    let (audio, duration) = match alert.level {
        AlertLevel::Silent => ("<audio silent=\"true\"/>", "short"),
        AlertLevel::Sound => ("<audio src=\"ms-winsoundevent:Notification.Default\"/>", "short"),
        AlertLevel::Urgent => ("<audio src=\"ms-winsoundevent:Notification.Reminder\"/>", "long"),
    };
    let xml = format!(
        "<toast duration=\"{duration}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text><text placement=\"attribution\">{}</text></binding></visual>{audio}</toast>",
        escape(&alert.title),
        escape(&alert.body),
        escape(super::attribution(alert)),
    );
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&document)?;
    let tag = short_tag(&alert.tag);
    toast.SetTag(&HSTRING::from(&tag))?;
    toast.SetGroup(&HSTRING::from(GROUP))?;
    let clicked_app = app.clone();
    let clicked = alert.clone();
    toast.Activated(&TypedEventHandler::<ToastNotification, IInspectable>::new(move |_, _| {
        super::super::activate(&clicked_app, &clicked);
        Ok(())
    }))?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(register(app)))?;
    notifier.Show(&toast)?;
    let mut shown = shown().lock().expect("toasts poisoned");
    if shown.len() > 64 {
        shown.clear();
    }
    shown.insert(tag, toast);
    Ok(())
}

pub async fn permission<R: Runtime>(_app: &AppHandle<R>) -> Option<bool> {
    None
}

pub async fn request_permission<R: Runtime>(_app: &AppHandle<R>) -> bool {
    true
}
