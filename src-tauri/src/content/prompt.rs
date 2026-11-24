//! The wallet password, asked for in a window of the client. A Zone page asks for a signature and
//! never sees the password or the window it is typed into.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;

use super::bridge::Caller;
use crate::did;
use crate::error::{CommandErrors, CommandResult};

const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 420.0;

struct Prompt {
    caller: Caller,
    identity: String,
    payloads: Vec<Value>,
    answer: Option<oneshot::Sender<Value>>,
}

#[derive(Default)]
pub struct Prompts {
    open: Mutex<HashMap<String, Prompt>>,
    sequence: AtomicU32,
}

/// What the prompt window shows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptView {
    pub zone: String,
    pub zone_label: String,
    /// The host of the Zone or the device: names are theirs to choose, this is not.
    pub host: String,
    pub activation: bool,
    /// Who signs.
    pub identity: String,
    pub app: String,
    pub app_title: String,
    pub payloads: Vec<Value>,
}

fn answer(app: &AppHandle<impl Runtime>, label: &str, value: Value) {
    let prompt = app.state::<Prompts>().open.lock().expect("prompts poisoned").remove(label);
    if let Some(sender) = prompt.and_then(|mut prompt| prompt.answer.take()) {
        let _ = sender.send(value);
    }
}

pub async fn sign_json<R: Runtime>(app: &AppHandle<R>, caller: &Caller, payload: &Value) -> Value {
    let payloads = match did::bridge_sign_payloads(app, payload) {
        Ok(payloads) => payloads,
        Err(failure) => return failure,
    };
    let identity = did::bridge_identity(app)
        .map(|(account, name)| if name.is_empty() { account } else { name })
        .unwrap_or_default();
    let state = app.state::<Prompts>();
    let label = format!("aux_sign_{}", state.sequence.fetch_add(1, Ordering::Relaxed));
    let (sender, receiver) = oneshot::channel();
    {
        let mut open = state.open.lock().expect("prompts poisoned");
        if !open.is_empty() {
            return did::bridge_busy();
        }
        open.insert(label.clone(), Prompt { caller: caller.clone(), identity, payloads, answer: Some(sender) });
    }
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html#/prompt/sign".into()))
        .title("BuckyOS")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .center()
        .build();
    match built {
        Ok(window) => {
            let close_app = app.clone();
            let close_label = label.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Destroyed) {
                    answer(&close_app, &close_label, did::bridge_cancelled());
                }
            });
            let _ = window.set_focus();
        }
        Err(error) => answer(app, &label, did::bridge_failure(error.to_string())),
    }
    receiver.await.unwrap_or_else(|_| did::bridge_cancelled())
}

#[tauri::command]
pub fn prompt_get(webview: tauri::Webview, prompts: State<'_, Prompts>) -> CommandResult<PromptView> {
    let open = prompts.open.lock().expect("prompts poisoned");
    let prompt = open
        .get(webview.label())
        .ok_or_else(|| CommandErrors::not_found("prompt"))?;
    Ok(PromptView {
        zone: prompt.caller.zone.clone(),
        zone_label: prompt.caller.zone_label.clone(),
        host: prompt.caller.host.clone(),
        activation: prompt.caller.activation,
        identity: prompt.identity.clone(),
        app: prompt.caller.app.clone(),
        app_title: prompt.caller.title.clone(),
        payloads: prompt.payloads.clone(),
    })
}

/// Signs with the password; a wrong one leaves the prompt open.
#[tauri::command]
pub async fn prompt_submit(app: AppHandle, webview: tauri::Webview, password: String) -> CommandResult<()> {
    let label = webview.label().to_string();
    let (caller, payloads) = app
        .state::<Prompts>()
        .open
        .lock()
        .expect("prompts poisoned")
        .get(&label)
        .map(|prompt| (prompt.caller.clone(), prompt.payloads.clone()))
        .ok_or_else(|| CommandErrors::not_found("prompt"))?;
    let sign_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        did::bridge_sign(&sign_app, &caller.account, &password, payloads, caller.activation)
    })
    .await
    .map_err(|error| CommandErrors::internal(error.to_string()))??;
    answer(&app, &label, result);
    close(&app, &label);
    Ok(())
}

#[tauri::command]
pub fn prompt_cancel(app: AppHandle, webview: tauri::Webview) -> CommandResult<()> {
    let label = webview.label().to_string();
    answer(&app, &label, did::bridge_cancelled());
    close(&app, &label);
    Ok(())
}

fn close(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
    }
}

/// The view that asked is gone, or the identity it asked for is no longer the active one.
pub fn close_where<R: Runtime>(app: &AppHandle<R>, gone: impl Fn(&Caller) -> bool) {
    let Some(prompts) = app.try_state::<Prompts>() else { return };
    let labels: Vec<String> = prompts
        .open
        .lock()
        .expect("prompts poisoned")
        .iter()
        .filter(|(_, prompt)| gone(&prompt.caller))
        .map(|(label, _)| label.clone())
        .collect();
    for label in labels {
        answer(app, &label, did::bridge_cancelled());
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    }
}
