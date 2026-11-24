//! HTTP to a Zone: kRPC over `/kapi/<service>` and plain requests to the Zone root.
//!
//! The page side keeps using the WebSDK's kRPC client; its request body passes through here as it
//! is, with the session token put into `sys[1]`, so the token never reaches a page.

use futures::future::BoxFuture;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::error::CommandErrors;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, thiserror::Error)]
pub enum ZoneError {
    #[error("zone unreachable: {0}")]
    Network(String),
    #[error("HTTP {0}")]
    Http(u16, String),
    #[error("{message}")]
    Rpc {
        code: Option<String>,
        message: String,
        data: Option<Value>,
    },
    #[error("unexpected answer: {0}")]
    Protocol(String),
    /// The saved credential no longer works, or there is none: ask the user.
    #[error("password required")]
    NeedPassword,
    #[error("zone not found")]
    NotFound,
}

impl ZoneError {
    pub fn is_network(&self) -> bool {
        matches!(self, Self::Network(_)) || matches!(self, Self::Http(status, _) if *status >= 500)
    }

    /// The session token was refused as a credential (not: the user lacks a permission).
    pub fn is_bad_token(&self) -> bool {
        match self {
            Self::Http(401, _) => true,
            Self::Rpc { code, message, data } => {
                let reason = data
                    .as_ref()
                    .and_then(|data| data.get("reason"))
                    .and_then(Value::as_str);
                (code.as_deref() == Some("access_denied") && reason == Some("credential_state"))
                    || ["invalid token", "invalidtoken", "token expired", "expiredsignature"]
                        .iter()
                        .any(|text| message.to_ascii_lowercase().contains(text))
            }
            _ => false,
        }
    }

    /// The service does not know the method: an older Zone (TODO R1).
    pub fn is_unknown_method(&self) -> bool {
        match self {
            Self::Http(404, _) => true,
            Self::Rpc { message, .. } => {
                let message = message.to_ascii_lowercase();
                message.contains("unknown method") || message.contains("unknownmethod")
            }
            _ => false,
        }
    }
}

impl From<ZoneError> for CommandErrors {
    fn from(error: ZoneError) -> Self {
        match error {
            ZoneError::NotFound => CommandErrors::ZoneNotFound,
            ZoneError::NeedPassword => CommandErrors::ZoneNeedPassword,
            ZoneError::Network(message) => CommandErrors::ZoneUnreachable(message),
            other => CommandErrors::ZoneRequestFailed(other.to_string()),
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

/// Strictly increasing milliseconds. A sign-in nonce used twice for the same user and target is
/// taken for a replay and revokes the session.
pub fn next_nonce() -> u64 {
    static LAST: Mutex<u64> = Mutex::new(0);
    let mut last = LAST.lock().expect("nonce poisoned");
    *last = now_ms().max(*last + 1);
    *last
}

#[derive(Clone)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// What the session code needs from the network; tests answer it from memory.
pub trait ZoneTransport: Send + Sync {
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, ZoneError>>;
    /// The network changed: connections from before are dead, and a request on one would only find
    /// that out after half a minute.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    fn reset(&self) {}
}

pub struct ReqwestTransport {
    client: Mutex<reqwest::Client>,
}

impl ReqwestTransport {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self { client: Mutex::new(Self::client()?) })
    }

    fn client() -> Result<reqwest::Client, reqwest::Error> {
        reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
    }
}

pub fn network_error(error: reqwest::Error) -> ZoneError {
    let mut message = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        message = format!("{message}: {cause}");
        source = cause.source();
    }
    ZoneError::Network(message)
}

impl ZoneTransport for ReqwestTransport {
    fn reset(&self) {
        if let Ok(client) = Self::client() {
            *self.client.lock().expect("client poisoned") = client;
        }
    }

    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, ZoneError>> {
        Box::pin(async move {
            let method = reqwest::Method::from_bytes(request.method.as_bytes())
                .map_err(|error| ZoneError::Protocol(error.to_string()))?;
            let client = self.client.lock().expect("client poisoned").clone();
            let mut builder = client.request(method, &request.url);
            for (name, value) in &request.headers {
                builder = builder.header(name, value);
            }
            if let Some(body) = request.body {
                builder = builder.body(body);
            }
            let mut response = builder.send().await.map_err(network_error)?;
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    Some((name.as_str().to_string(), value.to_str().ok()?.to_string()))
                })
                .collect();
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(network_error)? {
                if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                    return Err(ZoneError::Protocol("answer too large".into()));
                }
                body.extend_from_slice(&chunk);
            }
            Ok(HttpResponse { status, headers, body })
        })
    }
}

/// Posts a kRPC body (with `sys` already complete) and returns the answer's text.
pub async fn post_krpc(
    transport: &dyn ZoneTransport,
    host: &str,
    service: &str,
    body: Vec<u8>,
) -> Result<Vec<u8>, ZoneError> {
    if service.is_empty() || !service.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '@')) {
        return Err(ZoneError::Protocol(format!("invalid service name {service:?}")));
    }
    let response = transport
        .send(HttpRequest {
            method: "POST".into(),
            url: format!("https://{host}/kapi/{service}"),
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: Some(body),
        })
        .await?;
    if response.status != 200 {
        let text = String::from_utf8_lossy(&response.body);
        return Err(ZoneError::Http(response.status, text.chars().take(300).collect()));
    }
    Ok(response.body)
}

pub fn parse_krpc(body: &[u8]) -> Result<Value, ZoneError> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|error| ZoneError::Protocol(format!("not JSON: {error}")))?;
    match value.get("error") {
        None | Some(Value::Null) => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
        Some(error) => Err(ZoneError::Rpc {
            code: value.get("code").and_then(Value::as_str).map(str::to_string),
            message: match error {
                Value::String(text) => text.clone(),
                other => other.to_string(),
            },
            data: value.get("data").cloned(),
        }),
    }
}

pub async fn krpc(
    transport: &dyn ZoneTransport,
    host: &str,
    service: &str,
    method: &str,
    params: Value,
    token: Option<&str>,
) -> Result<Value, ZoneError> {
    let sys = match token {
        Some(token) => json!([next_nonce(), token]),
        None => json!([next_nonce()]),
    };
    let body = serde_json::to_vec(&json!({ "method": method, "params": params, "sys": sys }))
        .map_err(|error| ZoneError::Protocol(error.to_string()))?;
    parse_krpc(&post_krpc(transport, host, service, body).await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonces_never_repeat() {
        let mut last = 0;
        for _ in 0..1000 {
            let next = next_nonce();
            assert!(next > last);
            last = next;
        }
    }

    #[test]
    fn reads_krpc_answers() {
        assert_eq!(parse_krpc(br#"{"result":{"a":1},"sys":[1]}"#).unwrap(), json!({"a":1}));
        let error = parse_krpc(
            br#"{"error":"access denied","code":"access_denied","data":{"reason":"credential_state"}}"#,
        )
        .unwrap_err();
        assert!(error.is_bad_token());
        let error = parse_krpc(br#"{"error":"Invalid password"}"#).unwrap_err();
        assert!(!error.is_bad_token());
        assert!(matches!(parse_krpc(b"<html>"), Err(ZoneError::Protocol(_))));
    }
}
