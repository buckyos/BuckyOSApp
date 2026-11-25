use super::proxy::{answers, listen, Entry, Listening};
use super::*;
use futures::future::BoxFuture;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const HOST: &str = "zone.test";
const LOCAL: &str = "127.0.0.1";

fn ip(text: &str) -> IpAddr {
    text.parse().unwrap()
}

/// A network made of addresses that answer, or do not, and an echo server behind all of them.
#[derive(Default)]
struct Fake {
    outcomes: Mutex<HashMap<IpAddr, Outcome>>,
    probed: Mutex<Vec<IpAddr>>,
    dialed: Mutex<Vec<String>>,
    own: Mutex<Vec<IpAddr>>,
    found: Mutex<Option<IpAddr>>,
    scanned: Mutex<Vec<IpAddr>>,
    internet: AtomicBool,
    slow: Mutex<Option<Duration>>,
    echo: AtomicU16,
    mute: AtomicBool,
}

impl Fake {
    async fn new() -> Arc<Self> {
        let fake = Arc::new(Self::default());
        fake.internet.store(true, Ordering::SeqCst);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        fake.echo.store(listener.local_addr().unwrap().port(), Ordering::SeqCst);
        let server = fake.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let server = server.clone();
                tokio::spawn(async move {
                    let mut buffer = [0u8; 1024];
                    while let Ok(count) = stream.read(&mut buffer).await {
                        if count == 0 {
                            return;
                        }
                        if !server.mute.load(Ordering::SeqCst) && stream.write_all(&buffer[..count]).await.is_err() {
                            return;
                        }
                    }
                });
            }
        });
        fake
    }

    fn set(&self, address: &str, outcome: Outcome) {
        self.outcomes.lock().unwrap().insert(ip(address), outcome);
    }

    fn outcome(&self, address: &IpAddr) -> Outcome {
        self.outcomes.lock().unwrap().get(address).copied().unwrap_or(Outcome::Timeout)
    }

    fn probed(&self) -> Vec<String> {
        std::mem::take(&mut *self.probed.lock().unwrap()).iter().map(ToString::to_string).collect()
    }

    fn dialed(&self) -> Vec<String> {
        std::mem::take(&mut *self.dialed.lock().unwrap())
    }

    async fn echo(&self) -> io::Result<TcpStream> {
        TcpStream::connect((Ipv4Addr::LOCALHOST, self.echo.load(Ordering::SeqCst))).await
    }
}

impl Net for Fake {
    fn probe<'a>(&'a self, address: IpAddr, _host: &'a str, _timeout: Duration) -> BoxFuture<'a, Probe> {
        Box::pin(async move {
            self.probed.lock().unwrap().push(address);
            let slow = *self.slow.lock().unwrap();
            if let Some(slow) = slow {
                tokio::time::sleep(slow).await;
            }
            Probe { expires_at: Some(5_000_000_000), ..Probe::of(self.outcome(&address), "") }
        })
    }

    fn check<'a>(&'a self, _stream: TcpStream, _host: &'a str) -> BoxFuture<'a, Probe> {
        Box::pin(async { Probe::of(Outcome::Usable, "") })
    }

    fn dial(&self, address: IpAddr, _timeout: Duration) -> BoxFuture<'_, io::Result<TcpStream>> {
        Box::pin(async move {
            self.dialed.lock().unwrap().push(address.to_string());
            match self.outcome(&address) {
                Outcome::Refused => Err(io::ErrorKind::ConnectionRefused.into()),
                Outcome::Timeout | Outcome::Unreachable => Err(io::ErrorKind::TimedOut.into()),
                _ => self.echo().await,
            }
        })
    }

    fn dial_system<'a>(&'a self, host: &'a str, port: u16) -> BoxFuture<'a, io::Result<TcpStream>> {
        Box::pin(async move {
            self.dialed.lock().unwrap().push(format!("{host}:{port}"));
            if !self.internet.load(Ordering::SeqCst) {
                return Err(io::ErrorKind::NotFound.into());
            }
            self.echo().await
        })
    }

    fn scan<'a>(&'a self, addresses: Vec<IpAddr>, _host: &'a str) -> BoxFuture<'a, Option<IpAddr>> {
        Box::pin(async move {
            let found = self.found.lock().unwrap().filter(|found| addresses.contains(found));
            *self.scanned.lock().unwrap() = addresses;
            if let Some(found) = found {
                self.outcomes.lock().unwrap().insert(found, Outcome::Usable);
            }
            found
        })
    }

    fn interfaces(&self) -> Vec<IpAddr> {
        self.own.lock().unwrap().clone()
    }
}

