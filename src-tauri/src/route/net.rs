//! Connections out of the client: to a device of a Zone, and the way the system would go.

use futures::future::BoxFuture;
use futures::stream::{FuturesUnordered, StreamExt};
use std::collections::HashSet;
use std::io;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpSocket, TcpStream};

use super::tls::{self, Outcome, Probe};

pub const HTTPS: u16 = 443;
const DIAL_STAGGER: Duration = Duration::from_millis(250);
const SYSTEM_TIMEOUT: Duration = Duration::from_secs(15);
const CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_PROXY_ANSWER: usize = 16 * 1024;

/// What the routing needs from the network; tests answer it from memory.
pub trait Net: Send + Sync {
    /// Whether a device of the Zone answers at an address.
    fn probe<'a>(&'a self, address: IpAddr, host: &'a str, timeout: Duration) -> BoxFuture<'a, Probe>;
    /// The same on a connection that is there already.
    fn check<'a>(&'a self, stream: TcpStream, host: &'a str) -> BoxFuture<'a, Probe>;
    fn dial(&self, address: IpAddr, timeout: Duration) -> BoxFuture<'_, io::Result<TcpStream>>;
    /// As the system resolves the name and gets there.
    fn dial_system<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, io::Result<TcpStream>>;
    /// Which devices of the Zone there are among these.
    fn scan<'a>(&'a self, addresses: Vec<IpAddr>, host: &'a str) -> BoxFuture<'a, Option<IpAddr>>;
    fn interfaces(&self) -> Vec<IpAddr>;
}

pub struct SystemNet;

impl Net for SystemNet {
    fn probe<'a>(&'a self, address: IpAddr, host: &'a str, timeout: Duration) -> BoxFuture<'a, Probe> {
        Box::pin(probe_at(SocketAddr::new(address, HTTPS), host, timeout))
    }

    fn check<'a>(&'a self, stream: TcpStream, host: &'a str) -> BoxFuture<'a, Probe> {
        Box::pin(async move {
            let verifier = match tls::trusted().await {
                Ok(verifier) => verifier,
                Err(error) => return Probe::of(Outcome::Unreachable, error),
            };
            match tokio::time::timeout(CHECK_TIMEOUT, tls::handshake(stream, host, verifier)).await {
                Ok(probe) => probe,
                Err(_) => Probe::of(Outcome::Timeout, "no answer"),
            }
        })
    }

    fn dial(&self, address: IpAddr, timeout: Duration) -> BoxFuture<'_, io::Result<TcpStream>> {
        Box::pin(async move {
            match tokio::time::timeout(timeout, connect(SocketAddr::new(address, HTTPS), true)).await {
                Ok(result) => result,
                Err(_) => Err(io::ErrorKind::TimedOut.into()),
            }
        })
    }

    fn dial_system<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, io::Result<TcpStream>> {
        Box::pin(async move {
            match tokio::time::timeout(SYSTEM_TIMEOUT, dial_system(host, port)).await {
                Ok(result) => result,
                Err(_) => Err(io::ErrorKind::TimedOut.into()),
            }
        })
    }

    fn scan<'a>(&'a self, addresses: Vec<IpAddr>, host: &'a str) -> BoxFuture<'a, Option<IpAddr>> {
        Box::pin(scan(addresses, host))
    }

    fn interfaces(&self) -> Vec<IpAddr> {
        interfaces()
    }
}

/// The addresses of this device, apart from the loopback ones.
pub fn interfaces() -> Vec<IpAddr> {
    let mut found: Vec<IpAddr> = match if_addrs::get_if_addrs() {
        Ok(found) => found.into_iter().map(|interface| interface.ip()).filter(|ip| !ip.is_loopback()).collect(),
        Err(error) => {
            log::warn!("[route] this device's addresses: {error}");
            Vec::new()
        }
    };
    found.sort();
    found.dedup();
    found
}

/// An address of a home or office network, where a device of the Zone may be reached directly.
pub fn is_lan(address: &IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let shared = address.octets()[0] == 100 && (address.octets()[1] & 0xc0) == 64;
            address.is_private() || shared
        }
        IpAddr::V6(address) => address.segments()[0] & 0xfe00 == 0xfc00,
    }
}

fn subnet(address: &IpAddr) -> Option<[u8; 3]> {
    match address {
        IpAddr::V4(address) if address.is_private() => {
            let [a, b, c, _] = address.octets();
            Some([a, b, c])
        }
        _ => None,
    }
}

