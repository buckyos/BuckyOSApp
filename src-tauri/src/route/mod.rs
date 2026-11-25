//! Which way the client takes to each Zone: the BuckyOS on this computer, a device in the same
//! network, or whatever the system's own name resolution leads to. The address, the certificate and
//! the origin of a page stay what they are; only the connection goes elsewhere, through a proxy of
//! the client's own (`proxy.rs`) that never opens the TLS inside.
//!
//! Nothing here knows Tauri (`client.rs` does), so that Android's notification process uses it too.

pub mod client;
pub mod net;
pub mod pac;
pub mod proxy;
pub mod tls;
#[cfg(desktop)]
pub mod webview;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;

use crate::zone::host::{classify_host, find_zone, normalize_host, ZoneHostKind};
use net::{is_lan, neighbours, Net, HTTPS};
use tls::{Outcome, Probe};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "address", rename_all = "snake_case")]
pub enum Line {
    /// The BuckyOS on this computer.
    Local,
    /// A device of the Zone in this network.
    Lan(IpAddr),
    /// As the system goes; mostly through the SN's relay.
    Internet,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineMode {
    #[default]
    Auto,
    /// Never directly; for finding out what is wrong.
    Internet,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownDevice {
    pub name: String,
    #[serde(default)]
    pub is_ood: bool,
    #[serde(default)]
    pub ips: Vec<IpAddr>,
}

/// What is known about the ways to a Zone; kept with the Zone in the list.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteMemory {
    #[serde(default)]
    pub mode: LineMode,
    /// The Zone was reached on this computer.
    #[serde(default)]
    pub local: bool,
    /// The address in this network that worked last.
    #[serde(default)]
    pub last_lan: Option<IpAddr>,
    #[serde(default)]
    pub devices: Vec<KnownDevice>,
}

impl RouteMemory {
    /// The addresses to try, the likeliest first.
    fn candidates(&self) -> Vec<IpAddr> {
        let mut seen = HashSet::new();
        let oods = self.devices.iter().filter(|device| device.is_ood);
        let others = self.devices.iter().filter(|device| !device.is_ood);
        self.last_lan
            .into_iter()
            .chain(oods.chain(others).flat_map(|device| device.ips.iter().copied()))
            .filter(|address| is_lan(address) && seen.insert(*address))
            .collect()
    }
}

/// One way, and why it is or is not taken.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Attempt {
    #[serde(flatten)]
    pub line: Line,
    pub outcome: Outcome,
    pub detail: String,
}

/// How a Zone is reached now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LineStatus {
    /// `None`: nothing was tried yet.
    pub line: Option<Line>,
    /// The BuckyOS on this computer is the way and does not answer at the moment.
    pub waiting: bool,
    /// The last attempt over the internet failed.
    pub unreachable: bool,
    /// Why the direct ways are not taken.
    pub attempts: Vec<Attempt>,
    /// The end of the certificate's validity, where it was seen (Unix seconds).
    pub cert_expires_at: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
pub struct Times {
    pub local: Duration,
    pub lan: Duration,
    /// How long the BuckyOS on this computer may be away before another way is taken: starting it
    /// again takes about half a minute.
    pub local_grace: Duration,
    pub local_retry: Duration,
    /// Looking for a better way than the internet.
    pub better: Duration,
    /// Checking that a direct way still is one.
    pub again: Duration,
    /// How long a new network is given to be ready.
    pub settle: Duration,
    /// A search of the network is not repeated sooner.
    pub search: Duration,
    /// A connection may stay this long on a way no longer taken, and after that until it has nothing
    /// to carry for a tenth of it.
    pub leave: Duration,
    /// A request a device does not answer for this long makes its way doubtful.
    pub stall: Duration,
}