fn quick() -> Times {
    Times {
        local_grace: Duration::from_millis(400),
        local_retry: Duration::from_millis(20),
        better: Duration::from_millis(80),
        leave: Duration::from_millis(200),
        stall: Duration::from_millis(80),
        settle: Duration::from_millis(50),
        ..Times::default()
    }
}

fn memory(devices: &[(&str, bool, &[&str])]) -> RouteMemory {
    RouteMemory {
        devices: devices
            .iter()
            .map(|(name, is_ood, ips)| KnownDevice { name: name.to_string(), is_ood: *is_ood, ips: ips.iter().map(|text| ip(text)).collect() })
            .collect(),
        ..RouteMemory::default()
    }
}

struct Setup {
    fake: Arc<Fake>,
    router: Arc<Router>,
    events: Arc<Mutex<Vec<RouteEvent>>>,
    listening: Listening,
}

async fn setup(local: bool, memory: RouteMemory, prepare: impl FnOnce(&Fake)) -> Setup {
    let fake = Fake::new().await;
    prepare(&fake);
    let router = Router::new(fake.clone(), Options { local, by_itself: true, times: quick() });
    let events: Arc<Mutex<Vec<RouteEvent>>> = Arc::default();
    let sink = events.clone();
    router.on_event(move |event| sink.lock().unwrap().push(event));
    let listening = listen(router.clone(), 0, Entry::Client { pac_path: "/secret/proxy.pac".into(), pass_others: false }).unwrap();
    router.port.store(listening.port, Ordering::SeqCst);
    router.set_zones(vec![RouteZone { host: HOST.into(), memory }]);
    Setup { fake, router, events, listening }
}

impl Setup {
    async fn line(&self) -> Line {
        let zone = self.router.zone(HOST).unwrap();
        self.router.line(&zone).await
    }

    fn memory(&self) -> RouteMemory {
        self.router.zone(HOST).unwrap().lock().memory.clone()
    }

    async fn until(&self, line: Line) {
        for _ in 0..200 {
            if self.router.status(HOST).unwrap().line == Some(line) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("still {:?}", self.router.status(HOST));
    }

    async fn connect(&self, target: &str) -> (TcpStream, String) {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, self.listening.port)).await.unwrap();
        stream.write_all(format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n").as_bytes()).await.unwrap();
        let answer = head(&mut stream).await;
        (stream, answer.lines().next().unwrap_or_default().to_string())
    }

    async fn get(&self, request: &str) -> String {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, self.listening.port)).await.unwrap();
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut answer = String::new();
        stream.read_to_string(&mut answer).await.unwrap();
        answer
    }
}

async fn head(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    while !bytes.ends_with(b"\r\n\r\n") {
        match stream.read_u8().await {
            Ok(byte) => bytes.push(byte),
            Err(_) => break,
        }
    }
    String::from_utf8(bytes).unwrap()
}

async fn echoes(stream: &mut TcpStream) -> bool {
    let mut answer = [0u8; 4];
    stream.write_all(b"ping").await.is_ok() && stream.read_exact(&mut answer).await.is_ok() && &answer == b"ping"
}

// ---- choosing ----

