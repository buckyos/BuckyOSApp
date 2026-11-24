//! One Zone's notifications: connect, read, decide, tell. Nothing here knows Tauri, so that the
//! same code runs in the client and in Android's notification process (TODO N7).

use futures::future::BoxFuture;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use super::model::{
    clip, event_source, finished_tasks, kevent_segment, new_messages, new_notifies, notifying_schemas, Alert, AlertLevel, AlertTarget,
    NotifyItem, Seen, SessionItem, Source, Summary, TaskItem,
};
use crate::zone::api::{network_error, now_ms, ZoneError};
use crate::zone::session::Sessions;
use crate::zone::ZoneHandle;

const MUTED_FOR: Duration = Duration::from_secs(60);
const DEBOUNCE: Duration = Duration::from_millis(400);
const TASK_POLL_MIN: Duration = Duration::from_secs(10);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
const NAMES_FOR: Duration = Duration::from_secs(300);
const TASK_LOOKBACK_MS: u64 = 7 * 24 * 3_600_000;
/// A conversation shown in a focused window is read within this time; its alert is dropped then.
const READ_GRACE: Duration = Duration::from_millis(1500);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Connecting,
    Connected,
    Reconnecting,
    NeedLogin,
}

/// Texts of alerts, in the language of the local pages.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Labels {
    pub new_message: String,
    pub many: String,
    pub task_done: String,
    pub task_failed: String,
}

impl Default for Labels {
    fn default() -> Self {
        Self {
            new_message: "New message".into(),
            many: "{count} new notifications".into(),
            task_done: "Finished".into(),
            task_failed: "Failed".into(),
        }
    }
}

/// Which part of a Zone's data changed, for whoever shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Changed {
    All,
    Message,
    Task,
}

/// How often a connection makes itself heard. A phone pays for every time.
#[derive(Debug, Clone, Copy)]
pub struct Pace {
    /// The Zone's sign of life on the stream.
    pub keepalive: Duration,
    /// A stream silent for this long is dead.
    pub idle: Duration,
    /// Reading without an event.
    pub poll: Duration,
}

impl Default for Pace {
    fn default() -> Self {
        Self { keepalive: Duration::from_secs(15), idle: Duration::from_secs(45), poll: Duration::from_secs(60) }
    }
}

/// What a connection needs from where it runs.
pub trait Host: Send + Sync {
    fn pace(&self) -> Pace {
        Pace::default()
    }
    fn load_seen(&self, zone: &ZoneHandle) -> Seen;
    fn save_seen(&self, zone: &ZoneHandle, seen: &Seen);
    fn labels(&self) -> Labels;
    fn state(&self, zone: &ZoneHandle, state: ConnectionState);
    fn counts(&self, zone: &ZoneHandle, summary: Summary, urgent: HashSet<String>);
    fn changed(&self, zone: &ZoneHandle, what: Changed);
    /// Whether the Zone's Message Hub is what the user looks at.
    fn messages_in_front(&self, zone: &ZoneHandle) -> bool;
    fn alerts(&self, zone: &ZoneHandle, alerts: Vec<Alert>);
}

pub fn stream_client(pace: Pace) -> Result<reqwest::Client, reqwest::Error> {
    crate::http_client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(pace.idle)
        .build()
}

pub fn zone_label(zone: &ZoneHandle) -> String {
    zone.record.name.clone().unwrap_or_else(|| zone.host().to_string())
}

pub fn make_alert(zone: &ZoneHandle, tag: &str, title: String, body: String, level: AlertLevel, target: AlertTarget) -> Alert {
    Alert {
        tag: format!("{}|{tag}", zone.key.zone),
        account: zone.key.account.clone(),
        zone: zone.key.zone.clone(),
        zone_label: zone_label(zone),
        title,
        body,
        level,
        target,
        at_ms: now_ms(),
    }
}

struct Reader {
    host: Arc<dyn Host>,
    sessions: Arc<Sessions>,
    stream: reqwest::Client,
    handle: ZoneHandle,
    seen: Seen,
    schemas: Option<(Instant, HashSet<(String, u64)>)>,
    tasks_at: Option<Instant>,
    names: Option<(Instant, HashMap<String, String>)>,
    muted: HashMap<String, (Instant, bool)>,
    has_summary: bool,
}