impl Default for Times {
    fn default() -> Self {
        Self {
            local: Duration::from_millis(300),
            lan: Duration::from_millis(800),
            local_grace: Duration::from_secs(60),
            local_retry: Duration::from_millis(500),
            better: Duration::from_secs(60),
            again: Duration::from_secs(600),
            settle: Duration::from_secs(3),
            search: Duration::from_secs(300),
            leave: Duration::from_secs(30),
            stall: Duration::from_secs(5),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Whether a BuckyOS can run on this device.
    pub local: bool,
    /// Whether to look for better ways without being told to.
    pub by_itself: bool,
    pub times: Times,
}

impl Default for Options {
    fn default() -> Self {
        Self { local: cfg!(desktop), by_itself: true, times: Times::default() }
    }
}

#[derive(Debug, Clone)]
pub enum RouteEvent {
    Line { host: String, status: LineStatus },
    Memory { host: String, memory: RouteMemory },
    /// The proxy has another port than before.
    Port,
}

type Listener = Box<dyn Fn(RouteEvent) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteZone {
    pub host: String,
    pub memory: RouteMemory,
}

struct State {
    memory: RouteMemory,
    line: Option<Line>,
    attempts: Vec<Attempt>,
    unreachable: bool,
    cert_expires_at: Option<u64>,
    local_down_since: Option<Instant>,
    looked: Option<Instant>,
    searched: Option<Instant>,
    suspected: Option<Instant>,
    looks: u64,
}

struct Zone {
    host: String,
    state: Mutex<State>,
    /// One search for a way at a time.
    looking: tokio::sync::Mutex<()>,
}

impl Zone {
    fn new(zone: RouteZone) -> Self {
        Self {
            host: zone.host,
            state: Mutex::new(State {
                memory: zone.memory,
                line: None,
                attempts: Vec::new(),
                unreachable: false,
                cert_expires_at: None,
                local_down_since: None,
                looked: None,
                searched: None,
                suspected: None,
                looks: 0,
            }),
            looking: tokio::sync::Mutex::new(()),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().expect("route poisoned")
    }

    fn status(&self) -> LineStatus {
        let state = self.lock();
        LineStatus {
            line: state.line,
            waiting: state.line == Some(Line::Local) && state.local_down_since.is_some(),
            unreachable: state.line == Some(Line::Internet) && state.unreachable,
            attempts: state.attempts.clone(),
            cert_expires_at: state.cert_expires_at,
        }
    }
}

/// A connection through the proxy.
struct Tunnel {
    zone: String,
    line: Line,
    /// The address of this device it leaves from.
    from: Option<IpAddr>,
    close: tokio::sync::Notify,
}

pub struct Router {
    net: Arc<dyn Net>,
    runtime: tokio::runtime::Handle,
    options: Options,
    zones: Mutex<HashMap<String, Arc<Zone>>>,
    tunnels: Mutex<HashMap<u64, Arc<Tunnel>>>,
    next_tunnel: AtomicU64,
    listener: OnceLock<Listener>,
    port: AtomicU16,
    /// Zones of this domain may come while the pages cannot be told of new ones.
    family: OnceLock<String>,
    /// The Zones are known: until then nobody may take the list for complete.
    ready: tokio::sync::watch::Sender<bool>,
    active: AtomicBool,
    changed: tokio::sync::Notify,
}

static ROUTER: OnceLock<Arc<Router>> = OnceLock::new();

/// The one of this process, once it is started.
pub fn current() -> Option<&'static Arc<Router>> {
    ROUTER.get()
}

pub fn install(router: Arc<Router>) -> &'static Arc<Router> {
    ROUTER.get_or_init(|| router)
}

impl Router {
    /// Must run inside the runtime that is to do the work.
    pub fn new(net: Arc<dyn Net>, options: Options) -> Arc<Self> {
        Arc::new(Self {
            net,
            runtime: tokio::runtime::Handle::current(),
            options,
            zones: Mutex::default(),
            tunnels: Mutex::default(),
            next_tunnel: AtomicU64::new(1),
            listener: OnceLock::new(),
            port: AtomicU16::new(0),
            family: OnceLock::new(),
            ready: tokio::sync::watch::channel(false).0,
            active: AtomicBool::new(true),
            changed: tokio::sync::Notify::new(),
        })
    }

    pub fn on_event(&self, listener: impl Fn(RouteEvent) + Send + Sync + 'static) {
        let _ = self.listener.set(Box::new(listener));
    }

