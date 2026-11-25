//! `audio.*` on a phone: the client is kept running while a page plays, and records by itself.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

use super::recordings::{Recording, Recordings};
use crate::content::bridge::{emit_script, BridgeError, Caller};
use crate::content::mobile;
use crate::error::{CommandErrors, CommandResult};
use crate::zone::api::{now_ms, HttpRequest};
use crate::zone::host::{classify_host, web_url};
use crate::zone::ZoneManager;

const STATUS_EVENT: &str = "audio://status";
/// A button of the media controls, for what a local page plays.
const COMMAND_EVENT: &str = "audio://command";
/// The holder that is not a view: the local pages (the music on Home).
const MAIN: &str = "main";
const MAX_ARTWORK: usize = 2 * 1024 * 1024;

/// What plays, as a page tells it.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(default)]
pub struct PlayItem {
    pub title: String,
    pub artist: Option<String>,
    pub artwork: Option<String>,
    pub playing: bool,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct AudioStatus {
    /// Views whose sound goes on in the background.
    pub playing: Vec<String>,
    pub recording: Option<RecordingOf>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct RecordingOf {
    pub view: String,
    pub zone: String,
    pub app: String,
}

/// A view that asked to be kept playing. The last one is the one the media controls show.
#[derive(Debug, Clone)]
struct Hold {
    view: String,
    app: String,
    item: PlayItem,
    artwork: Option<String>,
}

#[derive(Debug, Clone)]
struct Session {
    view: String,
    account: String,
    zone: String,
    app: String,
    app_instance: String,
    id: String,
    started_at: u64,
    state: String,
    elapsed_ms: u64,
    /// When `elapsed_ms` was right.
    at: u64,
}

impl Session {
    fn status(&self) -> Value {
        let running = if self.state == "recording" { now_ms().saturating_sub(self.at) } else { 0 };
        json!({ "state": self.state, "id": self.id, "startedAt": self.started_at, "elapsedMs": self.elapsed_ms + running })
    }

    fn store(&self) -> Option<Recordings> {
        Some(Recordings::new(mobile::data_dir()?, &self.account, &self.zone, &self.app_instance))
    }

    fn is_of(&self, caller: &Caller) -> bool {
        self.account == caller.account && self.zone == caller.zone && self.app_instance == caller.app_instance
    }
}

#[derive(Default)]
struct State {
    holds: Vec<Hold>,
    session: Option<Session>,
    told: AudioStatus,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<T>(work: impl FnOnce(&mut State) -> T) -> T {
    work(STATE.lock().expect("audio state poisoned").get_or_insert_with(State::default))
}

fn status() -> AudioStatus {
    with(|state| AudioStatus {
        playing: state.holds.iter().filter(|hold| hold.item.playing && hold.view != MAIN).map(|hold| hold.view.clone()).collect(),
        recording: state
            .session
            .as_ref()
            .map(|session| RecordingOf { view: session.view.clone(), zone: session.zone.clone(), app: session.app.clone() }),
    })
}

fn publish() {
    let now = status();
    let changed = with(|state| std::mem::replace(&mut state.told, now.clone()) != now);
    if changed {
        mobile::emit_to_page(now, STATUS_EVENT);
    }
}

#[tauri::command]
pub async fn audio_status() -> AudioStatus {
    status()
}

/// What a local page plays, or nothing (any more).
#[tauri::command]
pub async fn audio_hold(item: Option<PlayItem>) -> CommandResult<()> {
    with(|state| {
        state.holds.retain(|hold| hold.view != MAIN);
        if let Some(item) = item {
            state.holds.push(Hold { view: MAIN.into(), app: String::new(), item, artwork: None });
        }
    });
    play().await.map_err(|error| CommandErrors::internal(error.message))
}

/// Views that must keep their WebView.
pub fn held_views() -> Vec<String> {
    with(|state| {
        state
            .holds
            .iter()
            .map(|hold| hold.view.clone())
            .chain(state.session.as_ref().map(|session| session.view.clone()))
            .collect()
    })
}

pub async fn dispatch<R: Runtime>(app: &AppHandle<R>, caller: &Caller, name: &str, payload: Value) -> Result<Value, BridgeError> {
    match name {
        "audio.background.acquire" | "audio.background.update" => {
            let item: PlayItem = serde_json::from_value(payload).map_err(|error| BridgeError::new("failed", error.to_string()))?;
            let known = with(|state| state.holds.iter().any(|hold| hold.view == caller.view));
            if name == "audio.background.update" && !known {
                return Err(BridgeError::new("invalid_state", "not acquired"));
            }
            hold(app, caller, item).await?;
            Ok(Value::Null)
        }
        "audio.background.release" => {
            with(|state| state.holds.retain(|hold| hold.view != caller.view));
            play().await?;
            Ok(Value::Null)
        }
        "audio.record.start" => start(caller, payload).await,
        "audio.record.pause" | "audio.record.resume" => {
            own_session(caller)?;
            let action = name.rsplit('.').next().unwrap_or_default();
            mobile::call::<Value>("record", json!({ "action": action })).await?;
            Ok(own_session(caller)?.status())
        }
        "audio.record.status" => Ok(own_session(caller).map(|session| session.status()).unwrap_or_else(|_| idle(None))),
        "audio.record.stop" => {
            own_session(caller)?;
            match stop(None).await? {
                Some(recording) => Ok(json!(recording)),
                None => Err(BridgeError::new("failed", "nothing was recorded")),
            }
        }
        "audio.record.list" => {
            let current = own_session(caller).ok().map(|session| session.id);
            Ok(json!({ "recordings": store(caller)?.list(current.as_deref()) }))
        }
        "audio.record.get" => get(caller, payload),
        "audio.record.delete" => {
            let id = id_of(&payload);
            if own_session(caller).is_ok_and(|session| session.id == id) {
                return Err(BridgeError::new("busy", "being recorded"));
            }
            if !store(caller)?.delete(&id) {
                return Err(BridgeError::new("not_found", "no such recording"));
            }
            Ok(Value::Null)
        }
        _ => Err(BridgeError::unsupported(name)),
    }
}

// ---- playing ----

async fn hold<R: Runtime>(app: &AppHandle<R>, caller: &Caller, item: PlayItem) -> Result<(), BridgeError> {
    let kept = with(|state| {
        let old = state.holds.iter().find(|hold| hold.view == caller.view);
        old.filter(|hold| hold.item.artwork == item.artwork).and_then(|hold| hold.artwork.clone())
    });
    let artwork = match (&item.artwork, kept) {
        (_, Some(kept)) => Some(kept),
        (Some(url), None) => picture(app, caller, url).await,
        (None, None) => None,
    };
    if !mobile::has_view(&caller.view) {
        return Err(BridgeError::new("failed", "the view is gone"));
    }
    with(|state| {
        state.holds.retain(|hold| hold.view != caller.view);
        state.holds.push(Hold { view: caller.view.clone(), app: caller.title.clone(), item, artwork });
    });
    let started = play().await;
    if started.is_err() {
        with(|state| state.holds.retain(|hold| hold.view != caller.view));
        publish();
    }
    started
}

/// Shows what the media controls should, or ends the service.
async fn play() -> Result<(), BridgeError> {
    // Something that plays goes before something that was paused later.
    let top = with(|state| {
        let playing = state.holds.iter().rev().find(|hold| hold.item.playing);
        playing.or(state.holds.last()).cloned()
    });
    let item = top.map(|hold| {
        json!({
            "view": hold.view,
            "app": hold.app,
            "title": hold.item.title,
            "artist": hold.item.artist,
            "artwork": hold.artwork,
            "playing": hold.item.playing,
        })
    });
    let shown = mobile::call::<Value>("playback", json!({ "item": item })).await.map(|_| ());
    publish();
    shown
}

async fn picture<R: Runtime>(app: &AppHandle<R>, caller: &Caller, url: &str) -> Option<String> {
    let manager = app.try_state::<ZoneManager>()?;
    let handle = manager.handle_for(&caller.account, &caller.zone).ok()?;
    let url = web_url(url).filter(|url| url.host_str().is_some_and(|host| classify_host(host, handle.host()).is_some()))?;
    let request = HttpRequest { method: "GET".into(), url: url.into(), headers: Vec::new(), body: None };
    let response = manager.sessions.fetch(&handle.key, handle.host(), request).await.ok()?;
    (response.status == 200 && response.body.len() <= MAX_ARTWORK).then(|| STANDARD.encode(response.body))
}

/// A button of the media controls. On the UI thread.
pub fn on_media(view: &str, command: &str) {
    if view == MAIN {
        mobile::emit_to_page(json!({ "command": command }), COMMAND_EVENT);
        return;
    }
    let (view, script) = (view.to_string(), emit_script("audio.background.command", &json!({ "command": command })));
    tauri::async_runtime::spawn(async move { mobile::eval(&view, script).await });
}

/// The view is closed, or its page ended.
pub fn view_gone(view: &str) {
    let (released, recorded) = with(|state| {
        let before = state.holds.len();
        state.holds.retain(|hold| hold.view != view);
        (state.holds.len() != before, state.session.as_ref().is_some_and(|session| session.view == view))
    });
    if released || recorded {
        tauri::async_runtime::spawn(async move {
            if released {
                let _ = play().await;
            }
            if recorded {
                let _ = stop(None).await;
            }
        });
    }
}

// ---- recording ----

fn idle(error: Option<&str>) -> Value {
    match error {
        Some(error) => json!({ "state": "idle", "elapsedMs": 0, "error": error }),
        None => json!({ "state": "idle", "elapsedMs": 0 }),
    }
}

fn id_of(payload: &Value) -> String {
    payload.get("id").and_then(Value::as_str).unwrap_or_default().to_string()
}

fn own_session(caller: &Caller) -> Result<Session, BridgeError> {
    with(|state| state.session.clone().filter(|session| session.is_of(caller)))
        .ok_or_else(|| BridgeError::new("invalid_state", "not recording"))
}

fn store(caller: &Caller) -> Result<Recordings, BridgeError> {
    let dir = mobile::data_dir().ok_or_else(|| BridgeError::new("failed", "no data folder"))?;
    Ok(Recordings::new(dir, &caller.account, &caller.zone, &caller.app_instance))
}

async fn start(caller: &Caller, payload: Value) -> Result<Value, BridgeError> {
    let number = |key: &str, default: u64, low: u64, high: u64| {
        payload.get(key).and_then(Value::as_u64).unwrap_or(default).clamp(low, high)
    };
    let busy = || BridgeError::new("busy", "another recording is under way");
    if with(|state| state.session.is_some()) {
        return Err(busy());
    }
    if !mobile::ask_microphone(&caller.view).await {
        return Err(BridgeError::new("denied", "the microphone was refused"));
    }
    let store = store(caller)?;
    let title = payload.get("title").and_then(Value::as_str).map(str::to_string);
    let recording = store.begin(title).map_err(|error| BridgeError::new("failed", error.to_string()))?;
    let session = Session {
        view: caller.view.clone(),
        account: caller.account.clone(),
        zone: caller.zone.clone(),
        app: caller.app.clone(),
        app_instance: caller.app_instance.clone(),
        id: recording.id.clone(),
        started_at: recording.created_at,
        state: "recording".into(),
        elapsed_ms: 0,
        at: now_ms(),
    };
    let taken = with(|state| match state.session {
        Some(_) => true,
        None => {
            state.session = Some(session.clone());
            false
        }
    });
    if taken {
        store.delete(&recording.id);
        return Err(busy());
    }
    let args = json!({
        "action": "start",
        "path": store.audio_path(&recording.id),
        "app": caller.title,
        "sampleRate": number("sampleRate", 44_100, 8_000, 48_000),
        "channels": number("channels", 1, 1, 2),
        "bitRate": number("bitRate", 96_000, 16_000, 256_000),
    });
    if let Err(error) = mobile::call::<Value>("record", args).await {
        with(|state| state.session = None);
        store.delete(&recording.id);
        publish();
        return Err(error);
    }
    let status = with(|state| {
        let session = state.session.as_mut()?;
        session.at = now_ms();
        Some(session.status())
    })
    .unwrap_or_else(|| idle(None));
    publish();
    tell(&session, status.clone());
    Ok(status)
}

/// Ends the recording and keeps it.
async fn stop(error: Option<&str>) -> Result<Option<Recording>, BridgeError> {
    #[derive(Deserialize)]
    struct Stopped {
        #[serde(rename = "durationMs")]
        duration_ms: u64,
    }
    let Some(session) = with(|state| state.session.clone()) else {
        return Ok(None);
    };
    let length = match mobile::call::<Stopped>("record", json!({ "action": "stop" })).await {
        Ok(stopped) => stopped.duration_ms,
        // it ended by itself
        Err(_) => session.status().get("elapsedMs").and_then(Value::as_u64).unwrap_or_default(),
    };
    with(|state| state.session = None);
    let recording = session.store().and_then(|store| store.finish(&session.id, length));
    publish();
    tell(&session, idle(error));
    Ok(recording)
}

fn get(caller: &Caller, payload: Value) -> Result<Value, BridgeError> {
    let number = |key: &str| payload.get(key).and_then(Value::as_u64);
    let chunk = store(caller)?
        .read(&id_of(&payload), number("offset").unwrap_or(0), number("length").unwrap_or(512 * 1024))
        .map_err(|error| BridgeError::new("failed", error.to_string()))?
        .ok_or_else(|| BridgeError::new("not_found", "no such recording"))?;
    Ok(json!({ "recording": chunk.recording, "data": STANDARD.encode(chunk.data), "eof": chunk.eof }))
}

fn tell(session: &Session, status: Value) {
    let script = emit_script("audio.record.state", &status);
    for view in mobile::views_of(&session.zone, &session.app_instance) {
        let script = script.clone();
        tauri::async_runtime::spawn(async move { mobile::eval(&view, script).await });
    }
}

/// What happened to the recorder. On the UI thread.
pub fn on_record(event: &Value) {
    let state = event.get("state").and_then(Value::as_str).unwrap_or_default().to_string();
    match state.as_str() {
        // the notification's button
        "stop" => {
            tauri::async_runtime::spawn(async { let _ = stop(None).await; });
        }
        "failed" => {
            let error = event.get("error").and_then(Value::as_str).unwrap_or("failed").to_string();
            tauri::async_runtime::spawn(async move { let _ = stop(Some(&error)).await; });
        }
        _ => {
            let changed = with(|audio| {
                let session = audio.session.as_mut()?;
                session.state = state;
                session.elapsed_ms = event.get("elapsedMs").and_then(Value::as_u64).unwrap_or(session.elapsed_ms);
                session.at = now_ms();
                Some(session.clone())
            });
            if let Some(session) = changed {
                tell(&session, session.status());
            }
        }
    }
}
