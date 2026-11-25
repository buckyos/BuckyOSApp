//! The connections of Android's notification service, which runs in a process of its own without
//! Tauri (TODO N7). The main process leaves what to connect to in a file and says that it changed.

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::core::{self, Changed, ConnectionState, Host, Labels, Pace};
use super::model::{Alert, Seen, Summary};
use super::shown_alerts;
use crate::json_file::{read_json, write_json};
use crate::route::RouteZone;
use crate::zone::api::{HttpRequest, HttpResponse, ReqwestTransport, ZoneError, ZoneTransport};
use crate::zone::registry::ZoneRecord;
use crate::zone::secret::{SecretBackend, SecretStore};
use crate::zone::session::{Credential, Sessions, ZoneKey};
use crate::zone::ZoneHandle;

pub const CONFIG_FILE: &str = "notify-service.json";
const SEEN_FILE: &str = "notify-service-seen.json";
const PACE: Pace = Pace {
    keepalive: Duration::from_secs(240),
    idle: Duration::from_secs(300),
    poll: Duration::from_secs(15 * 60),
};

/// What the main process leaves for the service.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub enabled: bool,
    pub zones: Vec<ServiceZone>,
    #[serde(default)]
    pub labels: Labels,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceZone {
    pub account: String,
    pub record: ZoneRecord,
}

impl ServiceZone {
    fn handle(&self) -> ZoneHandle {
        ZoneHandle {
            key: ZoneKey { account: self.account.clone(), zone: self.record.did.clone() },
            record: self.record.clone(),
        }
    }
}

/// What the service does to the device.
pub trait Device: Send + Sync {
    fn alert(&self, alert: &Alert);
    /// Takes alerts whose tag begins like this away.
    fn cancel(&self, prefix: &str);
    /// Takes the alerts of all other Zones away.
    fn keep_only(&self, zones: &[String]);
    /// `connected`, `waiting`, `need_login`.
    fn state(&self, state: &str);
    /// Requests are under way: the device must not fall asleep.
    fn busy(&self, busy: bool);
    /// Nothing is connected any more; the sessions are signed out.
    fn ended(&self);
}

/// The client's sessions and the service's are separate: refresh tokens rotate, and two processes
/// must not use the same one. The credential is shared and belongs to the client.
struct OwnSessions(Arc<dyn SecretBackend>);

impl OwnSessions {
    fn own(key: &str) -> Option<String> {
        key.starts_with("session:").then(|| format!("notify-{key}"))
    }
}

impl SecretBackend for OwnSessions {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        self.0.get(Self::own(key).as_deref().unwrap_or(key))
    }

    fn set(&self, key: &str, value: &[u8]) -> Result<(), String> {
        match Self::own(key) {
            Some(key) => self.0.set(&key, value),
            None => Ok(()),
        }
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        match Self::own(key) {
            Some(key) => self.0.delete(&key),
            None => Ok(()),
        }
    }
}

struct AwakeTransport {
    inner: ReqwestTransport,
    device: Arc<dyn Device>,
    active: Arc<AtomicUsize>,
}

struct Awake<'a>(&'a AwakeTransport);

impl<'a> Awake<'a> {
    fn new(transport: &'a AwakeTransport) -> Self {
        if transport.active.fetch_add(1, Ordering::SeqCst) == 0 {
            transport.device.busy(true);
        }
        Self(transport)
    }
}

impl Drop for Awake<'_> {
    fn drop(&mut self) {
        if self.0.active.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.0.device.busy(false);
        }
    }
}

impl ZoneTransport for AwakeTransport {
    fn reset(&self) {
        self.inner.reset();
    }

    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, ZoneError>> {
        Box::pin(async move {
            let _awake = Awake::new(self);
            self.inner.send(request).await
        })
    }
}

struct Connection {
    handle: ZoneHandle,
    credential: Option<Credential>,
    sessions: Arc<Sessions>,
    wake: Arc<tokio::sync::Notify>,
    state: ConnectionState,
    task: tokio::task::JoinHandle<()>,
}

#[derive(Default)]
struct Inner {
    connections: HashMap<ZoneKey, Connection>,
    labels: Labels,
    front: String,
    seen: HashMap<String, Seen>,
}

pub struct Service {
    dir: PathBuf,
    secrets: Arc<dyn SecretBackend>,
    transport: Arc<AwakeTransport>,
    stream: reqwest::Client,
    device: Arc<dyn Device>,
    inner: Mutex<Inner>,
}