    fn tell(&self, event: RouteEvent) {
        if let Some(listener) = self.listener.get() {
            listener(event);
        }
    }

    fn zones(&self) -> Vec<Arc<Zone>> {
        self.zones.lock().expect("routes poisoned").values().cloned().collect()
    }

    fn zone(&self, zone_host: &str) -> Option<Arc<Zone>> {
        self.zones.lock().expect("routes poisoned").get(zone_host).cloned()
    }

    /// The Zone one of whose hosts this is.
    fn zone_of(&self, host: &str) -> Option<Arc<Zone>> {
        let host = normalize_host(host);
        let zones = self.zones();
        find_zone(&host, zones.iter().map(|zone| zone.host.as_str())).map(|index| zones[index].clone())
    }

    pub fn hosts(&self) -> Vec<String> {
        let mut hosts: Vec<String> = self.zones().iter().map(|zone| zone.host.clone()).collect();
        hosts.sort();
        hosts
    }

    /// The Zones there are now. What is known about the ways to one that stays is kept.
    pub fn set_zones(self: &Arc<Self>, wanted: Vec<RouteZone>) {
        let mut new = Vec::new();
        let mut changed = Vec::new();
        {
            let mut zones = self.zones.lock().expect("routes poisoned");
            zones.retain(|host, _| wanted.iter().any(|zone| &zone.host == host));
            self.close_tunnels(|tunnel| !tunnel.zone.is_empty() && !wanted.iter().any(|zone| zone.host == tunnel.zone));
            for zone in wanted {
                match zones.get(&zone.host) {
                    Some(known) => {
                        let mut state = known.lock();
                        let other_devices = state.memory.devices != zone.memory.devices && !matches!(state.line, Some(Line::Local | Line::Lan(_)));
                        if state.memory.mode != zone.memory.mode || other_devices {
                            changed.push(known.clone());
                        }
                        state.memory = zone.memory;
                    }
                    None => {
                        let zone = Arc::new(Zone::new(zone));
                        zones.insert(zone.host.clone(), zone.clone());
                        new.push(zone);
                    }
                }
            }
        }
        self.ready.send_replace(true);
        for zone in new.into_iter().chain(changed) {
            self.look_soon(zone);
        }
        self.changed.notify_one();
    }

    /// Waits until the Zones are known.
    pub async fn ready(&self, timeout: Duration) {
        let mut ready = self.ready.subscribe();
        let _ = tokio::time::timeout(timeout, ready.wait_for(|ready| *ready)).await;
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::SeqCst)
    }

    /// Where the proxy listens.
    pub fn set_port(&self, port: u16) {
        if self.port.swap(port, Ordering::SeqCst) != port {
            self.tell(RouteEvent::Port);
        }
    }

    /// Must come before the Zones are known.
    pub fn set_family(&self, domain: &str) {
        let _ = self.family.set(normalize_host(domain));
    }

    pub fn family(&self) -> Option<&str> {
        self.family.get().map(String::as_str)
    }

    /// A host that is no Zone's yet and is passed on as it is.
    fn passes(&self, host: &str) -> bool {
        self.family().is_some_and(|family| matches!(classify_host(host, family), Some(ZoneHostKind::Sub(_) | ZoneHostKind::Sys)))
    }

    /// Where a request of the client's own to a host of a Zone goes.
    pub fn proxy_url(&self, host: &str) -> Option<String> {
        let port = self.port();
        (port != 0 && self.zone_of(host).is_some()).then(|| format!("http://127.0.0.1:{port}"))
    }

    pub fn status(&self, zone_host: &str) -> Option<LineStatus> {
        self.zone(zone_host).map(|zone| zone.status())
    }

    // ---- choosing ----

    /// The way to take. The first time this waits for the search; after that it never does.
    async fn line(self: &Arc<Self>, zone: &Arc<Zone>) -> Line {
        let known = zone.lock().line;
        if let Some(line) = known {
            return line;
        }
        let _turn = zone.looking.lock().await;
        let known = zone.lock().line;
        match known {
            Some(line) => line,
            None => self.look_now(zone).await,
        }
    }