impl Reader {
    fn new(host: Arc<dyn Host>, sessions: Arc<Sessions>, stream: reqwest::Client, handle: ZoneHandle) -> Self {
        let seen = host.load_seen(&handle);
        Self { host, sessions, stream, handle, seen, schemas: None, tasks_at: None, names: None, muted: HashMap::new(), has_summary: true }
    }

    async fn call(&self, service: &str, method: &str, params: Value) -> Result<Value, ZoneError> {
        self.sessions.call(&self.handle.key, self.handle.host(), service, method, params).await
    }

    fn owner(&self) -> Option<(String, String)> {
        let identity = self.sessions.status(&self.handle.key).identity?;
        Some((identity.did, identity.user_id))
    }

    async fn identity(&self) -> Result<(String, String), ZoneError> {
        // A token first: it also fetches the identity.
        self.sessions.token(&self.handle.key, self.handle.host()).await?;
        if let Some(identity) = self.owner() {
            return Ok(identity);
        }
        self.sessions.check(&self.handle.key, self.handle.host()).await?;
        self.owner().ok_or_else(|| ZoneError::Protocol("no identity in the Zone".into()))
    }

    async fn poll(&mut self, with_tasks: bool) -> Result<(), ZoneError> {
        let (owner, user_id) = self.identity().await?;
        // Nothing counts as told before it was shown: what fails on the way is read again.
        let mut seen = self.seen.clone();

        let open = self.call("msg-center", "notify.list", json!({ "status": ["open"], "limit": 100 })).await?;
        let open: Vec<NotifyItem> = parse_items(&open, "items");
        let sessions = self
            .call(
                "msg-center",
                "msg.list_sessions",
                json!({ "owner": owner, "limit": 50, "with_object": true, "lifecycle": "all", "order_by": "activity" }),
            )
            .await?;
        let sessions: Vec<SessionItem> = parse_items(&sessions, "items");

        let mut alerts = Vec::new();
        for item in new_notifies(&mut seen, &open) {
            if let Some(level) = item.alert_level() {
                let (title, body) = item.title_and_body();
                alerts.push(make_alert(
                    &self.handle,
                    &format!("notify:{}", item.notify_id),
                    clip(&title, 120),
                    clip(&body, 240),
                    level,
                    AlertTarget::Notify { notify_id: item.notify_id.clone(), link: item.source.link.clone() },
                ));
            }
        }
        for session in new_messages(&mut seen, &sessions) {
            if self.is_muted(&owner, &session.session_id).await {
                continue;
            }
            alerts.push(self.message_alert(&owner, &session).await);
        }
        if with_tasks {
            match self.task_alerts(&mut seen, &user_id).await {
                Ok(tasks) => alerts.extend(tasks),
                Err(error) => log::info!("[notify] tasks of {}: {error}", self.handle.host()),
            }
        }
        // The notifications and messages are there; counts that cannot be read stay what they were.
        let summary = self.summary(&owner, &open, &sessions).await;
        let urgent = open.iter().filter(|item| item.is_urgent()).map(|item| item.notify_id.clone()).collect();
        let unread = match summary {
            Ok(summary) => {
                self.host.counts(&self.handle, summary, urgent);
                Ok(())
            }
            Err(error) => Err(error),
        };
        seen.primed = true;
        if self.seen != seen {
            self.host.save_seen(&self.handle, &seen);
            self.seen = seen;
        }
        self.show(alerts).await;
        unread
    }

    async fn message_alert(&mut self, owner: &str, session: &SessionItem) -> Alert {
        let labels = self.host.labels();
        let record = session.last_record.as_ref().map(|last| last.record.clone()).unwrap_or_default();
        let peer = session
            .state
            .peer_did
            .clone()
            .or_else(|| (!session.is_group() && !record.from.is_empty()).then(|| record.from.clone()));
        let sender = self.name_of(owner, &record.from, record.from_name.as_deref()).await;
        let title = match (session.is_group(), &peer) {
            (true, Some(group)) => self.name_of(owner, group, session.state.title.as_deref()).await,
            _ => sender.clone(),
        };
        let mut body = session.preview();
        if body.is_empty() {
            body = labels.new_message;
        }
        if session.is_group() {
            body = format!("{sender}: {body}");
        }
        make_alert(
            &self.handle,
            &format!("message:{}", session.session_id),
            clip(&title, 120),
            body,
            AlertLevel::Sound,
            AlertTarget::Message { session_id: session.session_id.clone(), entity_id: peer },
        )
    }