fn seen_key(key: &ZoneKey) -> String {
    format!("{}|{}", key.account, key.zone)
}

/// The credential that counts is the one now stored, not one read earlier in this run.
fn stored_credential(secrets: &Arc<dyn SecretBackend>, key: &ZoneKey) -> Option<Credential> {
    let sessions = Sessions::new(Arc::new(NoTransport), SecretStore::new(Arc::new(OwnSessions(secrets.clone()))));
    sessions.credential(key)
}

struct NoTransport;

impl ZoneTransport for NoTransport {
    fn send(&self, _request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, ZoneError>> {
        Box::pin(async { Err(ZoneError::Network("offline".into())) })
    }
}

impl Service {
    pub fn new(dir: PathBuf, secrets: Arc<dyn SecretBackend>, device: Arc<dyn Device>) -> Result<Arc<Self>, reqwest::Error> {
        let seen = read_json(&dir.join(SEEN_FILE)).unwrap_or_default();
        Ok(Arc::new(Self {
            transport: Arc::new(AwakeTransport { inner: ReqwestTransport::new()?, device: device.clone(), active: Arc::default() }),
            stream: core::stream_client(PACE)?,
            inner: Mutex::new(Inner { seen, ..Inner::default() }),
            dir,
            secrets,
            device,
        }))
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("notification service poisoned")
    }

    fn sessions(&self) -> Arc<Sessions> {
        let store = SecretStore::new(Arc::new(OwnSessions(self.secrets.clone())));
        Arc::new(Sessions::new(self.transport.clone(), store))
    }

    /// Makes the connections what the file now asks for. Must run inside the service's runtime.
    pub fn reload(self: &Arc<Self>) {
        let config: ServiceConfig = read_json(&self.dir.join(CONFIG_FILE)).unwrap_or_default();
        let wanted: HashMap<ZoneKey, ZoneHandle> = if config.enabled {
            config.zones.iter().map(ServiceZone::handle).map(|handle| (handle.key.clone(), handle)).collect()
        } else {
            HashMap::new()
        };
        if let Some(router) = crate::route::current() {
            router.set_zones(
                wanted.values().map(|handle| RouteZone { host: handle.host().to_string(), memory: handle.record.route.clone() }).collect(),
            );
        }
        let mut ended = Vec::new();
        let mut inner = self.lock();
        inner.labels = config.labels;
        let known: Vec<ZoneKey> = inner.connections.keys().cloned().collect();
        for key in known {
            let credential = stored_credential(&self.secrets, &key);
            let same = |connection: &Connection| {
                wanted.get(&key).is_some_and(|handle| handle.host() == connection.handle.host())
                    && credential.as_ref().map(|credential| (&credential.username, &credential.digest))
                        == connection.credential.as_ref().map(|credential| (&credential.username, &credential.digest))
            };
            if inner.connections.get(&key).is_some_and(same) {
                if let (Some(connection), Some(handle)) = (inner.connections.get_mut(&key), wanted.get(&key)) {
                    connection.handle = handle.clone();
                    connection.wake.notify_one();
                }
                continue;
            }
            if let Some(connection) = inner.connections.remove(&key) {
                connection.task.abort();
                ended.push((connection, credential.is_none()));
            }
        }
        for (key, handle) in wanted {
            if inner.connections.contains_key(&key) {
                continue;
            }
            let sessions = self.sessions();
            let wake = Arc::new(tokio::sync::Notify::new());
            let host = Arc::new(ServiceHost { service: self.clone() });
            let credential = stored_credential(&self.secrets, &key);
            let task = tokio::spawn(core::run(host, sessions.clone(), self.stream.clone(), handle.clone(), wake.clone()));
            inner
                .connections
                .insert(key, Connection { handle, credential, sessions, wake, state: ConnectionState::Connecting, task });
        }
        drop(inner);
        let connected: HashSet<ZoneKey> = self.lock().connections.keys().cloned().collect();
        let zones: Vec<String> = connected.iter().map(|key| key.zone.clone()).collect();
        self.device.keep_only(&zones);
        let mut logouts = Vec::new();
        for (connection, signed_out) in ended {
            let key = &connection.handle.key;
            if signed_out {
                self.lock().seen.remove(&seen_key(key));
            }
            if signed_out || !connected.contains(key) {
                logouts.push(async move { connection.sessions.logout(&connection.handle.key, connection.handle.host()).await });
            }
        }
        self.publish();
        let service = self.clone();
        tokio::spawn(async move {
            futures::future::join_all(logouts).await;
            if service.lock().connections.is_empty() {
                service.device.ended();
            }
        });
    }