/// The other addresses of the networks this device is in; with `known`, only of those a known
/// address is in too.
pub fn neighbours(own: &[IpAddr], known: Option<&[IpAddr]>) -> Vec<IpAddr> {
    let wanted: Option<HashSet<[u8; 3]>> = known.map(|known| known.iter().filter_map(subnet).collect());
    let mut networks: Vec<[u8; 3]> = own.iter().filter_map(subnet).collect();
    networks.sort_unstable();
    networks.dedup();
    networks
        .into_iter()
        .filter(|network| wanted.as_ref().is_none_or(|wanted| wanted.contains(network)))
        .flat_map(|[a, b, c]| (1..255).map(move |d| IpAddr::V4(Ipv4Addr::new(a, b, c, d))))
        .filter(|address| !own.contains(address))
        .collect()
}

// ---- to a device ----

#[cfg(target_os = "android")]
mod wifi {
    use std::os::fd::AsRawFd;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NETWORK: AtomicU64 = AtomicU64::new(0);

    #[link(name = "android")]
    extern "C" {
        fn android_setsocknetwork(network: u64, fd: std::ffi::c_int) -> std::ffi::c_int;
    }

    /// The handle of the Wi-Fi network, 0 for none.
    pub fn set(network: u64) -> bool {
        NETWORK.swap(network, Ordering::SeqCst) != network
    }