#[tokio::test]
async fn this_computer_comes_first_and_nothing_else_is_asked() {
    let known = memory(&[("ood1", true, &["192.168.1.8"])]);
    let test = setup(true, known, |fake| {
        fake.set(LOCAL, Outcome::Usable);
        fake.set("192.168.1.8", Outcome::Usable);
    })
    .await;
    assert_eq!(test.line().await, Line::Local);
    assert_eq!(test.fake.probed(), [LOCAL]);
    assert!(test.memory().local);
    assert!(test.events.lock().unwrap().iter().any(|event| matches!(event, RouteEvent::Memory { memory, .. } if memory.local)));
    assert_eq!(test.router.status(HOST).unwrap().cert_expires_at, Some(5_000_000_000));
}

#[tokio::test]
async fn a_phone_never_asks_itself() {
    let test = setup(false, memory(&[("ood1", true, &["192.168.1.8"])]), |fake| {
        fake.set(LOCAL, Outcome::Usable);
        fake.set("192.168.1.8", Outcome::Usable);
    })
    .await;
    assert_eq!(test.line().await, Line::Lan(ip("192.168.1.8")));
    assert_eq!(test.fake.probed(), ["192.168.1.8"]);
}

#[tokio::test]
async fn the_address_that_worked_last_wins_then_an_ood() {
    let mut known = memory(&[("laptop", false, &["192.168.1.30"]), ("ood1", true, &["172.17.0.1", "192.168.1.8", "8.8.8.8"])]);
    let usable = |fake: &Fake| {
        fake.set("192.168.1.30", Outcome::Usable);
        fake.set("192.168.1.8", Outcome::Usable);
    };
    let test = setup(false, known.clone(), usable).await;
    assert_eq!(test.line().await, Line::Lan(ip("192.168.1.8")));
    // a public address is no address of this network
    assert_eq!(test.fake.probed(), ["172.17.0.1", "192.168.1.8", "192.168.1.30"]);
    assert_eq!(test.memory().last_lan, Some(ip("192.168.1.8")));
    known.last_lan = Some(ip("192.168.1.30"));
    let test = setup(false, known, usable).await;
    assert_eq!(test.line().await, Line::Lan(ip("192.168.1.30")));
}

#[tokio::test]
async fn only_a_device_of_the_zone_is_taken() {
    let known = memory(&[("ood1", true, &["192.168.1.8", "192.168.1.9"])]);
    let test = setup(true, known, |fake| {
        fake.set(LOCAL, Outcome::Untrusted);
        fake.set("192.168.1.8", Outcome::Untrusted);
        fake.set("192.168.1.9", Outcome::Expired);
    })
    .await;
    assert_eq!(test.line().await, Line::Internet);
    let status = test.router.status(HOST).unwrap();
    let outcomes: Vec<_> = status.attempts.iter().map(|attempt| (attempt.line, attempt.outcome)).collect();
    assert_eq!(
        outcomes,
        [
            (Line::Local, Outcome::Untrusted),
            (Line::Lan(ip("192.168.1.8")), Outcome::Untrusted),
            (Line::Lan(ip("192.168.1.9")), Outcome::Expired),
        ]
    );
    // the date is worth telling even so
    assert_eq!(status.cert_expires_at, Some(5_000_000_000));
}

#[tokio::test]
async fn internet_only_means_that() {
    let known = RouteMemory { mode: LineMode::Internet, ..memory(&[("ood1", true, &["192.168.1.8"])]) };
    let test = setup(true, known, |fake| {
        fake.set(LOCAL, Outcome::Usable);
        fake.set("192.168.1.8", Outcome::Usable);
    })
    .await;
    assert_eq!(test.line().await, Line::Internet);
    assert!(test.fake.probed().is_empty());
    // and back
    test.router.set_zones(vec![RouteZone { host: HOST.into(), memory: RouteMemory::default() }]);
    test.until(Line::Local).await;
}