    pub fn wake(&self) {
        self.transport.reset();
        for connection in self.lock().connections.values() {
            connection.wake.notify_one();
        }
    }

    pub fn front(&self, zone: String) {
        self.lock().front = zone;
    }

    fn publish(&self) {
        let state = {
            let inner = self.lock();
            let has = |state: ConnectionState| inner.connections.values().any(|connection| connection.state == state);
            if has(ConnectionState::Connected) {
                "connected"
            } else if has(ConnectionState::NeedLogin) {
                "need_login"
            } else {
                "waiting"
            }
        };
        self.device.state(state);
    }
}

struct ServiceHost {
    service: Arc<Service>,
}

impl Host for ServiceHost {
    fn pace(&self) -> Pace {
        PACE
    }

    fn load_seen(&self, zone: &ZoneHandle) -> Seen {
        self.service.lock().seen.get(&seen_key(&zone.key)).cloned().unwrap_or_default()
    }

    fn save_seen(&self, zone: &ZoneHandle, seen: &Seen) {
        let all = {
            let mut inner = self.service.lock();
            inner.seen.insert(seen_key(&zone.key), seen.clone());
            inner.seen.clone()
        };
        if let Err(error) = write_json(&self.service.dir.join(SEEN_FILE), &all) {
            log::warn!("[notify] saving failed: {error}");
        }
    }

    fn labels(&self) -> Labels {
        self.service.lock().labels.clone()
    }

    fn state(&self, zone: &ZoneHandle, state: ConnectionState) {
        log::info!("[notify] {}: {state:?}", zone.host());
        if let Some(connection) = self.service.lock().connections.get_mut(&zone.key) {
            connection.state = state;
        }
        self.service.publish();
    }

    fn counts(&self, zone: &ZoneHandle, summary: Summary, _urgent: HashSet<String>) {
        // Read or dealt with on another device.
        if summary.unread == 0 {
            self.service.device.cancel(&format!("{}|message:", zone.key.zone));
        }
        if summary.open == 0 {
            self.service.device.cancel(&format!("{}|notify:", zone.key.zone));
        }
    }

    fn changed(&self, _zone: &ZoneHandle, _what: Changed) {}

    fn messages_in_front(&self, zone: &ZoneHandle) -> bool {
        self.service.lock().front == zone.key.zone
    }

    fn alerts(&self, zone: &ZoneHandle, alerts: Vec<Alert>) {
        for alert in shown_alerts(zone, alerts, &self.labels()) {
            self.service.device.alert(&alert);
        }
    }
}

#[cfg(target_os = "android")]
mod process {
    use super::*;
    use crate::route::net::SystemNet;
    use crate::route::proxy::{listen, Entry, Listening};
    use crate::route::{Options, Router};
    use std::sync::OnceLock;

    struct Android;

    impl Device for Android {
        fn alert(&self, alert: &Alert) {
            if let Ok(json) = serde_json::to_string(alert) {
                crate::android::show_alert(&json);
            }
        }
        fn cancel(&self, prefix: &str) {
            crate::android::cancel_alerts(prefix);
        }
        fn keep_only(&self, zones: &[String]) {
            crate::android::keep_alerts(&serde_json::json!(zones).to_string());
        }
        fn state(&self, state: &str) {
            crate::android::service_state(&serde_json::json!({ "state": state }).to_string());
        }
        fn busy(&self, busy: bool) {
            crate::android::service_busy(busy);
        }
        fn ended(&self) {
            crate::android::service_ended();
        }
    }

    struct Running {
        runtime: tokio::runtime::Runtime,
        service: Arc<Service>,
        _proxy: Option<Listening>,
    }

    /// The ways to the Zones, in this process too. A phone in a pocket looks for better ones only
    /// when its network changes.
    fn start_routes(runtime: &tokio::runtime::Runtime) -> Option<Listening> {
        let _runtime = runtime.enter();
        let router = Router::new(Arc::new(SystemNet), Options { by_itself: false, ..Options::default() });
        let entry = Entry::Client { pac_path: String::new(), pass_others: false };
        match listen(router.clone(), 0, entry) {
            Ok(listening) => {
                router.set_port(listening.port);
                crate::route::install(router);
                Some(listening)
            }
            Err(error) => {
                log::error!("[route] the proxy of the client did not start: {error}");
                None
            }
        }
    }

