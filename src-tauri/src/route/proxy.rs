//! The client's own proxy on this device: HTTP CONNECT and SOCKS5 to hosts of the Zones, and the
//! auto-configuration script that says so. It moves bytes and never opens the TLS inside them.

use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::pac::{self, SystemSettings};
use super::{Line, Router, Tunnel, Zone};
use crate::zone::host::normalize_host;

const MAX_HEAD: usize = 16 * 1024;
const HEAD_TIMEOUT: Duration = Duration::from_secs(15);
const READY_TIMEOUT: Duration = Duration::from_secs(10);
const ACCEPT_PAUSE: Duration = Duration::from_millis(200);
/// Where the settings of a browser find the script.
pub const BROWSER_PORT: u16 = 3187;
pub const BROWSER_PATH: &str = "/proxy.pac";

/// Who uses a listener.
#[derive(Debug, Clone)]
pub enum Entry {
    /// The client's own pages and requests.
    Client {
        /// Where the script is; nobody else is to find it.
        pac_path: String,
        /// Other hosts are passed on as they are (a WebView that cannot tell hosts apart).
        pass_others: bool,
    },
    /// A browser whose settings name the script.
    Browser,
}

pub struct Listening {
    pub port: u16,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Listening {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Listens on this device only. Must run inside a runtime.
pub fn listen(router: Arc<Router>, port: u16, entry: Entry) -> io::Result<Listening> {
    let listener = std::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port)))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    let runtime = router.runtime.clone();
    let listener = {
        let _runtime = runtime.enter();
        TcpListener::from_std(listener)?
    };
    let entry = Arc::new(entry);
    let task = runtime.spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let (router, entry) = (router.clone(), entry.clone());
                    tokio::spawn(async move {
                        if let Err(error) = serve(router, stream, &entry, port).await {
                            log::debug!("[route] a connection: {error}");
                        }
                    });
                }
                Err(error) => {
                    log::warn!("[route] listening: {error}");
                    tokio::time::sleep(ACCEPT_PAUSE).await;
                }
            }
        }
    });
    Ok(Listening { port, task })
}

/// Whether somebody still listens: a phone takes the sockets of an app it put to sleep away.
#[cfg(any(mobile, test))]
pub async fn answers(port: u16) -> bool {
    let connect = TcpStream::connect((Ipv4Addr::LOCALHOST, port));
    matches!(tokio::time::timeout(Duration::from_millis(300), connect).await, Ok(Ok(_)))
}

async fn serve(router: Arc<Router>, mut stream: TcpStream, entry: &Entry, port: u16) -> io::Result<()> {
    let _ = stream.set_nodelay(true);
    let mut first = [0u8; 1];
    let asked = async {
        stream.read_exact(&mut first).await?;
        if first[0] == 5 {
            socks_target(&mut stream).await.map(Asked::Socks)
        } else {
            http_request(&mut stream, first[0]).await.map(Asked::Http)
        }
    };
    let asked = tokio::time::timeout(HEAD_TIMEOUT, asked).await.map_err(|_| io::Error::from(io::ErrorKind::TimedOut))??;
    match asked {
        Asked::Socks(None) => Ok(()),
        Asked::Socks(Some((host, target_port))) => match open(&router, entry, &host, target_port).await {
            Ok(opened) => {
                stream.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
                tunnel(router, stream, Vec::new(), opened).await
            }
            Err(error) => {
                let code = match error.kind() {
                    io::ErrorKind::PermissionDenied => 2,
                    io::ErrorKind::ConnectionRefused => 5,
                    _ => 4,
                };
                stream.write_all(&[5, code, 0, 1, 0, 0, 0, 0, 0, 0]).await
            }
        },
        Asked::Http(request) if request.method == "CONNECT" => {
            let Some((host, target_port)) = authority(&request.target) else {
                return answer(&mut stream, "400 Bad Request", "", "").await;
            };
            match open(&router, entry, &host, target_port).await {
                Ok(opened) => {
                    stream.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await?;
                    tunnel(router, stream, request.rest, opened).await
                }
                Err(error) if error.kind() == io::ErrorKind::PermissionDenied => answer(&mut stream, "403 Forbidden", "", "").await,
                Err(error) => {
                    log::info!("[route] {host}: {error}");
                    answer(&mut stream, "502 Bad Gateway", "", "").await
                }
            }
        }
        Asked::Http(request) if request.method == "GET" && wants_script(&request, entry, port) => {
            router.ready(READY_TIMEOUT).await;
            let script = pac::script(&router.hosts(), router.family(), port, system_settings(entry).as_ref());
            let headers = "Content-Type: application/x-ns-proxy-autoconfig\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n";
            answer(&mut stream, "200 OK", headers, &script).await
        }
        Asked::Http(_) => answer(&mut stream, "403 Forbidden", "", "").await,
    }
}

