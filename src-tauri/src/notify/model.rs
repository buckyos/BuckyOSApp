//! What a poll of one Zone means for the user: which events are new, and which of them alert.
//! No I/O here.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashSet, VecDeque};

const MAX_SEEN: usize = 500;
/// More new events than this at once (after a long time offline) become one summary.
pub const MAX_ALERTS_AT_ONCE: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AlertLevel {
    Silent,
    Sound,
    /// Sound, and the tray icon flashes until it is dealt with.
    Urgent,
}

/// Where a click on an alert goes; the local page turns it into an open request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AlertTarget {
    /// The notification's own page (`source.link`) or its card.
    Notify { notify_id: String, link: Option<String> },
    Message { session_id: String, entity_id: Option<String> },
    Task { task_id: String },
    /// Several events at once, or a download: the Activity page.
    Activity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    /// Alerts with the same tag replace each other (messages of one conversation).
    pub tag: String,
    pub account: String,
    pub zone: String,
    pub zone_label: String,
    pub title: String,
    pub body: String,
    pub level: AlertLevel,
    pub target: AlertTarget,
    pub at_ms: u64,
}

/// What this device already told the user about, kept across restarts so that what arrived while
/// the client was not running still alerts and nothing alerts twice.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Seen {
    /// False until the first successful poll: what is there when a Zone is first connected is old.
    #[serde(default)]
    pub primed: bool,
    #[serde(default)]
    pub notifies: VecDeque<String>,
    /// Session → sort key of the newest record known.
    #[serde(default)]
    pub sessions: BTreeMap<String, u64>,
    /// Finished tasks already told about.
    #[serde(default)]
    pub tasks: VecDeque<String>,
}

fn remember(list: &mut VecDeque<String>, id: &str) -> bool {
    remember_up_to(list, id, MAX_SEEN)
}

fn remember_up_to(list: &mut VecDeque<String>, id: &str, most: usize) -> bool {
    if list.iter().any(|known| known == id) {
        return false;
    }
    list.push_back(id.to_string());
    while list.len() > most {
        list.pop_front();
    }
    true
}