    static RUNNING: OnceLock<Option<Running>> = OnceLock::new();

    fn start(dir: PathBuf) -> Option<Running> {
        crate::android::init_log();
        crate::zone::api::use_odd_nonces();
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("notify")
            .enable_all()
            .build()
            .map_err(|error| log::error!("[notify] no runtime: {error}"))
            .ok()?;
        let proxy = start_routes(&runtime);
        let service = Service::new(dir, crate::android::keystore(), Arc::new(Android))
            .map_err(|error| log::error!("[notify] no service: {error}"))
            .ok()?;
        Some(Running { runtime, service, _proxy: proxy })
    }

    fn running() -> Option<&'static Running> {
        RUNNING.get()?.as_ref()
    }

    pub fn reload(dir: PathBuf) {
        if let Some(running) = RUNNING.get_or_init(|| start(dir)) {
            let service = running.service.clone();
            running.runtime.spawn(async move { service.reload() });
        }
    }

    pub fn wake() {
        if let Some(running) = running() {
            let service = running.service.clone();
            running.runtime.spawn(async move {
                if let Some(router) = crate::route::current() {
                    router.network_changed().await;
                }
                service.wake();
            });
        }
    }

    pub fn front(zone: String) {
        if let Some(running) = running() {
            running.service.front(zone);
        }
    }
}