#[tokio::test]
async fn many_who_ask_at_once_cause_one_search() {
    let test = setup(true, RouteMemory::default(), |fake| {
        fake.set(LOCAL, Outcome::Usable);
        *fake.slow.lock().unwrap() = Some(Duration::from_millis(50));
    })
    .await;
    let lines = futures::future::join_all((0..20).map(|_| test.line())).await;
    assert!(lines.iter().all(|line| *line == Line::Local));
    assert!(test.fake.probed().len() <= 2);
}

#[tokio::test]
async fn a_changed_address_is_looked_for_in_a_known_network_only() {
    let known = memory(&[("ood1", true, &["192.168.1.8"])]);
    let test = setup(false, known.clone(), |fake| {
        *fake.own.lock().unwrap() = vec![ip("192.168.1.20")];
        *fake.found.lock().unwrap() = Some(ip("192.168.1.77"));
    })
    .await;
    test.until(Line::Lan(ip("192.168.1.77"))).await;
    assert_eq!(test.memory().last_lan, Some(ip("192.168.1.77")));

    let test = setup(false, known, |fake| {
        *fake.own.lock().unwrap() = vec![ip("192.168.50.20")];
        *fake.found.lock().unwrap() = Some(ip("192.168.50.77"));
    })
    .await;
    assert_eq!(test.line().await, Line::Internet);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(test.fake.scanned.lock().unwrap().is_empty());
    // unless the user asks
    assert!(test.router.find(HOST).await);
    assert_eq!(test.line().await, Line::Lan(ip("192.168.50.77")));
}

// ---- changing ----

#[tokio::test]
async fn a_restart_on_this_computer_is_waited_out() {
    let test = setup(true, RouteMemory::default(), |fake| fake.set(LOCAL, Outcome::Usable)).await;
    assert_eq!(test.line().await, Line::Local);
    test.fake.set(LOCAL, Outcome::Refused);
    test.fake.dialed();
    let fake = test.fake.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        fake.set(LOCAL, Outcome::Usable);
    });
    let waiting = async {
        loop {
            if test.router.status(HOST).unwrap().waiting {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    };
    let ((mut stream, answer), ()) = tokio::join!(test.connect("zone.test:443"), waiting);
    assert_eq!(answer, "HTTP/1.1 200 Connection established");
    assert!(echoes(&mut stream).await);
    assert!(test.fake.dialed().iter().all(|target| target == LOCAL));
    test.router.check(HOST).await;
    assert!(!test.router.status(HOST).unwrap().waiting);
}

#[tokio::test]
async fn this_computer_is_given_up_after_a_while_and_taken_again() {
    let test = setup(true, RouteMemory { local: true, ..RouteMemory::default() }, |fake| fake.set(LOCAL, Outcome::Refused)).await;
    let router = test.router.clone();
    tokio::spawn(async move { router.keep_looking().await });
    assert_eq!(test.line().await, Line::Local);
    let (mut stream, _) = test.connect("app.zone.test:443").await;
    assert!(echoes(&mut stream).await);
    assert_eq!(test.line().await, Line::Internet);
    assert!(!test.memory().local);
    test.fake.set(LOCAL, Outcome::Usable);
    test.until(Line::Local).await;
}

#[tokio::test]
async fn a_lost_device_loses_its_connections_at_once() {
    let test = setup(false, memory(&[("ood1", true, &["192.168.1.8"])]), |fake| fake.set("192.168.1.8", Outcome::Usable)).await;
    let (mut stream, _) = test.connect("zone.test:443").await;
    assert!(echoes(&mut stream).await);
    test.fake.set("192.168.1.8", Outcome::Timeout);
    test.router.network_changed().await;
    assert_eq!(test.line().await, Line::Internet);
    let mut rest = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), stream.read_to_end(&mut rest)).await.unwrap().unwrap();
    let (mut stream, _) = test.connect("zone.test:443").await;
    assert!(echoes(&mut stream).await);
    assert_eq!(test.fake.dialed(), ["192.168.1.8", "zone.test:443"]);
}