async fn answer(stream: &mut TcpStream, status: &str, headers: &str, body: &str) -> io::Result<()> {
    let head = format!("HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body.as_bytes()).await?;
    stream.shutdown().await
}

/// A script set in the WebView replaces the system's settings; set in the system it is one of them.
fn system_settings(entry: &Entry) -> Option<SystemSettings> {
    match entry {
        #[cfg(target_os = "windows")]
        Entry::Client { .. } => super::webview::system_settings(),
        _ => None,
    }
}

enum Asked {
    Http(Request),
    Socks(Option<(String, u16)>),
}

struct Request {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    /// What came after the head.
    rest: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(key, _)| key.eq_ignore_ascii_case(name)).map(|(_, value)| value.as_str())
    }

    /// Sent for a page.
    fn from_page(&self) -> bool {
        self.headers.iter().any(|(name, _)| {
            let name = name.to_ascii_lowercase();
            name.starts_with("sec-fetch-") || name == "origin" || name == "referer"
        })
    }
}

/// The script names the Zones of the user; no page gets it.
fn wants_script(request: &Request, entry: &Entry, port: u16) -> bool {
    let path = request.target.split('?').next().unwrap_or_default();
    let wanted = match entry {
        Entry::Client { pac_path, .. } => pac_path.as_str(),
        Entry::Browser => BROWSER_PATH,
    };
    // A name that was pointed here is not this device's own.
    let here = request.header("host").is_some_and(|host| host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}"));
    path == wanted && here && !request.from_page()
}

async fn http_request(stream: &mut TcpStream, first: u8) -> io::Result<Request> {
    let bad = || io::Error::from(io::ErrorKind::InvalidData);
    let mut head = vec![first];
    let mut chunk = [0u8; 2048];
    let end = loop {
        if let Some(at) = head.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            break at;
        }
        if head.len() > MAX_HEAD {
            return Err(bad());
        }
        let count = stream.read(&mut chunk).await?;
        if count == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        head.extend_from_slice(&chunk[..count]);
    };
    let rest = head.split_off(end + 4);
    let text = std::str::from_utf8(&head).map_err(|_| bad())?;
    let mut lines = text.split("\r\n");
    let mut line = lines.next().unwrap_or_default().split(' ');
    let (Some(method), Some(target)) = (line.next(), line.next()) else { return Err(bad()) };
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .collect();
    Ok(Request { method: method.to_string(), target: target.to_string(), headers, rest })
}

fn authority(target: &str) -> Option<(String, u16)> {
    let (host, port) = target.rsplit_once(':')?;
    let host = normalize_host(host);
    (!host.is_empty() && !host.contains([':', '[', '/', '@'])).then_some(())?;
    Some((host, port.parse().ok()?))
}