/// The fields of a `NotifyView` the client uses; unknown ones are ignored.
#[derive(Debug, Clone, Deserialize)]
pub struct NotifyItem {
    pub notify_id: String,
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub created_at_ms: u64,
    #[serde(default)]
    pub prompt: NotifyPrompt,
    #[serde(default)]
    pub source: NotifySource,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct NotifyPrompt {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct NotifySource {
    #[serde(default)]
    pub link: Option<String>,
}

impl NotifyItem {
    pub fn is_urgent(&self) -> bool {
        self.level.as_deref() == Some("urgent")
    }

    pub fn alert_level(&self) -> Option<AlertLevel> {
        match self.level.as_deref() {
            Some("quiet") => None,
            Some("timely") => Some(AlertLevel::Sound),
            Some("urgent") => Some(AlertLevel::Urgent),
            _ => Some(AlertLevel::Silent),
        }
    }

    pub fn title_and_body(&self) -> (String, String) {
        let text = |value: &Option<String>| value.as_deref().map(str::trim).unwrap_or_default().to_string();
        let (title, message) = (text(&self.prompt.title), text(&self.prompt.message));
        match (title.is_empty(), message.is_empty()) {
            (false, _) => (title, message),
            (true, false) => (message, String::new()),
            (true, true) => (self.notify_id.clone(), String::new()),
        }
    }
}

/// Open notifications not told about yet, oldest first.
pub fn new_notifies(seen: &mut Seen, open: &[NotifyItem]) -> Vec<NotifyItem> {
    let mut fresh: Vec<NotifyItem> = open
        .iter()
        .filter(|item| remember(&mut seen.notifies, &item.notify_id))
        .cloned()
        .collect();
    if !seen.primed {
        return Vec::new();
    }
    fresh.sort_by_key(|item| item.created_at_ms);
    fresh
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionItem {
    pub session_id: String,
    #[serde(default)]
    pub unread_count: u64,
    #[serde(default)]
    pub state: SessionStateItem,
    #[serde(default)]
    pub last_record: Option<LastRecord>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionStateItem {
    #[serde(default)]
    pub peer_did: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LastRecord {
    #[serde(default)]
    pub record: RecordItem,
    #[serde(default)]
    pub msg: Option<Value>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RecordItem {
    #[serde(default)]
    pub box_kind: String,
    #[serde(default)]
    pub msg_kind: Option<String>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub from_name: Option<String>,
    #[serde(default)]
    pub sort_key: u64,
    #[serde(default)]
    pub created_at_ms: u64,
}

impl SessionItem {
    /// The three sessions of System Notify: their records are the notifications themselves.
    pub fn is_system_notify(&self) -> bool {
        self.session_id.starts_with("sysnotify:")
    }

    pub fn is_group(&self) -> bool {
        self.state.origin.as_deref() == Some("group")
    }

    fn unread_inbound(&self) -> Option<&RecordItem> {
        let record = &self.last_record.as_ref()?.record;
        let inbound = matches!(record.box_kind.as_str(), "INBOX" | "GROUP_INBOX" | "REQUEST_BOX");
        let readable = !matches!(record.msg_kind.as_deref(), Some("event") | Some("notify"));
        (inbound && readable && record.state == "UNREAD" && self.unread_count > 0).then_some(record)
    }

    /// The message's text, without mark-up that does not read in a notification.
    pub fn preview(&self) -> String {
        let text = self
            .last_record
            .as_ref()
            .and_then(|last| last.msg.as_ref())
            .and_then(|msg| msg.get("content"))
            .and_then(|content| content.get("content").or_else(|| content.get("text")).or(Some(content)))
            .and_then(Value::as_str)
            .unwrap_or_default();
        clip(text, 160)
    }
}

pub fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut clipped: String = flat.chars().take(max.saturating_sub(1)).collect();
    clipped.push('…');
    clipped
}

/// Conversations with a message not told about yet.
pub fn new_messages(seen: &mut Seen, sessions: &[SessionItem]) -> Vec<SessionItem> {
    let mut fresh = Vec::new();
    for session in sessions {
        if session.is_system_notify() {
            continue;
        }
        let Some(last) = session.last_record.as_ref() else { continue };
        let newest = last.record.sort_key;
        let known = seen.sessions.get(&session.session_id).copied();
        if known.is_some_and(|known| known >= newest) {
            continue;
        }
        seen.sessions.insert(session.session_id.clone(), newest);
        if seen.primed && session.unread_inbound().is_some() {
            fresh.push(session.clone());
        }
    }
    // Sessions that left the list are forgotten once there are many.
    if seen.sessions.len() > MAX_SEEN {
        let listed: HashSet<&str> = sessions.iter().map(|session| session.session_id.as_str()).collect();
        seen.sessions.retain(|id, _| listed.contains(id.as_str()));
    }
    fresh.sort_by_key(|session| session.last_record.as_ref().map(|last| last.record.created_at_ms));
    fresh
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskItem {
    pub task_id: String,
    #[serde(default)]
    pub name: String,
    pub schema_id: String,
    #[serde(default)]
    pub schema_version: u64,
    #[serde(default)]
    pub phase: String,
    #[serde(default)]
    pub outcome: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

/// Tasks that completed or failed and were not told about yet.
pub fn finished_tasks(seen: &mut Seen, tasks: &[TaskItem]) -> Vec<TaskItem> {
    let mut fresh = Vec::new();
    // As many as can be listed at once, the oldest first: what drops out is not listed any more.
    let most = MAX_SEEN.max(tasks.len() * 2);
    for task in tasks.iter().rev() {
        if task.phase != "Terminal" || !remember_up_to(&mut seen.tasks, &task.task_id, most) {
            continue;
        }
        if seen.primed && matches!(task.outcome.as_deref(), Some("Succeeded") | Some("Failed")) {
            fresh.push(task.clone());
        }
    }
    fresh
}

/// `(schema id, version)` of the task schemas marked `presentation_schema.system_notify`.
pub fn notifying_schemas(answer: &Value) -> HashSet<(String, u64)> {
    let Some(schemas) = answer.get("schemas").and_then(Value::as_array) else {
        return HashSet::new();
    };
    schemas
        .iter()
        .filter(|schema| {
            let mode = schema.get("presentation_schema").and_then(|presentation| presentation.get("system_notify"));
            matches!(mode.and_then(Value::as_str), Some("progress") | Some("completion"))
        })
        .filter_map(|schema| Some((schema.get("schema_id")?.as_str()?.to_string(), schema.get("schema_version")?.as_u64()?)))
        .collect()
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Summary {
    pub open: u64,
    pub todo: u64,
    pub agent: u64,
    pub app: u64,
    pub unread: u64,
}

impl Summary {
    #[cfg_attr(mobile, allow(dead_code))]
    pub fn total(&self) -> u64 {
        self.open + self.unread
    }

    pub fn from_answer(answer: &Value) -> Option<Self> {
        let notify = answer.get("notify")?;
        let count = |value: &Value, key: &str| value.get(key).and_then(Value::as_u64).unwrap_or_default();
        Some(Self {
            open: count(notify, "open"),
            todo: count(notify, "todo"),
            agent: count(notify, "agent"),
            app: count(notify, "app"),
            unread: answer.get("messages").map(|messages| count(messages, "unread")).unwrap_or_default(),
        })
    }

    /// For Zones without `notify.summary`.
    pub fn counted(open: &[NotifyItem], sessions: &[SessionItem], muted: &HashSet<String>) -> Self {
        let of = |category: &str| open.iter().filter(|item| item.category.as_deref() == Some(category)).count() as u64;
        Self {
            open: open.len() as u64,
            todo: of("todo"),
            agent: of("agent"),
            app: of("app"),
            unread: sessions
                .iter()
                .filter(|session| !session.is_system_notify() && !muted.contains(&session.session_id))
                .map(|session| session.unread_count)
                .sum(),
        }
    }
}

/// A kevent path segment (buckyos-api `kevent_segment`).
pub fn kevent_segment(segment: &str) -> String {
    let plain = |ch: char| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-';
    if !segment.is_empty() && segment.chars().all(plain) && !segment.starts_with('x') {
        return segment.to_string();
    }
    let mut encoded = String::with_capacity(segment.len() * 2 + 1);
    encoded.push('x');
    for byte in segment.as_bytes() {
        encoded.push_str(&format!("{byte:02x}"));
    }
    encoded
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    Messages,
    Tasks,
}

/// Which part of the user's data an event is about.
pub fn event_source(event_id: &str) -> Option<Source> {
    if event_id.starts_with("/obj/msg-center/") {
        Some(Source::Messages)
    } else if event_id.starts_with("/obj/taskmgr/") {
        Some(Source::Tasks)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn notify(id: &str, level: &str, at: u64) -> NotifyItem {
        serde_json::from_value(json!({ "notify_id": id, "level": level, "created_at_ms": at, "prompt": { "title": "T", "message": "M" }, "later_field": 1 })).unwrap()
    }

    fn session(id: &str, sort_key: u64, unread: u64, state: &str) -> SessionItem {
        serde_json::from_value(json!({
            "session_id": id, "unread_count": unread,
            "state": { "peer_did": "did:bns:carol" },
            "last_record": { "record": { "box_kind": "INBOX", "msg_kind": "chat", "state": state, "from": "did:bns:carol", "sort_key": sort_key, "created_at_ms": sort_key },
                             "msg": { "content": { "content": "hello\n  there" } } }
        }))
        .unwrap()
    }

    #[test]
    fn the_first_poll_only_takes_note() {
        let mut seen = Seen::default();
        assert!(new_notifies(&mut seen, &[notify("a", "urgent", 1)]).is_empty());
        assert!(new_messages(&mut seen, &[session("s", 1, 1, "UNREAD")]).is_empty());
        seen.primed = true;
        assert!(new_notifies(&mut seen, &[notify("a", "urgent", 1)]).is_empty());
        let fresh = new_notifies(&mut seen, &[notify("c", "normal", 3), notify("b", "normal", 2), notify("a", "urgent", 1)]);
        assert_eq!(fresh.iter().map(|item| item.notify_id.as_str()).collect::<Vec<_>>(), ["b", "c"]);
        // the same answer again (a reconnect) tells nothing twice
        assert!(new_notifies(&mut seen, &[notify("c", "normal", 3), notify("b", "normal", 2)]).is_empty());
    }

    #[test]
    fn levels_follow_the_table() {
        assert_eq!(notify("a", "quiet", 1).alert_level(), None);
        assert_eq!(notify("a", "normal", 1).alert_level(), Some(AlertLevel::Silent));
        assert_eq!(notify("a", "timely", 1).alert_level(), Some(AlertLevel::Sound));
        assert_eq!(notify("a", "urgent", 1).alert_level(), Some(AlertLevel::Urgent));
    }

    #[test]
    fn a_conversation_alerts_for_each_new_message_once() {
        let mut seen = Seen { primed: true, ..Seen::default() };
        assert_eq!(new_messages(&mut seen, &[session("s", 1, 1, "UNREAD")]).len(), 1);
        assert!(new_messages(&mut seen, &[session("s", 1, 1, "UNREAD")]).is_empty());
        assert_eq!(new_messages(&mut seen, &[session("s", 2, 2, "UNREAD")]).len(), 1);
        // read elsewhere already
        assert!(new_messages(&mut seen, &[session("s", 3, 0, "READ")]).is_empty());
        // one's own message, and notifications, are not messages to tell about
        let mut own = session("s", 4, 1, "UNREAD");
        own.last_record.as_mut().unwrap().record.box_kind = "SENT".into();
        assert!(new_messages(&mut seen, &[own]).is_empty());
        assert!(new_messages(&mut seen, &[session("sysnotify:app", 9, 1, "UNREAD")]).is_empty());
        let mut event = session("g", 5, 1, "UNREAD");
        event.last_record.as_mut().unwrap().record.msg_kind = Some("event".into());
        assert!(new_messages(&mut seen, &[event]).is_empty());
    }

    #[test]
    fn previews_are_one_short_line() {
        assert_eq!(session("s", 1, 1, "UNREAD").preview(), "hello there");
        assert_eq!(clip(&"x".repeat(200), 10), format!("{}…", "x".repeat(9)));
    }

    #[test]
    fn tasks_alert_when_they_end() {
        let mut seen = Seen { primed: true, ..Seen::default() };
        let task = |phase: &str, outcome: Option<&str>| TaskItem {
            task_id: "t".into(), name: "Download".into(), schema_id: "d".into(), schema_version: 1,
            phase: phase.into(), outcome: outcome.map(str::to_string), message: None,
        };
        assert!(finished_tasks(&mut seen, &[task("Running", None)]).is_empty());
        assert_eq!(finished_tasks(&mut seen, &[task("Terminal", Some("Failed"))]).len(), 1);
        assert!(finished_tasks(&mut seen, &[task("Terminal", Some("Failed"))]).is_empty());
        let mut seen = Seen { primed: true, ..Seen::default() };
        assert!(finished_tasks(&mut seen, &[task("Terminal", Some("Canceled"))]).is_empty());
        let schemas = notifying_schemas(&json!({ "schemas": [
            { "schema_id": "a", "schema_version": 1, "presentation_schema": { "system_notify": "progress" } },
            { "schema_id": "b", "schema_version": 2 } ] }));
        assert!(schemas.contains(&("a".into(), 1)) && schemas.len() == 1);
    }

    #[test]
    fn counts_come_from_the_zone_or_are_added_up() {
        let summary = Summary::from_answer(&json!({ "notify": { "open": 3, "todo": 1, "agent": 1, "app": 1 }, "messages": { "unread": 12 } })).unwrap();
        assert_eq!(summary.total(), 15);
        assert!(Summary::from_answer(&json!({})).is_none());
        let muted = HashSet::from(["m".to_string()]);
        let counted = Summary::counted(
            &[notify("a", "normal", 1)],
            &[session("s", 1, 2, "UNREAD"), session("m", 1, 5, "UNREAD"), session("sysnotify:app", 1, 1, "UNREAD")],
            &muted,
        );
        assert_eq!((counted.open, counted.unread), (1, 2));
    }

    #[test]
    fn event_segments_match_buckyos_api() {
        assert_eq!(kevent_segment("did:bns:alice"), "x6469643a626e733a616c696365");
        assert_eq!(kevent_segment("plain-1_a"), "plain-1_a");
        assert_eq!(kevent_segment("xyz"), "x78797a");
    }

    #[test]
    fn memory_of_what_was_seen_stays_small() {
        let mut seen = Seen { primed: true, ..Seen::default() };
        for index in 0..2000 {
            new_notifies(&mut seen, &[notify(&format!("n{index}"), "normal", index)]);
        }
        assert_eq!(seen.notifies.len(), MAX_SEEN);
    }
}