#[tokio::test]
async fn a_device_that_stops_answering_is_noticed() {
    let test = setup(false, memory(&[("ood1", true, &["192.168.1.8"])]), |fake| fake.set("192.168.1.8", Outcome::Usable)).await;
    let (mut stream, _) = test.connect("zone.test:443").await;
    assert!(echoes(&mut stream).await);
    test.fake.mute.store(true, Ordering::SeqCst);
    test.fake.set("192.168.1.8", Outcome::Timeout);
    stream.write_all(b"anyone?").await.unwrap();
    let mut rest = Vec::new();
    tokio::time::timeout(Duration::from_secs(2), stream.read_to_end(&mut rest)).await.unwrap().unwrap();
    test.until(Line::Internet).await;
}

#[tokio::test]
async fn a_new_connection_moves_on_when_the_device_is_gone() {
    let test = setup(false, memory(&[("ood1", true, &["192.168.1.8"])]), |fake| fake.set("192.168.1.8", Outcome::Usable)).await;
    assert_eq!(test.line().await, Line::Lan(ip("192.168.1.8")));
    test.fake.set("192.168.1.8", Outcome::Unreachable);
    let (mut stream, answer) = test.connect("zone.test:443").await;
    assert!(answer.contains("200") && echoes(&mut stream).await);
    assert_eq!(test.line().await, Line::Internet);
}

#[tokio::test]
async fn back_home_the_old_connection_closes_when_it_is_quiet() {
    let test = setup(false, memory(&[("ood1", true, &["192.168.1.8"])]), |_| {}).await;
    let router = test.router.clone();
    tokio::spawn(async move { router.keep_looking().await });
    let (mut stream, _) = test.connect("zone.test:443").await;
    assert_eq!(test.line().await, Line::Internet);
    test.fake.set("192.168.1.8", Outcome::Usable);
    test.until(Line::Lan(ip("192.168.1.8"))).await;
    // not while it has something to carry
    let busy = Instant::now();
    while busy.elapsed() < Duration::from_millis(500) {
        assert!(echoes(&mut stream).await);
    }
    // asking now and then does not keep it
    let mut kept = 0;
    while echoes(&mut stream).await {
        kept += 1;
        assert!(kept < 20);
        tokio::time::sleep(Duration::from_millis(60)).await;
    }
}

#[tokio::test]
async fn a_new_network_is_looked_at_twice() {
    let test = setup(false, memory(&[("ood1", true, &["192.168.1.8"])]), |_| {}).await;
    assert_eq!(test.line().await, Line::Internet);
    test.router.set_active(false);
    test.router.network_changed().await;
    assert_eq!(test.line().await, Line::Internet);
    test.fake.set("192.168.1.8", Outcome::Usable);
    test.until(Line::Lan(ip("192.168.1.8"))).await;
}

#[tokio::test]
async fn this_computer_is_taken_again_from_the_network() {
    let test = setup(true, memory(&[("ood1", true, &["192.168.1.8"])]), |fake| {
        fake.set(LOCAL, Outcome::Refused);
        fake.set("192.168.1.8", Outcome::Usable);
    })
    .await;
    let router = test.router.clone();
    tokio::spawn(async move { router.keep_looking().await });
    test.until(Line::Lan(ip("192.168.1.8"))).await;
    test.fake.set(LOCAL, Outcome::Usable);
    test.until(Line::Local).await;
}

#[tokio::test]
async fn connections_from_an_address_that_is_gone_close() {
    let test = setup(false, RouteMemory::default(), |fake| *fake.own.lock().unwrap() = vec![ip("192.168.1.20")]).await;
    let (mut stream, _) = test.connect("zone.test:443").await;
    assert!(echoes(&mut stream).await);
    // the loopback address of this test is not one that can go
    test.router.network_changed().await;
    assert!(echoes(&mut stream).await);
    test.router.tunnels.lock().unwrap().values_mut().for_each(|tunnel| {
        *tunnel = Arc::new(Tunnel { zone: HOST.into(), line: Line::Internet, from: Some(ip("10.0.0.9")), close: tokio::sync::Notify::new() })
    });
    let tunnel = test.router.tunnels.lock().unwrap().values().next().unwrap().clone();
    test.router.network_changed().await;
    tokio::time::timeout(Duration::from_secs(1), tunnel.close.notified()).await.unwrap();
}

