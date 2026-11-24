//! `buckyos://` links from outside. The client only passes them on: the local page parses them
//! (`parseAppOpenUrl`) and refuses everything but `app.open` to a listed Zone.

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::content::{OpenUrlRequest, OPEN_URL_EVENT};

pub const SCHEME: &str = "buckyos";

/// Links that arrived before the local page was ready.
#[derive(Default)]
pub struct PendingLinks(std::sync::Mutex<PendingState>);

#[derive(Default)]
struct PendingState {
    ready: bool,
    links: Vec<String>,
}

pub fn open<R: Runtime>(app: &AppHandle<R>, url: &str) {
    if !url.starts_with(&format!("{SCHEME}://")) || url.len() > 4096 {
        log::info!("[deeplink] ignored a link");
        return;
    }
    if let Some(pending) = app.try_state::<PendingLinks>() {
        let mut state = pending.0.lock().expect("links poisoned");
        if !state.ready {
            state.links.push(url.to_string());
            return;
        }
    }
    emit(app, url.to_string());
}

fn emit<R: Runtime>(app: &AppHandle<R>, url: String) {
    let _ = app.emit_to("main", OPEN_URL_EVENT, OpenUrlRequest { url, from: None, zone: None });
}

/// The links on a process's command line (Windows and Linux start a second process with them).
#[cfg(desktop)]
pub fn open_arguments<R: Runtime>(app: &AppHandle<R>, arguments: &[String]) -> bool {
    let links: Vec<&String> = arguments.iter().filter(|argument| argument.starts_with(&format!("{SCHEME}://"))).collect();
    for link in &links {
        open(app, link);
    }
    !links.is_empty()
}

/// The local page listens now; it gets the links that came before.
#[tauri::command]
pub fn deeplink_ready(app: AppHandle) {
    let links = {
        let pending = app.state::<PendingLinks>();
        let mut state = pending.0.lock().expect("links poisoned");
        state.ready = true;
        std::mem::take(&mut state.links)
    };
    for link in links {
        emit(&app, link);
    }
    #[cfg(target_os = "android")]
    crate::content::mobile::page_ready(&app);
}