    /// Searches again, unless one that was asked for later has done so meanwhile.
    async fn look(self: &Arc<Self>, zone: &Arc<Zone>) -> Line {
        let asked = zone.lock().looks;
        let _turn = zone.looking.lock().await;
        let known = {
            let state = zone.lock();
            state.line.filter(|_| state.looks > asked)
        };
        match known {
            Some(line) => line,
            None => self.look_now(zone).await,
        }
    }

    fn look_soon(self: &Arc<Self>, zone: Arc<Zone>) {
        let router = self.clone();
        self.runtime.spawn(async move {
            router.look(&zone).await;
        });
    }

    async fn look_now(self: &Arc<Self>, zone: &Arc<Zone>) -> Line {
        let times = self.options.times;
        let memory = {
            let mut state = zone.lock();
            state.looks += 1;
            state.looked = Some(Instant::now());
            state.memory.clone()
        };
        if memory.mode == LineMode::Internet {
            zone.lock().local_down_since = None;
            return self.take(zone, Line::Internet, Vec::new(), None);
        }
        let mut attempts = Vec::new();
        if self.options.local {
            let probe = self.net.probe(IpAddr::V4(Ipv4Addr::LOCALHOST), &zone.host, times.local).await;
            let expires_at = probe.expires_at;
            attempts.push(attempt(Line::Local, &probe));
            match probe.outcome {
                Outcome::Usable => {
                    self.remember(zone, |memory| memory.local = true);
                    zone.lock().local_down_since = None;
                    return self.take(zone, Line::Local, attempts, expires_at);
                }
                Outcome::Expired | Outcome::Untrusted => {
                    zone.lock().local_down_since = None;
                    self.remember(zone, |memory| memory.local = false);
                    if probe.outcome == Outcome::Expired {
                        zone.lock().cert_expires_at = expires_at;
                    }
                }
                // It was here and is not now: it may only be starting again.
                _ if memory.local => {
                    let down = zone.lock().local_down_since.get_or_insert_with(Instant::now).elapsed();
                    if down < times.local_grace {
                        return self.take(zone, Line::Local, attempts, None);
                    }
                    log::info!("[route] {}: not on this computer any more", zone.host);
                    zone.lock().local_down_since = None;
                    self.remember(zone, |memory| memory.local = false);
                }
                _ => zone.lock().local_down_since = None,
            }
        }
        let candidates = memory.candidates();
        let probes = futures::future::join_all(candidates.iter().map(|address| self.net.probe(*address, &zone.host, times.lan))).await;
        let mut found = None;
        for (address, probe) in candidates.iter().zip(&probes) {
            attempts.push(attempt(Line::Lan(*address), probe));
            match probe.outcome {
                Outcome::Usable if found.is_none() => found = Some((*address, probe.expires_at)),
                Outcome::Expired => zone.lock().cert_expires_at = probe.expires_at,
                _ => {}
            }
        }
        if let Some((address, expires_at)) = found {
            self.remember(zone, |memory| memory.last_lan = Some(address));
            return self.take(zone, Line::Lan(address), attempts, expires_at);
        }
        let line = self.take(zone, Line::Internet, attempts, None);
        self.search_soon(zone, &candidates);
        line
    }

    /// Devices of the Zone whose address changed are looked for in a network one of them was in.
    fn search_soon(self: &Arc<Self>, zone: &Arc<Zone>, known: &[IpAddr]) {
        let addresses = neighbours(&self.net.interfaces(), Some(known));
        if addresses.is_empty() {
            return;
        }
        {
            let mut state = zone.lock();
            if state.searched.is_some_and(|at| at.elapsed() < self.options.times.search) {
                return;
            }
            state.searched = Some(Instant::now());
        }
        let (router, zone) = (self.clone(), zone.clone());
        self.runtime.spawn(async move {
            router.search(&zone, addresses).await;
        });
    }

    async fn search(self: &Arc<Self>, zone: &Arc<Zone>, addresses: Vec<IpAddr>) -> bool {
        let Some(address) = self.net.scan(addresses, &zone.host).await else { return false };
        log::info!("[route] {} found at {address}", zone.host);
        self.remember(zone, |memory| memory.last_lan = Some(address));
        self.look(zone).await == Line::Lan(address)
    }