#[tokio::test]
async fn nothing_works_without_any_way() {
    let test = setup(false, RouteMemory::default(), |fake| fake.internet.store(false, Ordering::SeqCst)).await;
    let (_, answer) = test.connect("zone.test:443").await;
    assert_eq!(answer, "HTTP/1.1 502 Bad Gateway");
    assert!(test.router.status(HOST).unwrap().unreachable);
    let attempts = test.router.diagnose(HOST).await;
    assert_eq!(attempts.last().unwrap().line, Line::Internet);
    assert_eq!(attempts.last().unwrap().outcome, Outcome::Unreachable);
    test.fake.internet.store(true, Ordering::SeqCst);
    assert_eq!(test.router.diagnose(HOST).await.last().unwrap().outcome, Outcome::Usable);
    assert!(!test.router.status(HOST).unwrap().unreachable);
}

#[tokio::test]
async fn zones_do_not_share_a_way() {
    let test = setup(true, RouteMemory::default(), |fake| fake.set(LOCAL, Outcome::Usable)).await;
    test.router.set_zones(vec![
        RouteZone { host: HOST.into(), memory: RouteMemory::default() },
        RouteZone { host: "other.zone.test".into(), memory: RouteMemory { mode: LineMode::Internet, ..RouteMemory::default() } },
    ]);
    test.until(Line::Local).await;
    let (mut stream, _) = test.connect("app.other.zone.test:443").await;
    assert!(echoes(&mut stream).await);
    assert_eq!(test.fake.dialed(), ["app.other.zone.test:443"]);
}

// ---- the proxy ----

#[tokio::test]
async fn only_hosts_of_the_zones_get_through() {
    let test = setup(true, RouteMemory::default(), |fake| fake.set(LOCAL, Outcome::Usable)).await;
    for target in ["evil.test:443", "evilzone.test:443", "127.0.0.1:443", "zone.test.evil.test:443"] {
        assert_eq!(test.connect(target).await.1, "HTTP/1.1 403 Forbidden", "{target}");
    }
    for target in ["nonsense", "[::1]:443", "zone.test:x", "user@zone.test:443"] {
        assert_eq!(test.connect(target).await.1, "HTTP/1.1 400 Bad Request", "{target}");
    }
    assert!(test.fake.dialed().is_empty());
    // another port of a Zone goes as it always did
    let (mut stream, _) = test.connect("ZONE.test:8443").await;
    assert!(echoes(&mut stream).await);
    assert_eq!(test.fake.dialed(), ["zone.test:8443"]);
}

#[tokio::test]
async fn what_may_become_a_zone_is_passed_on() {
    let test = setup(true, RouteMemory::default(), |fake| fake.set(LOCAL, Outcome::Usable)).await;
    test.router.set_family("Web3.sn.test");
    let (mut stream, _) = test.connect("app.new.web3.sn.test:443").await;
    assert!(echoes(&mut stream).await);
    assert_eq!(test.fake.dialed(), ["app.new.web3.sn.test:443"]);
    for target in ["sn.test:443", "web3.sn.test:443", "xweb3.sn.test:443"] {
        assert_eq!(test.connect(target).await.1, "HTTP/1.1 403 Forbidden", "{target}");
    }
    test.router.set_zones(vec![RouteZone { host: "new.web3.sn.test".into(), memory: RouteMemory::default() }]);
    let (mut stream, _) = test.connect("app.new.web3.sn.test:443").await;
    assert!(echoes(&mut stream).await);
    assert_eq!(test.fake.dialed(), [LOCAL]);
}