    /// A Wi-Fi without internet is not the default network: what goes to it has to say so.
    pub fn bind(socket: &tokio::net::TcpSocket) -> std::io::Result<()> {
        let network = NETWORK.load(Ordering::SeqCst);
        // SAFETY: the socket is open.
        if network != 0 && unsafe { android_setsocknetwork(network, socket.as_raw_fd()) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
}

#[cfg(target_os = "android")]
pub use wifi::set as set_wifi;

async fn connect(address: SocketAddr, device: bool) -> io::Result<TcpStream> {
    let socket = if address.is_ipv4() { TcpSocket::new_v4()? } else { TcpSocket::new_v6()? };
    #[cfg(target_os = "android")]
    if device && !address.ip().is_loopback() {
        wifi::bind(&socket)?;
    }
    #[cfg(not(target_os = "android"))]
    let _ = device;
    let stream = socket.connect(address).await?;
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

pub async fn probe_at(address: SocketAddr, host: &str, timeout: Duration) -> Probe {
    let verifier = match tls::trusted().await {
        Ok(verifier) => verifier,
        Err(error) => return Probe::of(Outcome::Unreachable, error),
    };
    let work = async {
        match connect(address, true).await {
            Ok(stream) => tls::handshake(stream, host, verifier).await,
            Err(error) => Probe::from_io(&error),
        }
    };
    match tokio::time::timeout(timeout, work).await {
        Ok(probe) => probe,
        Err(_) => Probe::of(Outcome::Timeout, "no answer"),
    }
}

const SCAN_CONCURRENCY: usize = 64;
const SCAN_TIMEOUT: Duration = Duration::from_millis(1500);

async fn scan(addresses: Vec<IpAddr>, host: &str) -> Option<IpAddr> {
    let mut pending = addresses.into_iter();
    let look = |address: IpAddr| async move {
        let probe = probe_at(SocketAddr::new(address, HTTPS), host, SCAN_TIMEOUT).await;
        (probe.outcome == Outcome::Usable).then_some(address)
    };
    let mut running: FuturesUnordered<_> = pending.by_ref().take(SCAN_CONCURRENCY).map(look).collect();
    while let Some(found) = running.next().await {
        if found.is_some() {
            return found;
        }
        if let Some(address) = pending.next() {
            running.push(look(address));
        }
    }
    None
}

// ---- as the system goes ----

/// The proxy the system is set to use for a host, as the client's other requests find it.
pub fn system_proxy(host: &str) -> Option<SystemProxy> {
    let target: http::Uri = format!("https://{host}/").parse().ok()?;
    let found = hyper_util::client::proxy::matcher::Matcher::from_system().intercept(&target)?;
    let uri = found.uri();
    if uri.scheme_str() != Some("http") {
        return None;
    }
    Some(SystemProxy {
        host: uri.host()?.trim_matches(['[', ']']).to_string(),
        port: uri.port_u16().unwrap_or(80),
        authorization: found.basic_auth().and_then(|value| value.to_str().ok()).map(str::to_string),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemProxy {
    pub host: String,
    pub port: u16,
    pub authorization: Option<String>,
}

async fn dial_system(host: &str, port: u16) -> io::Result<TcpStream> {
    match system_proxy(host) {
        Some(proxy) => through(&proxy, host, port).await,
        None => dial_name(host, port).await,
    }
}

/// The addresses of a name, each tried a little after the one before it.
async fn dial_name(host: &str, port: u16) -> io::Result<TcpStream> {
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await?.collect();
    let mut last = io::Error::new(io::ErrorKind::NotFound, "the name has no address");
    let mut waiting = interleaved(addresses).into_iter();
    let mut running = FuturesUnordered::new();
    loop {
        if let Some(address) = waiting.next() {
            running.push(connect(address, false));
        } else if running.is_empty() {
            return Err(last);
        }
        let more = waiting.len() > 0;
        tokio::select! {
            Some(result) = running.next() => match result {
                Ok(stream) => return Ok(stream),
                Err(error) => last = error,
            },
            _ = tokio::time::sleep(DIAL_STAGGER), if more => {}
        }
    }
}

/// In the resolver's order, the two families taking turns.
fn interleaved(addresses: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let first_family = addresses.first().is_some_and(SocketAddr::is_ipv6);
    let (first, second): (Vec<_>, Vec<_>) = addresses.into_iter().partition(|address| address.is_ipv6() == first_family);
    let (mut first, mut second) = (first.into_iter(), second.into_iter());
    let mut ordered = Vec::new();
    loop {
        let (left, right) = (first.next(), second.next());
        if left.is_none() && right.is_none() {
            return ordered;
        }
        ordered.extend(left);
        ordered.extend(right);
    }
}

async fn through(proxy: &SystemProxy, host: &str, port: u16) -> io::Result<TcpStream> {
    let mut stream = dial_name(&proxy.host, proxy.port).await?;
    let authorization = proxy.authorization.as_ref().map(|value| format!("Proxy-Authorization: {value}\r\n")).unwrap_or_default();
    let request = format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n{authorization}\r\n");
    stream.write_all(request.as_bytes()).await?;
    // The answer is read a byte at a time: what follows it is the tunnel's.
    let mut answer = Vec::new();
    while !answer.ends_with(b"\r\n\r\n") {
        if answer.len() >= MAX_PROXY_ANSWER {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "the system's proxy answered too much"));
        }
        answer.push(stream.read_u8().await?);
    }
    let status = String::from_utf8_lossy(&answer);
    let status = status.lines().next().unwrap_or_default();
    if status.split(' ').nth(1).is_some_and(|code| code.starts_with('2')) {
        Ok(stream)
    } else {
        Err(io::Error::new(io::ErrorKind::ConnectionAborted, format!("the system's proxy: {status}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn knows_the_addresses_of_home_networks() {
        for address in ["192.168.1.5", "10.0.0.1", "172.16.9.9", "100.80.1.1", "fd00::1"] {
            assert!(is_lan(&ip(address)), "{address}");
        }
        for address in ["127.0.0.1", "8.8.8.8", "100.200.1.1", "169.254.1.1", "2001:db8::1", "fe80::1", "::1"] {
            assert!(!is_lan(&ip(address)), "{address}");
        }
    }

    #[test]
    fn looks_around_only_in_a_network_it_knows() {
        let own = [ip("192.168.1.20"), ip("10.1.2.3"), ip("2001:db8::2")];
        let found = neighbours(&own, Some(&[ip("192.168.1.8"), ip("172.17.0.1")]));
        assert_eq!(found.len(), 253);
        assert!(found.contains(&ip("192.168.1.8")) && !found.contains(&ip("192.168.1.20")));
        assert!(neighbours(&own, Some(&[ip("192.168.7.8")])).is_empty());
        assert_eq!(neighbours(&own, None).len(), 2 * 253);
        assert!(neighbours(&[ip("100.80.1.1")], None).is_empty());
    }

    #[test]
    fn the_address_families_take_turns() {
        let address = |text: &str| -> SocketAddr { text.parse().unwrap() };
        let six = ["[2001:db8::1]:443", "[2001:db8::2]:443"].map(address);
        let four = ["192.0.2.1:443"].map(address);
        assert_eq!(interleaved([six[0], six[1], four[0]].to_vec()), [six[0], four[0], six[1]]);
        assert_eq!(interleaved([four[0], six[0]].to_vec()), [four[0], six[0]]);
    }

    #[tokio::test]
    async fn goes_through_the_proxy_the_system_is_set_to() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(stream.read_u8().await.unwrap());
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nX: y\r\n\r\nhello").await.unwrap();
            String::from_utf8(request).unwrap()
        });
        let proxy = SystemProxy { host: "127.0.0.1".into(), port, authorization: Some("Basic eA==".into()) };
        let mut stream = through(&proxy, "zone.test", 443).await.unwrap();
        let mut body = String::new();
        stream.read_to_string(&mut body).await.unwrap();
        assert_eq!(body, "hello");
        let request = seen.await.unwrap();
        assert!(request.starts_with("CONNECT zone.test:443 HTTP/1.1\r\n") && request.contains("Proxy-Authorization: Basic eA=="));
    }
}