    /// The contact or group name of a DID, else the name the message came with, else the DID's
    /// own last part.
    async fn name_of(&mut self, owner: &str, did: &str, fallback: Option<&str>) -> String {
        let fresh = self.names.as_ref().is_some_and(|(at, _)| at.elapsed() < NAMES_FOR);
        if !fresh {
            let mut names = HashMap::new();
            if let Ok(contacts) = self.call("msg-center", "contact.list_contacts", json!({ "query": {}, "contact_mgr_owner": owner })).await {
                for contact in contacts.as_array().into_iter().flatten() {
                    if let (Some(did), Some(name)) = (text(contact, "did"), text(contact, "name")) {
                        names.insert(did, name);
                    }
                }
            }
            if let Ok(groups) = self.call("msg-center", "group.list_by_member", json!({})).await {
                let hosted = groups.get("items").and_then(Value::as_array).into_iter().flatten().filter_map(|item| item.get("doc"));
                let joined = groups
                    .get("joined")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|item| item.get("doc_cache"))
                    .map(|cache| cache.get("doc").unwrap_or(cache));
                for doc in hosted.chain(joined) {
                    let name = doc.get("profile").and_then(|profile| text(profile, "name"));
                    if let (Some(did), Some(name)) = (text(doc, "id"), name) {
                        names.insert(did, name);
                    }
                }
            }
            self.names = Some((Instant::now(), names));
        }
        self.names
            .as_ref()
            .and_then(|(_, names)| names.get(did).cloned())
            .or_else(|| fallback.map(str::trim).filter(|name| !name.is_empty()).map(str::to_string))
            .unwrap_or_else(|| did.rsplit(':').next().unwrap_or(did).to_string())
    }

    async fn is_muted(&mut self, owner: &str, session_id: &str) -> bool {
        if let Some((at, muted)) = self.muted.get(session_id) {
            if at.elapsed() < MUTED_FOR {
                return *muted;
            }
        }
        let state = self.call("msg-center", "ui_session.list_state", json!({ "session_id": session_id, "owner": owner })).await;
        let muted = match state {
            Ok(entries) => entries
                .as_array()
                .into_iter()
                .flatten()
                .any(|entry| entry.get("key").and_then(Value::as_str) == Some("ui.muted") && entry.get("value") == Some(&Value::Bool(true))),
            Err(error) => {
                log::info!("[notify] session settings: {error}");
                return false;
            }
        };
        self.muted.insert(session_id.to_string(), (Instant::now(), muted));
        muted
    }

    async fn task_alerts(&mut self, seen: &mut Seen, user_id: &str) -> Result<Vec<Alert>, ZoneError> {
        let stale = self.schemas.as_ref().map_or(true, |(at, _)| at.elapsed() > NAMES_FOR * 2);
        if stale {
            let schemas = self.call("task-manager", "list_task_schemas", json!({ "include_disabled": true })).await?;
            self.schemas = Some((Instant::now(), notifying_schemas(&schemas)));
        }
        self.tasks_at = Some(Instant::now());
        let schemas = self.schemas.as_ref().map(|(_, schemas)| schemas.clone()).unwrap_or_default();
        let ids: HashSet<String> = schemas.iter().map(|(id, _)| id.clone()).collect();
        let mut tasks: Vec<TaskItem> = Vec::new();
        for id in ids {
            let page = self
                .call(
                    "task-manager",
                    "list_tasks",
                    json!({ "schema_id": id, "creator_user_id": user_id, "created_after": now_ms().saturating_sub(TASK_LOOKBACK_MS), "newest_first": true, "limit": 100 }),
                )
                .await?;
            tasks.extend(
                parse_items::<TaskItem>(&page, "tasks")
                    .into_iter()
                    .filter(|task| schemas.contains(&(task.schema_id.clone(), task.schema_version))),
            );
        }
        let labels = self.host.labels();
        Ok(finished_tasks(seen, &tasks)
            .into_iter()
            .map(|task| {
                let state = if task.outcome.as_deref() == Some("Failed") { &labels.task_failed } else { &labels.task_done };
                let body = match task.message.as_deref().map(str::trim).filter(|message| !message.is_empty()) {
                    Some(message) => format!("{state} · {}", clip(message, 160)),
                    None => state.clone(),
                };
                make_alert(
                    &self.handle,
                    &format!("task:{}", task.task_id),
                    clip(&task.name, 120),
                    body,
                    AlertLevel::Silent,
                    AlertTarget::Task { task_id: task.task_id.clone() },
                )
            })
            .collect())
    }

    async fn summary(&mut self, owner: &str, open: &[NotifyItem], sessions: &[SessionItem]) -> Result<Summary, ZoneError> {
        if self.has_summary {
            match self.call("msg-center", "notify.summary", json!({})).await {
                Ok(answer) => {
                    if let Some(summary) = Summary::from_answer(&answer) {
                        return Ok(summary);
                    }
                }
                Err(error) if error.is_network() => return Err(error),
                Err(error) => {
                    log::info!("[notify] {} has no notify.summary: {error}", self.handle.host());
                    self.has_summary = false;
                }
            }
        }
        let mut muted = HashSet::new();
        for session in sessions.iter().filter(|session| session.unread_count > 0 && !session.is_system_notify()) {
            if self.is_muted(owner, &session.session_id).await {
                muted.insert(session.session_id.clone());
            }
        }
        Ok(Summary::counted(open, sessions, &muted))
    }

    async fn show(&self, mut alerts: Vec<Alert>) {
        let messages: Vec<String> = alerts
            .iter()
            .filter_map(|alert| match &alert.target {
                AlertTarget::Message { session_id, .. } => Some(session_id.clone()),
                _ => None,
            })
            .collect();
        if !messages.is_empty() && self.host.messages_in_front(&self.handle) {
            tokio::time::sleep(READ_GRACE).await;
            let read = self.read_meanwhile(&messages).await;
            alerts.retain(|alert| !matches!(&alert.target, AlertTarget::Message { session_id, .. } if read.contains(session_id)));
        }
        if !alerts.is_empty() {
            self.host.alerts(&self.handle, alerts);
        }
    }

    async fn read_meanwhile(&self, session_ids: &[String]) -> HashSet<String> {
        let Some((owner, _)) = self.owner() else { return HashSet::new() };
        let answer = self
            .call("msg-center", "msg.list_sessions", json!({ "owner": owner, "limit": 50, "lifecycle": "all", "order_by": "activity" }))
            .await;
        let Ok(answer) = answer else { return HashSet::new() };
        parse_items::<SessionItem>(&answer, "items")
            .into_iter()
            .filter(|session| session.unread_count == 0 && session_ids.contains(&session.session_id))
            .map(|session| session.session_id)
            .collect()
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

fn parse_items<T: serde::de::DeserializeOwned>(answer: &Value, key: &str) -> Vec<T> {
    answer
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| serde_json::from_value(item.clone()).ok())
        .collect()
}

