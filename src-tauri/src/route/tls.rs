//! Whether an address is a device of a Zone: a real TLS handshake with the Zone's host name, checked
//! as any request would be. Nothing is let through that a browser would refuse.

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{CertificateError, ClientConfig, DigitallySignedStruct, Error, SignatureScheme};
use serde::Serialize;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::net::TcpStream;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Usable,
    /// Everything is right but the date.
    Expired,
    /// Another host's certificate, one nobody trusts, or no TLS at all.
    Untrusted,
    /// Nothing listens there.
    Refused,
    Timeout,
    /// No way to the address, or no address.
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub outcome: Outcome,
    /// Unix seconds.
    pub expires_at: Option<u64>,
    pub detail: String,
}

impl Probe {
    pub fn of(outcome: Outcome, detail: impl Into<String>) -> Self {
        Self { outcome, expires_at: None, detail: detail.into() }
    }

    pub fn from_io(error: &std::io::Error) -> Self {
        use std::io::ErrorKind;
        let outcome = match error.kind() {
            ErrorKind::ConnectionRefused => Outcome::Refused,
            ErrorKind::TimedOut => Outcome::Timeout,
            _ => Outcome::Unreachable,
        };
        Self::of(outcome, error.to_string())
    }
}

#[derive(Debug, Default)]
struct Seen {
    expires_at: Option<u64>,
    expired: bool,
}

/// Checks like `inner` and remembers what the certificate says.
#[derive(Debug)]
struct Noting {
    inner: Arc<dyn ServerCertVerifier>,
    seen: Mutex<Seen>,
}

impl ServerCertVerifier for Noting {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, Error> {
        let expires_at = validity_end(end_entity);
        let result = self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp, now);
        let expired = matches!(
            result,
            Err(Error::InvalidCertificate(CertificateError::Expired | CertificateError::ExpiredContext { .. }))
        ) && expires_at.is_some_and(|end| {
            let then = UnixTime::since_unix_epoch(Duration::from_secs(end.saturating_sub(60)));
            self.inner.verify_server_cert(end_entity, intermediates, server_name, ocsp, then).is_ok()
        });
        *self.seen.lock().expect("certificate poisoned") = Seen { expires_at, expired };
        result
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

fn provider() -> Arc<CryptoProvider> {
    static PROVIDER: OnceLock<Arc<CryptoProvider>> = OnceLock::new();
    // Named: more than one provider may be compiled in.
    PROVIDER.get_or_init(|| Arc::new(rustls::crypto::ring::default_provider())).clone()
}

/// What the client's own requests trust (`http_client.rs`).
#[cfg(not(target_os = "ios"))]
fn system_verifier() -> Result<Arc<dyn ServerCertVerifier>, String> {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let found = rustls_native_certs::load_native_certs();
    for error in &found.errors {
        log::warn!("[route] a trusted certificate could not be read: {error}");
    }
    roots.add_parsable_certificates(found.certs);
    verifier_of(roots)
}

#[cfg(target_os = "ios")]
fn system_verifier() -> Result<Arc<dyn ServerCertVerifier>, String> {
    rustls_platform_verifier::Verifier::new(provider())
        .map(|verifier| Arc::new(verifier) as Arc<dyn ServerCertVerifier>)
        .map_err(|error| error.to_string())
}

#[cfg(any(not(target_os = "ios"), test))]
fn verifier_of(roots: rustls::RootCertStore) -> Result<Arc<dyn ServerCertVerifier>, String> {
    rustls::client::WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider())
        .build()
        .map(|verifier| verifier as Arc<dyn ServerCertVerifier>)
        .map_err(|error| error.to_string())
}

/// Reading what the system trusts takes a while, so it is done once, where blocking is allowed.
pub async fn trusted() -> Result<Arc<dyn ServerCertVerifier>, String> {
    static VERIFIER: tokio::sync::OnceCell<Result<Arc<dyn ServerCertVerifier>, String>> = tokio::sync::OnceCell::const_new();
    VERIFIER
        .get_or_init(|| async {
            tokio::task::spawn_blocking(system_verifier)
                .await
                .unwrap_or_else(|error| Err(error.to_string()))
        })
        .await
        .clone()
}