#[tokio::test]
async fn bytes_sent_along_with_the_request_are_kept() {
    let test = setup(true, RouteMemory::default(), |fake| fake.set(LOCAL, Outcome::Usable)).await;
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, test.listening.port)).await.unwrap();
    stream.write_all(b"CONNECT zone.test:443 HTTP/1.1\r\n\r\nearly").await.unwrap();
    assert!(head(&mut stream).await.contains("200"));
    let mut answer = [0u8; 5];
    stream.read_exact(&mut answer).await.unwrap();
    assert_eq!(&answer, b"early");
}

#[tokio::test]
async fn speaks_socks_too() {
    let test = setup(true, RouteMemory::default(), |fake| fake.set(LOCAL, Outcome::Usable)).await;
    let ask = |host: &'static str| {
        let port = test.listening.port;
        async move {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await.unwrap();
            stream.write_all(&[5, 1, 0]).await.unwrap();
            let mut greeting = [0u8; 2];
            stream.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting, [5, 0]);
            let mut request = vec![5, 1, 0, 3, host.len() as u8];
            request.extend_from_slice(host.as_bytes());
            request.extend_from_slice(&443u16.to_be_bytes());
            stream.write_all(&request).await.unwrap();
            let mut answer = [0u8; 10];
            stream.read_exact(&mut answer).await.unwrap();
            (stream, answer[1])
        }
    };
    let (mut stream, code) = ask("app.zone.test").await;
    assert_eq!(code, 0);
    assert!(echoes(&mut stream).await);
    assert_eq!(ask("evil.test").await.1, 2);
}

#[tokio::test]
async fn the_script_is_for_no_page() {
    let test = setup(true, RouteMemory::default(), |_| {}).await;
    let port = test.listening.port;
    let get = |path: &str, host: &str, more: &str| format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{more}\r\n");
    let here = format!("127.0.0.1:{port}");
    let good = test.get(&get("/secret/proxy.pac", &here, "")).await;
    assert!(good.starts_with("HTTP/1.1 200") && good.contains("zone.test") && good.contains("nosniff") && !good.contains("javascript"));
    for request in [
        get("/proxy.pac", &here, ""),
        get("/secret/proxy.pac", "evil.test", ""),
        get("/secret/proxy.pac", &here, "Sec-Fetch-Site: cross-site\r\n"),
        get("/secret/proxy.pac", &here, "Origin: https://evil.test\r\n"),
        get("/secret/proxy.pac", &here, "Referer: https://evil.test/\r\n"),
        get("http://zone.test/", "zone.test", ""),
    ] {
        let answer = test.get(&request).await;
        assert!(answer.starts_with("HTTP/1.1 403") && !answer.contains("zones"), "{request}");
    }
    let browser = listen(test.router.clone(), 0, Entry::Browser).unwrap();
    assert!(answers(browser.port).await);
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, browser.port)).await.unwrap();
    stream.write_all(get("/proxy.pac", &format!("localhost:{}", browser.port), "").as_bytes()).await.unwrap();
    assert!(head(&mut stream).await.starts_with("HTTP/1.1 200"));
    let gone = browser.port;
    drop(browser);
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(!answers(gone).await);
}

#[tokio::test]
async fn the_clients_own_requests_know_the_proxy() {
    let test = setup(true, RouteMemory::default(), |_| {}).await;
    assert_eq!(test.router.proxy_url("App.zone.test"), Some(format!("http://127.0.0.1:{}", test.listening.port)));
    assert_eq!(test.router.proxy_url("sn.example"), None);
}

#[tokio::test]
async fn a_zone_that_left_the_list_loses_its_connections() {
    let test = setup(true, RouteMemory::default(), |fake| fake.set(LOCAL, Outcome::Usable)).await;
    let (mut stream, _) = test.connect("zone.test:443").await;
    assert!(echoes(&mut stream).await);
    test.router.set_zones(Vec::new());
    let mut rest = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), stream.read_to_end(&mut rest)).await.unwrap().unwrap();
    assert_eq!(test.connect("zone.test:443").await.1, "HTTP/1.1 403 Forbidden");
}