#[cfg(target_os = "android")]
pub use process::{front, reload, wake};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notify::core::make_alert;
    use crate::notify::model::{AlertLevel, AlertTarget};
    use crate::zone::secret::MemoryBackend;
    use serde_json::json;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<String>>);

    impl Device for Recorder {
        fn alert(&self, alert: &Alert) {
            self.0.lock().unwrap().push(format!("alert {}", alert.tag));
        }
        fn cancel(&self, prefix: &str) {
            self.0.lock().unwrap().push(format!("cancel {prefix}"));
        }
        fn keep_only(&self, zones: &[String]) {
            self.0.lock().unwrap().push(format!("keep {}", zones.join(",")));
        }
        fn state(&self, state: &str) {
            self.0.lock().unwrap().push(format!("state {state}"));
        }
        fn busy(&self, _busy: bool) {}
        fn ended(&self) {
            self.0.lock().unwrap().push("ended".into());
        }
    }

    fn zone(did: &str, host: &str) -> ServiceZone {
        ServiceZone {
            account: "did:bns:me".into(),
            record: serde_json::from_value(json!({ "did": did, "host": host, "source": "manual" })).unwrap(),
        }
    }

    struct Setup {
        dir: PathBuf,
        secrets: Arc<MemoryBackend>,
        device: Arc<Recorder>,
        service: Arc<Service>,
    }

    fn setup(name: &str) -> Setup {
        let dir = std::env::temp_dir().join(format!("buckyosapp-notify-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let secrets = Arc::new(MemoryBackend::default());
        let device = Arc::new(Recorder::default());
        let service = Service::new(dir.clone(), secrets.clone(), device.clone()).unwrap();
        Setup { dir, secrets, device, service }
    }

    impl Setup {
        fn config(&self, enabled: bool, zones: Vec<ServiceZone>) {
            write_json(&self.dir.join(CONFIG_FILE), &ServiceConfig { enabled, zones, labels: Labels::default() }).unwrap();
            self.service.reload();
        }

        fn zones(&self) -> Vec<String> {
            let mut zones: Vec<String> = self.service.lock().connections.keys().map(|key| key.zone.clone()).collect();
            zones.sort();
            zones
        }

        fn credential(&self, zone: &str, digest: &str) {
            let value = serde_json::to_vec(&json!({ "username": "me", "digest": digest })).unwrap();
            self.secrets.set(&format!("credential:did:bns:me:{zone}"), &value).unwrap();
        }
    }

    impl Drop for Setup {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[tokio::test]
    async fn connections_follow_the_file() {
        let setup = setup("follow");
        setup.credential("did:bns:a", "1");
        setup.credential("did:bns:b", "1");
        setup.service.reload();
        assert!(setup.zones().is_empty(), "no file yet");
        setup.config(true, vec![zone("did:bns:a", "a.invalid"), zone("did:bns:b", "b.invalid")]);
        assert_eq!(setup.zones(), ["did:bns:a", "did:bns:b"]);
        setup.config(true, vec![zone("did:bns:b", "b.invalid")]);
        assert_eq!(setup.zones(), ["did:bns:b"]);
        assert!(setup.device.0.lock().unwrap().contains(&"keep did:bns:b".to_string()));
        setup.config(false, vec![zone("did:bns:b", "b.invalid")]);
        assert!(setup.zones().is_empty());
    }

    #[tokio::test]
    async fn a_new_password_starts_the_connection_again() {
        let setup = setup("password");
        let zones = vec![zone("did:bns:a", "a.invalid")];
        setup.credential("did:bns:a", "old");
        setup.config(true, zones.clone());
        let sessions = || setup.service.lock().connections.values().next().unwrap().sessions.clone();
        let first = sessions();
        setup.config(true, zones.clone());
        assert!(Arc::ptr_eq(&first, &sessions()), "nothing changed");
        setup.credential("did:bns:a", "new");
        setup.config(true, zones);
        assert!(!Arc::ptr_eq(&first, &sessions()));
    }

    #[tokio::test]
    async fn the_last_zone_is_signed_out_before_the_service_ends() {
        let setup = setup("last");
        let key = "notify-session:did:bns:me:did:bns:a";
        setup.credential("did:bns:a", "1");
        setup.secrets.set(key, b"{}").unwrap();
        setup.config(true, vec![zone("did:bns:a", "a.invalid")]);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!setup.device.0.lock().unwrap().contains(&"ended".to_string()));
        setup.secrets.delete("credential:did:bns:me:did:bns:a").unwrap();
        setup.config(true, Vec::new());
        for _ in 0..200 {
            if setup.device.0.lock().unwrap().contains(&"ended".to_string()) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(setup.device.0.lock().unwrap().contains(&"ended".to_string()));
        assert_eq!(setup.secrets.get(key).unwrap(), None);
    }

    #[test]
    fn the_service_has_its_own_sessions_and_leaves_the_credential_alone() {
        let shared = Arc::new(MemoryBackend::default());
        let own = OwnSessions(shared.clone());
        shared.set("credential:x", b"c").unwrap();
        shared.set("session:x", b"client").unwrap();
        assert_eq!(own.get("credential:x").unwrap().as_deref(), Some(b"c".as_slice()));
        assert_eq!(own.get("session:x").unwrap(), None);
        own.set("session:x", b"service").unwrap();
        own.set("credential:x", b"no").unwrap();
        own.delete("credential:x").unwrap();
        assert_eq!(shared.get("session:x").unwrap().as_deref(), Some(b"client".as_slice()));
        assert_eq!(shared.get("notify-session:x").unwrap().as_deref(), Some(b"service".as_slice()));
        assert_eq!(shared.get("credential:x").unwrap().as_deref(), Some(b"c".as_slice()));
        own.delete("session:x").unwrap();
        assert_eq!(shared.get("notify-session:x").unwrap(), None);
        assert!(shared.get("session:x").unwrap().is_some());
    }

    #[tokio::test]
    async fn what_was_shown_survives_the_process() {
        let setup = setup("seen");
        let handle = zone("did:bns:a", "a.invalid").handle();
        let host = ServiceHost { service: setup.service.clone() };
        let seen = Seen { primed: true, ..Seen::default() };
        host.save_seen(&handle, &seen);
        let again = Service::new(setup.dir.clone(), setup.secrets.clone(), setup.device.clone()).unwrap();
        assert_eq!(ServiceHost { service: again }.load_seen(&handle), seen);
    }

    #[tokio::test]
    async fn read_elsewhere_means_gone_here() {
        let setup = setup("counts");
        let handle = zone("did:bns:a", "a.invalid").handle();
        let host = ServiceHost { service: setup.service.clone() };
        let alert = make_alert(&handle, "message:s", "t".into(), "b".into(), AlertLevel::Sound, AlertTarget::Activity);
        host.alerts(&handle, vec![alert]);
        host.counts(&handle, Summary { unread: 1, open: 1, ..Summary::default() }, HashSet::new());
        host.counts(&handle, Summary { unread: 0, open: 1, ..Summary::default() }, HashSet::new());
        setup.service.front("did:bns:b".into());
        assert!(!host.messages_in_front(&handle));
        setup.service.front("did:bns:a".into());
        assert!(host.messages_in_front(&handle));
        setup.service.wake();
        assert_eq!(*setup.device.0.lock().unwrap(), ["alert did:bns:a|message:s", "cancel did:bns:a|message:"]);
    }
}