/// The handshake on a connection that is there already.
pub async fn handshake(stream: TcpStream, host: &str, verifier: Arc<dyn ServerCertVerifier>) -> Probe {
    let Ok(name) = ServerName::try_from(host.to_string()) else {
        return Probe::of(Outcome::Unreachable, "not a host name");
    };
    let noting = Arc::new(Noting { inner: verifier, seen: Mutex::default() });
    let config = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .expect("the default protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(noting.clone())
        .with_no_client_auth();
    let result = tokio_rustls::TlsConnector::from(Arc::new(config)).connect(name, stream).await;
    let seen = noting.seen.lock().expect("certificate poisoned");
    let (outcome, detail) = match result {
        Ok(_) => (Outcome::Usable, String::new()),
        Err(error) if seen.expired => (Outcome::Expired, error.to_string()),
        Err(error) => (Outcome::Untrusted, error.to_string()),
    };
    Probe { outcome, expires_at: seen.expires_at, detail }
}

// ---- the end of a certificate's validity ----

/// One DER element: its tag, its content, and what follows it.
fn element(der: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = der.split_first()?;
    let (&first, rest) = rest.split_first()?;
    let (length, rest) = if first < 0x80 {
        (first as usize, rest)
    } else {
        let count = (first & 0x7f) as usize;
        if count == 0 || count > 4 || rest.len() < count {
            return None;
        }
        let (digits, rest) = rest.split_at(count);
        (digits.iter().fold(0usize, |length, digit| length << 8 | *digit as usize), rest)
    };
    (rest.len() >= length).then(|| (tag, &rest[..length], &rest[length..]))
}

/// `notAfter`, in Unix seconds.
fn validity_end(certificate: &[u8]) -> Option<u64> {
    let (_, certificate, _) = element(certificate)?;
    let (_, mut rest, _) = element(certificate)?;
    // An explicit version comes before the serial number, the signature algorithm and the issuer.
    if rest.first() == Some(&0xa0) {
        rest = element(rest)?.2;
    }
    for _ in 0..3 {
        rest = element(rest)?.2;
    }
    let (_, validity, _) = element(rest)?;
    let (_, _, rest) = element(validity)?;
    let (tag, text, _) = element(rest)?;
    unix_time(tag, std::str::from_utf8(text).ok()?)
}

fn unix_time(tag: u8, text: &str) -> Option<u64> {
    let digits = text.strip_suffix('Z')?;
    if !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let (year, rest) = match tag {
        0x17 if digits.len() == 12 => {
            let year: i64 = digits[..2].parse().ok()?;
            (if year < 50 { 2000 + year } else { 1900 + year }, &digits[2..])
        }
        0x18 if digits.len() == 14 => (digits[..4].parse().ok()?, &digits[4..]),
        _ => return None,
    };
    let part = |at: usize| rest[at..at + 2].parse::<i64>().ok();
    let (month, day, hour, minute, second) = (part(0)?, part(2)?, part(4)?, part(6)?, part(8)?);
    // Days since 1970 of a date in the Gregorian calendar, years beginning in March.
    let years = if month <= 2 { year - 1 } else { year };
    let era = years.div_euclid(400);
    let of_era = years.rem_euclid(400);
    let of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let days = era * 146_097 + of_era * 365 + of_era / 4 - of_era / 100 + of_year - 719_468;
    u64::try_from(days * 86_400 + hour * 3_600 + minute * 60 + second).ok()
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use rustls::pki_types::pem::PemObject;
    use rustls::pki_types::PrivateKeyDer;
    use std::net::SocketAddr;

    pub const HOST: &str = "zone.test";

    fn certificate(pem: &str) -> CertificateDer<'static> {
        CertificateDer::from_pem_slice(pem.as_bytes()).unwrap()
    }

    pub fn test_verifier() -> Arc<dyn ServerCertVerifier> {
        let mut roots = rustls::RootCertStore::empty();
        roots.add(certificate(include_str!("testdata/ca.pem"))).unwrap();
        verifier_of(roots).unwrap()
    }

    /// Serves TLS with one of the test certificates until it is dropped.
    pub async fn serve(pem: &'static str, key: &'static str) -> SocketAddr {
        let config = rustls::ServerConfig::builder_with_provider(provider())
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![certificate(pem)], PrivateKeyDer::from_pem_slice(key.as_bytes()).unwrap())
            .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let acceptor = acceptor.clone();
                tokio::spawn(async move { acceptor.accept(stream).await.is_ok() });
            }
        });
        address
    }

    async fn probe(pem: &'static str, key: &'static str, host: &str) -> Probe {
        let address = serve(pem, key).await;
        handshake(TcpStream::connect(address).await.unwrap(), host, test_verifier()).await
    }

    #[tokio::test]
    async fn tells_a_good_certificate_an_expired_one_and_others_apart() {
        let good = probe(include_str!("testdata/good.pem"), include_str!("testdata/good.key"), HOST).await;
        assert_eq!(good.outcome, Outcome::Usable, "{good:?}");
        assert!(good.expires_at.is_some());
        let expired = probe(include_str!("testdata/expired.pem"), include_str!("testdata/expired.key"), HOST).await;
        assert_eq!(expired.outcome, Outcome::Expired, "{expired:?}");
        // an expired certificate of another host is nothing to renew
        let other = probe(include_str!("testdata/expired.pem"), include_str!("testdata/expired.key"), "other.test").await;
        assert_eq!(other.outcome, Outcome::Untrusted, "{other:?}");
        let wrong = probe(include_str!("testdata/good.pem"), include_str!("testdata/good.key"), "other.test").await;
        assert_eq!(wrong.outcome, Outcome::Untrusted, "{wrong:?}");
        let foreign = probe(include_str!("testdata/foreign.pem"), include_str!("testdata/foreign.key"), HOST).await;
        assert_eq!(foreign.outcome, Outcome::Untrusted, "{foreign:?}");
    }

    #[tokio::test]
    async fn something_else_on_the_port_is_not_the_zone() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let (mut stream, _) = listener.accept().await.unwrap();
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
        });
        let probe = handshake(TcpStream::connect(address).await.unwrap(), HOST, test_verifier()).await;
        assert_eq!(probe.outcome, Outcome::Untrusted);
    }

    #[test]
    fn reads_the_end_of_the_validity() {
        assert_eq!(unix_time(0x17, "700101000000Z"), Some(0));
        assert_eq!(unix_time(0x17, "261124153005Z"), Some(1_795_534_205));
        assert_eq!(unix_time(0x18, "20000229000000Z"), Some(951_782_400));
        assert_eq!(unix_time(0x17, "2611241530Z"), None);
        assert_eq!(validity_end(b"\x30\x80"), None);
        assert!(validity_end(&certificate(include_str!("testdata/expired.pem"))).is_some());
    }
}