    /// The user asks to look for the Zone in the network this device is in.
    pub async fn find(self: &Arc<Self>, zone_host: &str) -> bool {
        let Some(zone) = self.zone(zone_host) else { return false };
        if matches!(self.look(&zone).await, Line::Local | Line::Lan(_)) {
            return true;
        }
        zone.lock().searched = Some(Instant::now());
        let addresses = neighbours(&self.net.interfaces(), None);
        self.search(&zone, addresses).await
    }

    fn remember(&self, zone: &Zone, change: impl FnOnce(&mut RouteMemory)) {
        let memory = {
            let mut state = zone.lock();
            let before = state.memory.clone();
            change(&mut state.memory);
            (state.memory != before).then(|| state.memory.clone())
        };
        if let Some(memory) = memory {
            self.tell(RouteEvent::Memory { host: zone.host.clone(), memory });
        }
    }

    fn take(&self, zone: &Arc<Zone>, line: Line, attempts: Vec<Attempt>, expires_at: Option<u64>) -> Line {
        let before = zone.status();
        let old = {
            let mut state = zone.lock();
            let old = state.line.replace(line);
            state.attempts = attempts;
            if expires_at.is_some() {
                state.cert_expires_at = expires_at;
            }
            if old != Some(line) {
                state.unreachable = false;
            }
            old
        };
        let status = zone.status();
        if old != Some(line) {
            log::info!("[route] {}: {line:?}", zone.host);
            // Ways found dead lose their connections at once; better ways take over gently.
            let dead = |tunnel: &Tunnel| tunnel.line != Line::Internet && status.attempts.iter().any(|attempt| attempt.line == tunnel.line && attempt.outcome != Outcome::Usable);
            self.close_tunnels(|tunnel| tunnel.zone == zone.host && tunnel.line != line && dead(tunnel));
        }
        if status != before {
            self.tell(RouteEvent::Line { host: zone.host.clone(), status });
            self.changed.notify_one();
        }
        line
    }

    fn close_tunnels(&self, which: impl Fn(&Tunnel) -> bool) {
        for tunnel in self.tunnels.lock().expect("tunnels poisoned").values().filter(|tunnel| which(tunnel)) {
            tunnel.close.notify_one();
        }
    }

    /// A device does not answer what was sent to it.
    async fn suspect(self: &Arc<Self>, zone_host: &str) {
        let Some(zone) = self.zone(zone_host) else { return };
        {
            let mut state = zone.lock();
            if state.suspected.is_some_and(|at| at.elapsed() < self.options.times.stall * 2) {
                return;
            }
            state.suspected = Some(Instant::now());
        }
        self.look(&zone).await;
    }

    // ---- what happens around ----

    /// This device is in another network, or woke up.
    pub async fn network_changed(self: &Arc<Self>) {
        let own = self.net.interfaces();
        self.close_tunnels(|tunnel| tunnel.from.is_some_and(|from| !from.is_loopback() && !own.contains(&from)));
        let looks = self.zones().into_iter().map(|zone| async move {
            {
                let mut state = zone.lock();
                state.searched = None;
                state.unreachable = false;
            }
            self.look(&zone).await;
        });
        futures::future::join_all(looks).await;
        // A network that only just came is not always ready.
        let router = self.clone();
        self.runtime.spawn(async move {
            tokio::time::sleep(router.options.times.settle).await;
            for zone in router.zones() {
                let direct = matches!(zone.lock().line, Some(Line::Local | Line::Lan(_)));
                if !direct {
                    router.look(&zone).await;
                }
            }
        });
    }

    /// While nobody looks at the client nothing better is looked for either.
    #[cfg(any(mobile, test))]
    pub fn set_active(&self, active: bool) {
        self.active.store(active, Ordering::SeqCst);
        self.changed.notify_one();
    }

    #[cfg(test)]
    pub async fn check(self: &Arc<Self>, zone_host: &str) {
        if let Some(zone) = self.zone(zone_host) {
            self.look(&zone).await;
        }
    }