/// Runs until it is dropped. `wake` makes it read (and reconnect) now.
pub fn run(
    host: Arc<dyn Host>,
    sessions: Arc<Sessions>,
    stream: reqwest::Client,
    handle: ZoneHandle,
    wake: Arc<tokio::sync::Notify>,
) -> BoxFuture<'static, ()> {
    Box::pin(async move {
        let mut reader = Reader::new(host.clone(), sessions, stream, handle.clone());
        let mut backoff = Duration::from_secs(1);
        loop {
            let started = Instant::now();
            // The stream first: it does not repeat what happened before it was open.
            let ended = match open_stream(&reader).await {
                Ok(response) => listen(&mut reader, response, &wake).await,
                // Without events the reading itself may still work.
                Err(error @ (ZoneError::Http(..) | ZoneError::Protocol(_))) => match reader.poll(true).await {
                    Ok(()) => {
                        host.changed(&handle, Changed::All);
                        Err(error)
                    }
                    Err(error) => Err(error),
                },
                Err(error) => Err(error),
            };
            if started.elapsed() > host.pace().idle {
                backoff = Duration::from_secs(1);
            }
            match ended {
                Ok(()) => {}
                Err(ZoneError::NeedPassword) => {
                    host.state(&handle, ConnectionState::NeedLogin);
                    wake.notified().await;
                }
                Err(error) => {
                    log::info!("[notify] {}: {error}", handle.host());
                    host.state(&handle, ConnectionState::Reconnecting);
                    wait(&wake, &mut backoff).await;
                }
            }
        }
    })
}

async fn wait(wake: &tokio::sync::Notify, backoff: &mut Duration) {
    let _ = tokio::time::timeout(*backoff, wake.notified()).await;
    *backoff = (*backoff * 2).min(MAX_BACKOFF);
}

