//! `window.BuckyApi` of a content view, on the client side (doc/BuckyApi.md).
//!
//! Which Zone and app a call comes from is what the client recorded when it opened the view; what
//! the page says about it is not looked at.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Runtime};

use super::FRAME_EVENT;
use crate::did::{self, BUCKY_API_OK};
use crate::error::CommandErrors;

pub const API_SCRIPT: &str = include_str!("../../../public/bucky-api.js");

#[derive(Debug, Clone, Serialize)]
pub struct BridgeError {
    pub code: String,
    pub message: String,
}

impl BridgeError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }

    pub fn unsupported(name: &str) -> Self {
        Self::new("unsupported", format!("{name} is not supported here"))
    }
}

impl From<CommandErrors> for BridgeError {
    fn from(error: CommandErrors) -> Self {
        let code = match error {
            CommandErrors::Canceled => "canceled",
            CommandErrors::InvalidPassword => "denied",
            CommandErrors::Unsupported(_) => "unsupported",
            CommandErrors::NotFound(_) | CommandErrors::ZoneNotFound => "not_found",
            _ => "failed",
        };
        Self::new(code, error.message())
    }
}

/// The view a call came from.
#[derive(Debug, Clone)]
pub struct Caller {
    pub view: String,
    /// The identity the view was opened for.
    pub account: String,
    pub zone: String,
    pub zone_label: String,
    /// The Zone's host; a device's, for its activation page.
    pub host: String,
    /// A device's activation page: only the wallet methods.
    pub activation: bool,
    pub app: String,
    #[cfg_attr(desktop, allow(dead_code))]
    pub app_instance: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Env<'a> {
    pub container: &'static str,
    pub form_factor: &'static str,
    pub platform: &'static str,
    pub client_version: &'a str,
    pub capabilities: Vec<&'static str>,
    pub zone: &'a str,
    pub app: &'a str,
    pub app_instance: &'a str,
    pub window_id: &'a str,
    pub presentation: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent: Option<&'a str>,
}

pub const PLATFORM: &str = if cfg!(target_os = "windows") {
    "windows"
} else if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(target_os = "android") {
    "android"
} else if cfg!(target_os = "ios") {
    "ios"
} else {
    "linux"
};

pub fn capabilities() -> Vec<&'static str> {
    let mut list = vec!["app.open"];
    if cfg!(desktop) {
        list.extend(["notify.system", "window.native", "audio.background", "media.session"]);
    }
    if cfg!(target_os = "android") {
        list.extend(["notify.system", "audio.background", "audio.record", "header.native"]);
    }
    // Nothing is shown by the system there (notify/alerts/ios.rs).
    if cfg!(target_os = "ios") {
        list.extend(["audio.background", "audio.record", "header.native"]);
    }
    list
}

/// Runs before any script of the page: the environment first, then the bridge that reads it.
pub fn init_script(env: &Env) -> String {
    let env = serde_json::to_string(env)
        .unwrap_or_else(|_| "null".into())
        // a `</script>` or a line separator must not end the script early
        .replace('<', "\\u003c")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    format!(
        "if (window.top === window) Object.defineProperty(window, \"__BUCKY_ENV__\", {{ value: {env} }});\n{API_SCRIPT}"
    )
}

/// Text for a question of the client: characters that are not seen, or that change the order of
/// others, are written out (`payload.ts` does the same for the desktop's window).
#[cfg_attr(desktop, allow(dead_code))]
pub fn visible(text: &str) -> String {
    let hidden = |ch: char| {
        matches!(ch, '\u{0}'..='\u{8}' | '\u{b}'..='\u{1f}' | '\u{7f}'..='\u{9f}' | '\u{ad}' | '\u{200b}'..='\u{200f}'
            | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}')
    };
    text.chars().fold(String::with_capacity(text.len()), |mut shown, ch| {
        if hidden(ch) {
            shown.push_str(&format!("\\u{:04x}", ch as u32));
        } else {
            shown.push(ch);
        }
        shown
    })
}