    /// Looks again when it is time to. Runs until it is dropped.
    pub async fn keep_looking(self: &Arc<Self>) {
        loop {
            let mut next = Duration::from_secs(3600);
            if self.active.load(Ordering::SeqCst) {
                for zone in self.zones() {
                    let wait = self.due_in(&zone);
                    if wait.is_zero() {
                        self.look(&zone).await;
                    }
                    next = next.min(self.due_in(&zone));
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(next.max(Duration::from_millis(50))) => {}
                _ = self.changed.notified() => {}
            }
        }
    }

    fn due_in(&self, zone: &Zone) -> Duration {
        let times = self.options.times;
        let state = zone.lock();
        let Some(looked) = state.looked else { return Duration::from_secs(1) };
        let every = match state.line {
            Some(Line::Local) if state.local_down_since.is_some() => times.local_retry * 2,
            _ if !self.options.by_itself => return Duration::from_secs(3600),
            Some(Line::Internet) if state.memory.mode == LineMode::Internet => times.again,
            Some(Line::Internet) => times.better,
            // The BuckyOS on this computer may have started meanwhile.
            Some(Line::Lan(_)) if self.options.local => times.better,
            _ => times.again,
        };
        every.saturating_sub(looked.elapsed())
    }

    // ---- connecting ----

    /// A connection to a host of a Zone, and the way it took.
    async fn dial(self: &Arc<Self>, zone: &Arc<Zone>, host: &str, port: u16) -> io::Result<(TcpStream, Line)> {
        // Only https has its other ways; the rest goes as it always did.
        if port != HTTPS {
            return Ok((self.net.dial_system(host, port).await?, Line::Internet));
        }
        let times = self.options.times;
        let started = Instant::now();
        let mut line = self.line(zone).await;
        let mut tried = HashSet::new();
        loop {
            match line {
                Line::Local => match self.net.dial(IpAddr::V4(Ipv4Addr::LOCALHOST), times.local).await {
                    Ok(stream) => {
                        if zone.lock().local_down_since.is_some() {
                            self.look_soon(zone.clone());
                        }
                        return Ok((stream, line));
                    }
                    Err(error) => {
                        if started.elapsed() > times.local_grace * 2 {
                            return Err(error);
                        }
                        // The search keeps to this computer until the grace is over.
                        line = self.look(zone).await;
                        if line == Line::Local {
                            tokio::time::sleep(times.local_retry).await;
                        }
                    }
                },
                Line::Lan(address) => match self.net.dial(address, times.lan).await {
                    Ok(stream) => return Ok((stream, line)),
                    Err(error) => {
                        if !tried.insert(address) {
                            return Err(error);
                        }
                        line = self.look(zone).await;
                    }
                },
                Line::Internet => {
                    let result = self.net.dial_system(host, port).await;
                    self.went_over_internet(zone, result.is_ok());
                    return result.map(|stream| (stream, line));
                }
            }
        }
    }

    fn went_over_internet(&self, zone: &Zone, arrived: bool) {
        let before = zone.status();
        zone.lock().unreachable = !arrived;
        let status = zone.status();
        if status != before {
            self.tell(RouteEvent::Line { host: zone.host.clone(), status });
        }
    }

    /// Every way to a Zone and what is wrong with it, tried now.
    pub async fn diagnose(self: &Arc<Self>, zone_host: &str) -> Vec<Attempt> {
        let Some(zone) = self.zone(zone_host) else { return Vec::new() };
        self.look(&zone).await;
        let mut attempts = zone.lock().attempts.clone();
        let probe = match self.net.dial_system(&zone.host, HTTPS).await {
            Ok(stream) => self.net.check(stream, &zone.host).await,
            Err(error) => Probe::from_io(&error),
        };
        self.went_over_internet(&zone, probe.outcome == Outcome::Usable);
        attempts.push(attempt(Line::Internet, &probe));
        attempts
    }
}

fn attempt(line: Line, probe: &Probe) -> Attempt {
    Attempt { line, outcome: probe.outcome, detail: probe.detail.clone() }
}

#[cfg(test)]
mod tests;