async fn open_stream(reader: &Reader) -> Result<reqwest::Response, ZoneError> {
    let (owner, _) = reader.identity().await?;
    let pace = reader.host.pace();
    let patterns = [
        format!("/obj/msg-center/owners/{}/**", kevent_segment(&owner)),
        "/obj/taskmgr/**".to_string(),
    ];
    let response = reader
        .stream
        .post(format!("https://{}/kapi/kevent/stream", reader.handle.host()))
        .header("Content-Type", "application/json")
        .body(json!({ "patterns": patterns, "keepalive_ms": pace.keepalive.as_millis() as u64 }).to_string())
        .send()
        .await
        .map_err(network_error)?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(ZoneError::Http(response.status().as_u16(), String::new()));
    }
    Ok(response)
}

/// Reads the event stream until it ends. `Ok` when it was healthy for a while.
async fn listen(reader: &mut Reader, mut response: reqwest::Response, wake: &tokio::sync::Notify) -> Result<(), ZoneError> {
    let pace = reader.host.pace();
    let opened = Instant::now();
    let mut buffer: Vec<u8> = Vec::new();
    let mut dirty: HashSet<Source> = HashSet::new();
    let mut due: Option<Instant> = None;
    // What came before the stream was open is read right away.
    let mut poll_at = Instant::now();
    let mut connected = false;
    // By the wall clock: timers stand still while a device sleeps.
    let mut heard = SystemTime::now();
    loop {
        let next = due.unwrap_or(poll_at).min(poll_at);
        tokio::select! {
            chunk = response.chunk() => match chunk.map_err(network_error)? {
                Some(chunk) => {
                    heard = SystemTime::now();
                    buffer.extend_from_slice(&chunk);
                    if buffer.len() > 1024 * 1024 {
                        return Err(ZoneError::Protocol("event too large".into()));
                    }
                    while let Some(end) = buffer.iter().position(|byte| *byte == b'\n') {
                        let line: Vec<u8> = buffer.drain(..=end).collect();
                        if let Some(source) = event_of(&line) {
                            dirty.insert(source);
                        }
                    }
                    if dirty.contains(&Source::Messages) {
                        // Not behind a task event that may wait.
                        let soon = Instant::now() + DEBOUNCE;
                        due = Some(due.map_or(soon, |due| due.min(soon)));
                    } else if dirty.contains(&Source::Tasks) && due.is_none() {
                        let since_tasks = reader.tasks_at.map(|at| at.elapsed()).unwrap_or(TASK_POLL_MIN);
                        due = Some(Instant::now() + DEBOUNCE.max(TASK_POLL_MIN.saturating_sub(since_tasks)));
                    }
                }
                None => {
                    return if opened.elapsed() > pace.idle { Ok(()) } else { Err(ZoneError::Network("the stream ended".into())) };
                }
            },
            _ = wake.notified() => {
                if heard.elapsed().is_ok_and(|silent| silent > pace.idle) {
                    return Err(ZoneError::Network("the stream went silent".into()));
                }
                dirty.insert(Source::Messages);
                due = Some(Instant::now());
            }
            _ = tokio::time::sleep_until(next.into()) => {
                let full = Instant::now() >= poll_at;
                let tasks = full || dirty.contains(&Source::Tasks);
                let what = if full { Changed::All } else if dirty.contains(&Source::Messages) { Changed::Message } else { Changed::Task };
                dirty.clear();
                due = None;
                poll_at = Instant::now() + pace.poll;
                reader.poll(tasks).await?;
                if !connected {
                    connected = true;
                    reader.host.state(&reader.handle, ConnectionState::Connected);
                }
                reader.host.changed(&reader.handle, what);
            }
        }
    }
}

fn event_of(line: &[u8]) -> Option<Source> {
    let frame: Value = serde_json::from_slice(line).ok()?;
    if frame.get("type")?.as_str()? != "event" {
        return None;
    }
    let event = frame.get("event")?;
    event_source(event.get("eventid").or_else(|| event.get("event_id"))?.as_str()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_stream_lines() {
        let event = |id: &str| format!("{{\"type\":\"event\",\"event\":{{\"eventid\":\"{id}\",\"data\":{{}}}}}}\n");
        assert_eq!(event_of(event("/obj/msg-center/owners/x1/sessions/inbox").as_bytes()), Some(Source::Messages));
        assert_eq!(event_of(event("/obj/taskmgr/t1/changed").as_bytes()), Some(Source::Tasks));
        assert_eq!(event_of(b"{\"type\":\"keepalive\",\"at_ms\":1}\n"), None);
        assert_eq!(event_of(b"garbage\n"), None);
    }
}