/// The script that hands an event to the page's `BuckyApi.on` handlers.
pub fn emit_script(event: &str, payload: &Value) -> String {
    let text = |value: String| value.replace('<', "\\u003c").replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029");
    format!(
        "window.__buckyEmit && window.__buckyEmit({}, {});",
        text(json!(event).to_string()),
        text(payload.to_string())
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameMessage<'a> {
    view: &'a str,
    zone: &'a str,
    message: &'a Value,
}

const WALLET_METHODS: &[&str] = &["getPublicKey", "getCurrentUser", "resolve_did", "openExternalUrl", "signJsonWithActiveDid"];

/// One call of a page. The wallet methods keep their `{ code, data, message }` answers; the rest
/// answer data or fail with a code.
pub async fn dispatch<R: Runtime>(app: &AppHandle<R>, caller: &Caller, name: &str, payload: Value) -> Result<Value, BridgeError> {
    if caller.activation && !WALLET_METHODS.contains(&name) {
        return Err(BridgeError::unsupported(name));
    }
    if did::active_account(app).as_deref() != Some(caller.account.as_str()) {
        return Err(BridgeError::new("not_allowed", "the identity was switched"));
    }
    match name {
        "frame.post" => {
            app.emit_to("main", FRAME_EVENT, FrameMessage { view: &caller.view, zone: &caller.zone, message: &payload })
                .map_err(|error| BridgeError::new("failed", error.to_string()))?;
            Ok(Value::Null)
        }
        "getPublicKey" => Ok(did::bridge_public_key(app)),
        "getCurrentUser" => Ok(did::bridge_current_user(app).await),
        "resolve_did" => Ok(did::bridge_resolve(app, &payload).await),
        "openExternalUrl" => Ok(open_external(app, &payload)),
        "signJsonWithActiveDid" => Ok(super::platform::sign_json(app, caller, &payload).await),
        _ if name.starts_with("audio.") => crate::audio::dispatch(app, caller, name, payload).await,
        _ => Err(BridgeError::unsupported(name)),
    }
}

fn open_external<R: Runtime>(app: &AppHandle<R>, payload: &Value) -> Value {
    use tauri_plugin_opener::OpenerExt;
    let raw = payload.get("url").and_then(Value::as_str).map(str::trim).unwrap_or_default();
    let with_scheme = if raw.contains("://") { raw.to_string() } else { format!("https://{raw}") };
    match reqwest::Url::parse(&with_scheme) {
        Ok(url) if matches!(url.scheme(), "http" | "https") && !raw.is_empty() => {
            match app.opener().open_url(url.as_str(), None::<&str>) {
                Ok(()) => json!({ "code": BUCKY_API_OK, "data": { "url": url.as_str() } }),
                Err(error) => did::bridge_failure(error.to_string()),
            }
        }
        _ => did::bridge_failure("invalid_external_url"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_in_the_environment_can_end_the_script() {
        let script = init_script(&Env {
            container: "desktop-app",
            form_factor: "desktop",
            platform: "linux",
            client_version: "1",
            capabilities: vec![],
            zone: "did:web:x</script><script>alert(1)",
            app: "a\u{2028}b",
            app_instance: "i",
            window_id: "w",
            presentation: "window",
            accent: None,
        });
        let head = &script[..script.find(API_SCRIPT).unwrap()];
        assert!(!head.contains("</script>"));
        assert!(!head.contains('\u{2028}'));
    }

    #[test]
    fn nothing_in_a_question_hides_or_turns_around() {
        assert_eq!(visible("alice\u{202e}ecila\u{200b}"), "alice\\u202eecila\\u200b");
        assert_eq!(visible("{\n  \"名\": 1\t}"), "{\n  \"名\": 1\t}");
    }

    #[test]
    fn events_are_plain_calls() {
        assert_eq!(
            emit_script("frame.message", &json!({ "a": "</x>" })),
            "window.__buckyEmit && window.__buckyEmit(\"frame.message\", {\"a\":\"\\u003c/x>\"});"
        );
    }
}