/// The greeting and the request of SOCKS5; `None` when the answer was a refusal.
async fn socks_target(stream: &mut TcpStream) -> io::Result<Option<(String, u16)>> {
    let count = stream.read_u8().await? as usize;
    let mut methods = vec![0u8; count];
    stream.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        stream.write_all(&[5, 0xff]).await?;
        return Ok(None);
    }
    stream.write_all(&[5, 0]).await?;
    let mut request = [0u8; 4];
    stream.read_exact(&mut request).await?;
    // Only connections, and only to names: an address belongs to no Zone.
    if request[0] != 5 || request[1] != 1 || request[3] != 3 {
        let code = if request[1] != 1 { 7 } else { 8 };
        stream.write_all(&[5, code, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
        return Ok(None);
    }
    let length = stream.read_u8().await? as usize;
    let mut name = vec![0u8; length];
    stream.read_exact(&mut name).await?;
    let port = stream.read_u16().await?;
    Ok(String::from_utf8(name).ok().map(|name| (normalize_host(&name), port)))
}

struct Opened {
    stream: TcpStream,
    line: Line,
    zone: Option<Arc<Zone>>,
}

async fn open(router: &Arc<Router>, entry: &Entry, host: &str, port: u16) -> io::Result<Opened> {
    // Just started: the Zones are about to be known.
    router.ready(READY_TIMEOUT).await;
    if let Some(zone) = router.zone_of(host) {
        let (stream, line) = router.dial(&zone, host, port).await?;
        return Ok(Opened { stream, line, zone: Some(zone) });
    }
    if !matches!(entry, Entry::Client { pass_others: true, .. }) && !router.passes(host) {
        return Err(io::ErrorKind::PermissionDenied.into());
    }
    let stream = router.net.dial_system(host, port).await?;
    Ok(Opened { stream, line: Line::Internet, zone: None })
}

/// When the connection last carried something, for `watch`.
struct Traffic {
    started: Instant,
    bytes: AtomicU64,
    /// Milliseconds since `started` at which something was sent that nothing came back for; 0 for none.
    unanswered: AtomicU64,
}

impl Traffic {
    fn now(&self) -> u64 {
        self.started.elapsed().as_millis() as u64 + 1
    }

    fn sent(&self, count: usize) {
        self.bytes.fetch_add(count as u64, Ordering::Relaxed);
        let _ = self.unanswered.compare_exchange(0, self.now(), Ordering::Relaxed, Ordering::Relaxed);
    }

    fn received(&self, count: usize) {
        self.bytes.fetch_add(count as u64, Ordering::Relaxed);
        self.unanswered.store(0, Ordering::Relaxed);
    }
}

async fn tunnel(router: Arc<Router>, client: TcpStream, early: Vec<u8>, opened: Opened) -> io::Result<()> {
    let Opened { stream: mut server, line, zone } = opened;
    let traffic = Arc::new(Traffic { started: Instant::now(), bytes: AtomicU64::new(0), unanswered: AtomicU64::new(0) });
    let record = Arc::new(Tunnel {
        zone: zone.as_ref().map(|zone| zone.host.clone()).unwrap_or_default(),
        line,
        from: server.local_addr().ok().map(|address| address.ip()),
        close: tokio::sync::Notify::new(),
    });
    let registration = Registration::new(&router, record.clone());
    if !early.is_empty() {
        server.write_all(&early).await?;
        traffic.sent(early.len());
    }
    let (client_in, client_out) = client.into_split();
    let (server_in, server_out) = server.into_split();
    let moving = async {
        tokio::try_join!(
            pump(client_in, server_out, |count| traffic.sent(count)),
            pump(server_in, client_out, |count| traffic.received(count)),
        )
    };
    tokio::select! {
        result = moving => { result?; }
        _ = record.close.notified() => {}
        _ = watch(&router, &record, zone, &traffic) => {}
    }
    drop(registration);
    Ok(())
}

async fn pump(
    mut from: tokio::net::tcp::OwnedReadHalf,
    mut to: tokio::net::tcp::OwnedWriteHalf,
    moved: impl Fn(usize),
) -> io::Result<()> {
    let mut buffer = vec![0u8; 32 * 1024];
    loop {
        let count = from.read(&mut buffer).await?;
        if count == 0 {
            return to.shutdown().await;
        }
        to.write_all(&buffer[..count]).await?;
        moved(count);
    }
}

/// Ends when the connection has been on a way no longer taken for a while, at a moment at which
/// nothing is under way. A browser would go on with it for as long as it has something to ask.
async fn watch(router: &Arc<Router>, tunnel: &Tunnel, zone: Option<Arc<Zone>>, traffic: &Traffic) {
    let Some(zone) = zone else { return std::future::pending().await };
    let times = router.options.times;
    let gap = times.leave / 10;
    let mut moved: Option<Instant> = None;
    let mut carried = (Instant::now(), traffic.bytes.load(Ordering::Relaxed));
    loop {
        tokio::time::sleep(gap / 3).await;
        let unanswered = traffic.unanswered.load(Ordering::Relaxed);
        let waited = Duration::from_millis(traffic.now().saturating_sub(unanswered));
        if unanswered != 0 && waited > times.stall && matches!(tunnel.line, Line::Lan(_)) {
            router.suspect(&zone.host).await;
        }
        let bytes = traffic.bytes.load(Ordering::Relaxed);
        if bytes != carried.1 {
            carried = (Instant::now(), bytes);
        }
        moved = zone.lock().line.filter(|line| *line != tunnel.line).and(moved.or_else(|| Some(Instant::now())));
        let due = moved.is_some_and(|since| since.elapsed() >= times.leave);
        if due && unanswered == 0 && carried.0.elapsed() >= gap {
            return;
        }
    }
}

struct Registration {
    router: Arc<Router>,
    id: u64,
}

impl Registration {
    fn new(router: &Arc<Router>, tunnel: Arc<Tunnel>) -> Self {
        let id = router.next_tunnel.fetch_add(1, Ordering::Relaxed);
        router.tunnels.lock().expect("tunnels poisoned").insert(id, tunnel);
        Self { router: router.clone(), id }
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        self.router.tunnels.lock().expect("tunnels poisoned").remove(&self.id);
    }
}
