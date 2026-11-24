//! The client's own sign-in to each Zone.
//!
//! A credential is a user name and the password digest verify-hub itself stores
//! (`Base64(SHA256(password + username + ".buckyos"))`); it is enough to sign in again whenever the
//! refresh token ends. Everything is keyed by account (DID) and Zone: nothing here knows a
//! "current" Zone.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::api::{krpc, next_nonce, now_ms, parse_krpc, post_krpc, HttpRequest, HttpResponse, ZoneError, ZoneTransport};
use super::secret::SecretStore;

const REFRESH_MARGIN_MS: u64 = 60_000;
/// A sign-in that failed for lack of network is not repeated more often than this.
const CONTROL_PANEL: &str = "control-panel";
const VERIFY_HUB: &str = "verify-hub";

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ZoneKey {
    pub account: String,
    pub zone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credential {
    pub username: String,
    pub digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tokens {
    pub session_token: String,
    pub refresh_token: String,
}

/// Who the session is in that Zone (control-panel `auth.current_identity`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ZoneIdentity {
    pub user_id: String,
    pub did: String,
    #[serde(default)]
    pub show_name: Option<String>,
    #[serde(default)]
    pub user_type: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    SignedOut,
    SigningIn,
    SignedIn,
    NeedPassword,
    Offline,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionStatus {
    pub state: SessionState,
    pub username: Option<String>,
    pub identity: Option<ZoneIdentity>,
    /// Why the last sign-in did not work, for the password prompt: `password`, `no_password`,
    /// `clock`, `denied`.
    pub reason: Option<String>,
}

pub fn password_digest(username: &str, password: &str) -> String {
    STANDARD.encode(Sha256::digest(format!("{password}{username}.buckyos")))
}

fn login_proof(digest: &str, nonce: u64) -> String {
    STANDARD.encode(Sha256::digest(format!("{digest}{nonce}")))
}

fn token_expiry_ms(token: &str) -> Option<u64> {
    let payload = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
    serde_json::from_slice::<Value>(&payload)
        .ok()?
        .get("exp")?
        .as_u64()
        .map(|seconds| seconds.saturating_mul(1000))
}

fn is_fresh(token: &str) -> bool {
    token_expiry_ms(token).is_some_and(|expiry| expiry > now_ms() + REFRESH_MARGIN_MS)
}

/// verify-hub said no, as opposed to something in between (a proxy, a captive portal) answering.
fn is_refusal(error: &ZoneError) -> bool {
    matches!(error, ZoneError::Rpc { .. } | ZoneError::Http(401 | 403, _))
}

const CREDENTIAL_HEADERS: &[&str] = &["x-auth", "authorization", "cookie"];

/// The file service answers 403 for a bad token too, and says so.
fn refused_token(answer: &HttpResponse) -> bool {
    match answer.status {
        401 => true,
        403 => serde_json::from_slice::<Value>(&answer.body)
            .is_ok_and(|body| body.to_string().contains("\"unauthenticated\"")),
        _ => false,
    }
}

fn with_session(request: &HttpRequest, token: &str) -> HttpRequest {
    let mut request = request.clone();
    request.headers.push(("X-Auth".into(), token.to_string()));
    request.headers.push(("Authorization".into(), format!("Bearer {token}")));
    request
}

/// Why verify-hub refused the credential; `None` when the failure says nothing about it.
pub fn rejected_credential(error: &ZoneError) -> Option<&'static str> {
    let ZoneError::Rpc { code, message, data } = error else {
        return None;
    };
    let text = message.to_ascii_lowercase();
    let detail = data
        .as_ref()
        .and_then(|data| data.get("detail"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    if detail == "password_unset" || text.contains("password_unset") {
        return Some("no_password");
    }
    if text.contains("invalid password") || text.contains("invalidpassword") || text.contains("user info not found") {
        return Some("password");
    }
    if text.contains("invalid nonce") {
        return Some("clock");
    }
    if code.as_deref() == Some("access_denied") || text.contains("access denied") || text.contains("no permission") {
        return Some("denied");
    }
    None
}

struct Entry {
    /// One sign-in or refresh at a time per Zone: refresh tokens rotate.
    busy: tokio::sync::Mutex<()>,
    data: Mutex<EntryData>,
}

struct EntryData {
    state: SessionState,
    reason: Option<String>,
    tokens: Option<Tokens>,
    identity: Option<ZoneIdentity>,
    loaded: bool,
    /// The digest the Zone refused last; it is not tried again by itself.
    refused: Option<String>,
}

type Listener = Box<dyn Fn(&ZoneKey, &SessionStatus) + Send + Sync>;

pub struct Sessions {
    transport: Arc<dyn ZoneTransport>,
    secrets: SecretStore,
    entries: Mutex<HashMap<ZoneKey, Arc<Entry>>>,
    listener: Mutex<Option<Listener>>,
}

fn credential_key(key: &ZoneKey) -> String {
    format!("credential:{}:{}", key.account, key.zone)
}

fn tokens_key(key: &ZoneKey) -> String {
    format!("session:{}:{}", key.account, key.zone)
}

fn identity_key(key: &ZoneKey) -> String {
    format!("identity:{}:{}", key.account, key.zone)
}

fn wallet_key(account: &str) -> String {
    format!("wallet:{account}")
}

impl Sessions {
    pub fn new(transport: Arc<dyn ZoneTransport>, secrets: SecretStore) -> Self {
        Self {
            transport,
            secrets,
            entries: Mutex::default(),
            listener: Mutex::new(None),
        }
    }

    pub fn on_change(&self, listener: impl Fn(&ZoneKey, &SessionStatus) + Send + Sync + 'static) {
        *self.listener.lock().expect("session listener poisoned") = Some(Box::new(listener));
    }

    pub fn transport(&self) -> &dyn ZoneTransport {
        self.transport.as_ref()
    }

    fn entry(&self, key: &ZoneKey) -> Arc<Entry> {
        let entry = self
            .entries
            .lock()
            .expect("sessions poisoned")
            .entry(key.clone())
            .or_insert_with(|| {
                Arc::new(Entry {
                    busy: tokio::sync::Mutex::new(()),
                    data: Mutex::new(EntryData {
                        state: SessionState::SignedOut,
                        reason: None,
                        tokens: None,
                        identity: None,
                        loaded: false,
                        refused: None,
                    }),
                })
            })
            .clone();
        {
            let mut data = entry.data.lock().expect("session poisoned");
            if !data.loaded {
                data.loaded = true;
                data.tokens = self.secrets.get_json(&tokens_key(key));
                data.identity = self.secrets.get_json(&identity_key(key));
                if data.tokens.as_ref().is_some_and(|tokens| is_fresh(&tokens.session_token)) {
                    data.state = SessionState::SignedIn;
                } else if data.tokens.is_some() || self.credential(key).is_some() {
                    // Nothing was tried yet in this run; `resume` or the first call does.
                    data.state = SessionState::SigningIn;
                }
            }
        }
        entry
    }

    pub fn status(&self, key: &ZoneKey) -> SessionStatus {
        let entry = self.entry(key);
        let data = entry.data.lock().expect("session poisoned");
        SessionStatus {
            state: data.state,
            username: self.credential(key).map(|credential| credential.username),
            identity: data.identity.clone(),
            reason: data.reason.clone(),
        }
    }

    fn set_state(&self, key: &ZoneKey, entry: &Entry, state: SessionState, reason: Option<&str>) {
        {
            let mut data = entry.data.lock().expect("session poisoned");
            if data.state == state && data.reason.as_deref() == reason {
                return;
            }
            data.state = state;
            data.reason = reason.map(str::to_string);
        }
        self.tell(key);
    }

    pub fn credential(&self, key: &ZoneKey) -> Option<Credential> {
        self.secrets.get_json(&credential_key(key))
    }

    /// The account's own wallet password as a Zone credential: the administrator of a Zone
    /// activated from this client has exactly this digest.
    pub fn remember_wallet_credential(&self, account: &str, credential: &Credential) {
        self.secrets.set_json(&wallet_key(account), credential);
    }

    pub fn wallet_credential(&self, account: &str) -> Option<Credential> {
        self.secrets.get_json(&wallet_key(account))
    }

    pub fn forget_account(&self, account: &str) {
        self.secrets.delete(&wallet_key(account));
    }

    async fn sign_in(&self, host: &str, credential: &Credential) -> Result<(Tokens, Option<ZoneIdentity>), ZoneError> {
        let tokens = self.password_login(host, credential).await?;
        let identity = self.fetch_identity(host, &tokens.session_token).await;
        Ok((tokens, identity))
    }

    /// A session of its own, for a WebView's cookies: refresh tokens rotate, so nothing may share
    /// the client's.
    pub async fn separate_session(&self, key: &ZoneKey, host: &str) -> Result<Tokens, ZoneError> {
        self.token(key, host).await?;
        let credential = self.credential(key).ok_or(ZoneError::NeedPassword)?;
        self.password_login(host, &credential).await
    }

    async fn password_login(&self, host: &str, credential: &Credential) -> Result<Tokens, ZoneError> {
        let nonce = next_nonce();
        let result = krpc(
            self.transport(),
            host,
            VERIFY_HUB,
            "login_by_password",
            json!({
                "type": "password",
                "username": credential.username,
                "password": login_proof(&credential.digest, nonce),
                "target": { "kind": "system", "service_id": CONTROL_PANEL },
                "login_nonce": nonce,
            }),
            None,
        )
        .await?;
        serde_json::from_value(result)
            .map_err(|error| ZoneError::Protocol(format!("sign-in answer: {error}")))
    }

    async fn fetch_identity(&self, host: &str, token: &str) -> Option<ZoneIdentity> {
        match krpc(self.transport(), host, CONTROL_PANEL, "auth.current_identity", json!({}), Some(token)).await {
            Ok(value) => serde_json::from_value(value).ok(),
            Err(error) => {
                log::warn!("[zone] reading the identity in {host} failed: {error}");
                None
            }
        }
    }

    fn store(&self, key: &ZoneKey, entry: &Entry, tokens: Tokens, identity: Option<ZoneIdentity>) {
        self.secrets.set_json(&tokens_key(key), &tokens);
        entry.data.lock().expect("session poisoned").tokens = Some(tokens);
        if let Some(identity) = identity {
            self.know(key, entry, identity);
        }
    }

    /// Whether that is news.
    fn know(&self, key: &ZoneKey, entry: &Entry, identity: ZoneIdentity) -> bool {
        {
            let mut data = entry.data.lock().expect("session poisoned");
            if data.identity.as_ref() == Some(&identity) {
                return false;
            }
            data.identity = Some(identity.clone());
        }
        self.secrets.set_json(&identity_key(key), &identity);
        true
    }

    /// Who the last user was says nothing about another one.
    fn forget_identity(&self, key: &ZoneKey, entry: &Entry) {
        entry.data.lock().expect("session poisoned").identity = None;
        self.secrets.delete(&identity_key(key));
    }

    fn tell(&self, key: &ZoneKey) {
        let status = self.status(key);
        if let Some(listener) = self.listener.lock().expect("session listener poisoned").as_ref() {
            listener(key, &status);
        }
    }

    /// Signs in with a credential the user just gave and keeps it when it works.
    pub async fn login(&self, key: &ZoneKey, host: &str, credential: Credential) -> Result<SessionStatus, ZoneError> {
        self.login_with(key, host, credential, SessionState::NeedPassword).await
    }

    /// The same with a credential the client has already. A Zone that cannot answer properly yet (it
    /// is just starting) is tried again later; the user is not asked for anything.
    pub async fn login_unasked(&self, key: &ZoneKey, host: &str, credential: Credential) -> Result<SessionStatus, ZoneError> {
        let refused = {
            let entry = self.entry(key);
            let data = entry.data.lock().expect("session poisoned");
            data.refused.as_deref() == Some(credential.digest.as_str())
        };
        if refused {
            return Err(ZoneError::NeedPassword);
        }
        self.login_with(key, host, credential, SessionState::Offline).await
    }

    async fn login_with(&self, key: &ZoneKey, host: &str, credential: Credential, unclear: SessionState) -> Result<SessionStatus, ZoneError> {
        let entry = self.entry(key);
        let _busy = entry.busy.lock().await;
        let (before, reason_before) = {
            let data = entry.data.lock().expect("session poisoned");
            (data.state, data.reason.clone())
        };
        if before != SessionState::Offline || unclear == SessionState::NeedPassword {
            self.set_state(key, &entry, SessionState::SigningIn, None);
        }
        match self.sign_in(host, &credential).await {
            Ok((tokens, identity)) => {
                let same_user = self.credential(key).is_some_and(|known| known.username == credential.username);
                if !same_user {
                    self.forget_identity(key, &entry);
                }
                self.secrets.set_json(&credential_key(key), &credential);
                entry.data.lock().expect("session poisoned").refused = None;
                self.store(key, &entry, tokens, identity);
                self.set_state(key, &entry, SessionState::SignedIn, None);
                Ok(self.status(key))
            }
            Err(error) => {
                let rejected = rejected_credential(&error);
                if rejected.is_some() && rejected != Some("clock") {
                    entry.data.lock().expect("session poisoned").refused = Some(credential.digest.clone());
                }
                // A mistyped password does not end the session there is.
                if before == SessionState::SignedIn && Self::fresh_token(&entry).is_some() {
                    self.set_state(key, &entry, before, reason_before.as_deref());
                    return Err(error);
                }
                let (state, reason) = match rejected {
                    Some("clock") => (SessionState::Offline, Some("clock")),
                    Some(reason) => (SessionState::NeedPassword, Some(reason)),
                    None if error.is_network() => (SessionState::Offline, None),
                    None => (unclear, None),
                };
                self.set_state(key, &entry, state, reason);
                Err(error)
            }
        }
    }

    /// A usable session token: the one at hand, a refreshed one, or a new sign-in with the saved
    /// credential. `NeedPassword` when only the user can help.
    pub async fn token(&self, key: &ZoneKey, host: &str) -> Result<String, ZoneError> {
        let entry = self.entry(key);
        if let Some(token) = Self::fresh_token(&entry) {
            return Ok(token);
        }
        let _busy = entry.busy.lock().await;
        if let Some(token) = Self::fresh_token(&entry) {
            return Ok(token);
        }
        self.renew(key, host, &entry).await
    }

    fn fresh_token(entry: &Entry) -> Option<String> {
        let data = entry.data.lock().expect("session poisoned");
        data.tokens
            .as_ref()
            .filter(|tokens| is_fresh(&tokens.session_token))
            .map(|tokens| tokens.session_token.clone())
    }

    async fn renew(&self, key: &ZoneKey, host: &str, entry: &Entry) -> Result<String, ZoneError> {
        let refresh_token = entry
            .data
            .lock()
            .expect("session poisoned")
            .tokens
            .as_ref()
            .map(|tokens| tokens.refresh_token.clone());
        let had_session = refresh_token.is_some();
        if let Some(refresh_token) = refresh_token {
            match krpc(
                self.transport(),
                host,
                VERIFY_HUB,
                "refresh_token",
                json!({ "refresh_token": refresh_token }),
                None,
            )
            .await
            {
                Ok(result) => {
                    let tokens: Tokens = serde_json::from_value(result)
                        .map_err(|error| ZoneError::Protocol(format!("refresh answer: {error}")))?;
                    let token = tokens.session_token.clone();
                    let known = entry.data.lock().expect("session poisoned").identity.is_some();
                    let identity = if known { None } else { self.fetch_identity(host, &token).await };
                    self.store(key, entry, tokens, identity);
                    self.set_state(key, entry, SessionState::SignedIn, None);
                    return Ok(token);
                }
                Err(error) if !is_refusal(&error) => {
                    self.set_state(key, entry, SessionState::Offline, None);
                    return Err(error);
                }
                Err(error) => {
                    log::info!("[zone] refreshing the session in {host} was refused: {error}");
                    self.secrets.delete(&tokens_key(key));
                    entry.data.lock().expect("session poisoned").tokens = None;
                }
            }
        }
        let Some(credential) = self.credential(key) else {
            // Signed out stays that; a Zone that is only not there yet is tried again by itself.
            let state = entry.data.lock().expect("session poisoned").state;
            if had_session || !matches!(state, SessionState::SignedOut | SessionState::Offline) {
                self.set_state(key, entry, SessionState::NeedPassword, None);
            }
            return Err(ZoneError::NeedPassword);
        };
        // A credential already refused is not tried again until the user enters a new one.
        if entry.data.lock().expect("session poisoned").state == SessionState::NeedPassword {
            return Err(ZoneError::NeedPassword);
        }
        // Trying again in the background is nothing to tell.
        if entry.data.lock().expect("session poisoned").state != SessionState::Offline {
            self.set_state(key, entry, SessionState::SigningIn, None);
        }
        match self.sign_in(host, &credential).await {
            Ok((tokens, identity)) => {
                let token = tokens.session_token.clone();
                self.store(key, entry, tokens, identity);
                self.set_state(key, entry, SessionState::SignedIn, None);
                Ok(token)
            }
            Err(error) => match rejected_credential(&error) {
                Some("clock") => {
                    self.set_state(key, entry, SessionState::Offline, Some("clock"));
                    Err(error)
                }
                Some(reason) => {
                    self.set_state(key, entry, SessionState::NeedPassword, Some(reason));
                    Err(ZoneError::NeedPassword)
                }
                None => {
                    self.set_state(key, entry, SessionState::Offline, None);
                    Err(error)
                }
            },
        }
    }

    /// Brings a saved session back when the client starts.
    pub async fn resume(&self, key: &ZoneKey, host: &str) {
        if self.status(key).state == SessionState::SigningIn {
            if let Err(error) = self.token(key, host).await {
                log::info!("[zone] resuming the session in {host}: {error}");
            }
        }
    }

    /// Drops the session token so the next call gets a new one.
    fn invalidate(&self, key: &ZoneKey, token: &str) {
        let entry = self.entry(key);
        let mut data = entry.data.lock().expect("session poisoned");
        if let Some(tokens) = data.tokens.as_mut() {
            if tokens.session_token == token {
                tokens.session_token.clear();
            }
        }
    }

    /// Keeps the state in step with what a request showed about the connection.
    fn seen<T>(&self, key: &ZoneKey, result: Result<T, ZoneError>) -> Result<T, ZoneError> {
        let entry = self.entry(key);
        let state = entry.data.lock().expect("session poisoned").state;
        match &result {
            Err(ZoneError::Network(_)) if state == SessionState::SignedIn => self.set_state(key, &entry, SessionState::Offline, None),
            // One service that does not answer (5xx) says nothing about the Zone.
            Err(ZoneError::Network(_)) => {}
            Err(error) if error.is_bad_token() => {}
            Err(ZoneError::NeedPassword) => {}
            _ => {
                let usable = Self::fresh_token(&entry).is_some();
                if usable && matches!(state, SessionState::Offline | SessionState::NeedPassword) {
                    self.set_state(key, &entry, SessionState::SignedIn, None);
                }
            }
        }
        result
    }

    /// Asks the Zone whether the session works, even when there is a token that looks good.
    pub async fn check(&self, key: &ZoneKey, host: &str) -> Result<(), ZoneError> {
        let answer = self.call(key, host, CONTROL_PANEL, "auth.current_identity", json!({})).await?;
        match serde_json::from_value(answer) {
            Ok(identity) => {
                if self.know(key, &self.entry(key), identity) {
                    self.tell(key);
                }
            }
            Err(error) => log::warn!("[zone] the identity in {host}: {error}"),
        }
        Ok(())
    }

    pub async fn call(&self, key: &ZoneKey, host: &str, service: &str, method: &str, params: Value) -> Result<Value, ZoneError> {
        let result = self.call_once(key, host, service, method, params).await;
        self.seen(key, result)
    }

    async fn call_once(&self, key: &ZoneKey, host: &str, service: &str, method: &str, params: Value) -> Result<Value, ZoneError> {
        let token = self.token(key, host).await?;
        match krpc(self.transport(), host, service, method, params.clone(), Some(&token)).await {
            Err(error) if error.is_bad_token() => {
                self.invalidate(key, &token);
                let token = self.token(key, host).await?;
                krpc(self.transport(), host, service, method, params, Some(&token)).await
            }
            other => other,
        }
    }

    /// A request body of the WebSDK's kRPC client, sent as it is except for the token in `sys`.
    /// The answer's text goes back unread so that error codes and data survive.
    pub async fn forward(&self, key: &ZoneKey, host: &str, service: &str, body: &str) -> Result<String, ZoneError> {
        let request: Value = serde_json::from_str(body)
            .map_err(|error| ZoneError::Protocol(format!("request is not JSON: {error}")))?;
        let token = self.token(key, host).await?;
        let mut answer = match post_krpc(self.transport(), host, service, with_token(&request, &token)?).await {
            Ok(answer) => answer,
            Err(error) => return self.seen(key, Err(error)),
        };
        let refused = parse_krpc(&answer).is_err_and(|error| error.is_bad_token());
        if !refused {
            let _ = self.seen(key, Ok(()));
        }
        if refused {
            self.invalidate(key, &token);
            let token = self.token(key, host).await?;
            answer = post_krpc(self.transport(), host, service, with_token(&request, &token)?).await?;
        }
        String::from_utf8(answer).map_err(|error| ZoneError::Protocol(error.to_string()))
    }

    /// A request to the Zone root with this session, for APIs that are not kRPC. Control-panel reads
    /// `X-Auth`, the file service `Authorization`.
    /// Never to another host: an app's own server must not see the client's session.
    pub async fn fetch(&self, key: &ZoneKey, host: &str, mut request: HttpRequest) -> Result<HttpResponse, ZoneError> {
        let on_root = super::host::web_url(&request.url).is_some_and(|url| url.host_str() == Some(host) && url.port().is_none());
        if !on_root {
            return Err(ZoneError::Protocol("not an address of the Zone root".into()));
        }
        request.headers.retain(|(name, _)| !CREDENTIAL_HEADERS.iter().any(|header| name.eq_ignore_ascii_case(header)));
        let token = self.token(key, host).await?;
        let answer = match self.transport.send(with_session(&request, &token)).await {
            Ok(answer) => answer,
            Err(error) => return self.seen(key, Err(error)),
        };
        if !refused_token(&answer) {
            return self.seen(key, Ok(answer));
        }
        self.invalidate(key, &token);
        let token = self.token(key, host).await?;
        self.transport.send(with_session(&request, &token)).await
    }

    /// A one-time sign-in for a page of the Zone, made with the saved credential: the address to
    /// load first (`/sso_callback`), which sets the page's own cookies and goes on to `target`.
    pub async fn page_callback(&self, key: &ZoneKey, host: &str, target: &str) -> Result<String, ZoneError> {
        // A renewed session first: it tells a wrong password apart from everything else.
        self.token(key, host).await?;
        let credential = self.credential(key).ok_or(ZoneError::NeedPassword)?;
        let nonce = next_nonce();
        let result = krpc(
            self.transport(),
            host,
            CONTROL_PANEL,
            "auth.login",
            json!({
                "username": credential.username,
                "password": login_proof(&credential.digest, nonce),
                "login_nonce": nonce,
                "redirect_url": target,
            }),
            None,
        )
        .await
        .map_err(|error| match rejected_credential(&error) {
            Some("password") | Some("no_password") => ZoneError::NeedPassword,
            _ => error,
        })?;
        let sso_nonce = result
            .get("sso_nonce")
            .and_then(|value| value.as_u64().map(|nonce| nonce.to_string()).or_else(|| value.as_str().map(str::to_string)))
            .filter(|nonce| nonce != "0")
            .ok_or_else(|| ZoneError::Protocol("auth.login answered without sso_nonce".into()))?;
        callback_url(target, &sso_nonce)
    }

    /// The same for a page of an app (or of a system service with its own host), made from the
    /// client's session.
    pub async fn app_callback(&self, key: &ZoneKey, host: &str, launch: &LaunchTarget, target: &str) -> Result<Option<String>, ZoneError> {
        let mut params = json!({ "redirect_url": target });
        match launch {
            LaunchTarget::App(instance) => params["app_instance_id"] = json!(instance),
            LaunchTarget::Service(service) => params["service_id"] = json!(service),
        }
        let result = self.call(key, host, CONTROL_PANEL, "auth.prepare_app_launch", params).await?;
        match result.get("status").and_then(Value::as_str) {
            Some("ready") => Ok(result
                .get("callback_url")
                .and_then(Value::as_str)
                .filter(|callback| same_origin(callback, target))
                .map(str::to_string)),
            Some("access_denied") => Err(ZoneError::Rpc {
                code: Some("access_denied".into()),
                message: "access denied".into(),
                data: None,
            }),
            _ => Ok(None),
        }
    }

    pub async fn logout(&self, key: &ZoneKey, host: &str) {
        let entry = self.entry(key);
        let _busy = entry.busy.lock().await;
        let refresh_token = {
            let mut data = entry.data.lock().expect("session poisoned");
            data.identity = None;
            data.tokens.take().map(|tokens| tokens.refresh_token)
        };
        self.secrets.delete(&credential_key(key));
        self.secrets.delete(&tokens_key(key));
        self.secrets.delete(&identity_key(key));
        self.set_state(key, &entry, SessionState::SignedOut, None);
        if let Some(refresh_token) = refresh_token {
            if let Err(error) = krpc(self.transport(), host, VERIFY_HUB, "logout", json!({ "refresh_token": refresh_token }), None).await {
                log::info!("[zone] ending the session in {host} failed: {error}");
            }
        }
    }
}

#[derive(Debug, Clone)]
pub enum LaunchTarget {
    App(String),
    Service(String),
}

fn with_token(request: &Value, token: &str) -> Result<Vec<u8>, ZoneError> {
    let mut request = request.clone();
    let seq = request
        .get("sys")
        .and_then(|sys| sys.get(0))
        .and_then(Value::as_u64)
        .unwrap_or_else(next_nonce);
    let trace = request
        .get("sys")
        .and_then(|sys| sys.get(2))
        .and_then(Value::as_str)
        .map(str::to_string);
    request["sys"] = match trace {
        Some(trace) => json!([seq, token, trace]),
        None => json!([seq, token]),
    };
    serde_json::to_vec(&request).map_err(|error| ZoneError::Protocol(error.to_string()))
}

fn same_origin(left: &str, right: &str) -> bool {
    match (reqwest::Url::parse(left), reqwest::Url::parse(right)) {
        (Ok(left), Ok(right)) => left.origin() == right.origin(),
        _ => false,
    }
}

fn callback_url(target: &str, sso_nonce: &str) -> Result<String, ZoneError> {
    let mut url = reqwest::Url::parse(target).map_err(|error| ZoneError::Protocol(error.to_string()))?;
    url.set_path("/sso_callback");
    url.set_fragment(None);
    url.set_query(None);
    url.query_pairs_mut()
        .append_pair("nonce", sso_nonce)
        .append_pair("redirect_url", target);
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::future::BoxFuture;
    use std::collections::VecDeque;

    /// Answers kRPC methods from a script and records what was asked.
    #[derive(Default)]
    struct Script {
        answers: Mutex<HashMap<String, VecDeque<Result<Value, ZoneError>>>>,
        asked: Mutex<Vec<(String, Value)>>,
    }

    impl Script {
        fn answer(&self, method: &str, answer: Result<Value, ZoneError>) {
            self.answers.lock().unwrap().entry(method.into()).or_default().push_back(answer);
        }
        fn asked(&self, method: &str) -> Vec<Value> {
            self.asked.lock().unwrap().iter().filter(|(name, _)| name == method).map(|(_, body)| body.clone()).collect()
        }
    }

    impl ZoneTransport for Script {
        fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, ZoneError>> {
            let body: Value = serde_json::from_slice(request.body.as_deref().unwrap_or(b"{}")).unwrap();
            let method = body["method"].as_str().unwrap_or_default().to_string();
            self.asked.lock().unwrap().push((method.clone(), body));
            let answer = self.answers.lock().unwrap().get_mut(&method).and_then(VecDeque::pop_front);
            Box::pin(async move {
                let body = match answer {
                    Some(Ok(result)) => json!({ "result": result, "sys": [1] }),
                    Some(Err(ZoneError::Rpc { code, message, data })) => json!({ "error": message, "code": code, "data": data }),
                    Some(Err(error)) => return Err(error),
                    None => json!({ "error": format!("unknown method {method}") }),
                };
                Ok(HttpResponse { status: 200, headers: vec![], body: serde_json::to_vec(&body).unwrap() })
            })
        }
    }

    fn token(expires_in_s: i64, mark: &str) -> String {
        let exp = (now_ms() / 1000) as i64 + expires_in_s;
        format!("h.{}.{mark}", URL_SAFE_NO_PAD.encode(format!("{{\"exp\":{exp}}}")))
    }

    fn pair(expires_in_s: i64, mark: &str) -> Value {
        json!({ "session_token": token(expires_in_s, mark), "refresh_token": format!("r-{mark}") })
    }

    fn rpc_error(message: &str) -> ZoneError {
        ZoneError::Rpc { code: None, message: message.into(), data: None }
    }

    fn fixture() -> (Arc<Script>, Sessions, ZoneKey, SecretStore) {
        let script = Arc::new(Script::default());
        let secrets = SecretStore::memory();
        let sessions = Sessions::new(script.clone(), secrets.clone());
        let key = ZoneKey { account: "did:bns:alice".into(), zone: "did:bns:bob".into() };
        (script, sessions, key, secrets)
    }

    fn credential() -> Credential {
        Credential { username: "alice".into(), digest: password_digest("alice", "secret") }
    }

    fn identity() -> Value {
        json!({ "kind": "account", "user_id": "alice", "did": "did:bns:alice", "show_name": "Alice", "user_type": "user" })
    }

    #[tokio::test]
    async fn the_digest_matches_the_websdk() {
        // hashPassword("alice", "bucky2025") of buckyos-websdk
        assert_eq!(password_digest("alice", "bucky2025"), STANDARD.encode(Sha256::digest("bucky2025alice.buckyos")));
        assert_eq!(login_proof("d", 5), STANDARD.encode(Sha256::digest("d5")));
    }

    #[tokio::test]
    async fn signs_in_and_keeps_the_credential() {
        let (script, sessions, key, secrets) = fixture();
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        let status = sessions.login(&key, "bob.example", credential()).await.unwrap();
        assert_eq!(status.state, SessionState::SignedIn);
        assert_eq!(status.identity.unwrap().did, "did:bns:alice");
        let asked = &script.asked("login_by_password")[0]["params"];
        assert_eq!(asked["password"], json!(login_proof(&credential().digest, asked["login_nonce"].as_u64().unwrap())));
        assert_eq!(asked["target"], json!({ "kind": "system", "service_id": "control-panel" }));
        // the password itself is stored nowhere
        assert!(secrets.get("credential:did:bns:alice:did:bns:bob").is_some());
        assert!(!String::from_utf8(secrets.get("credential:did:bns:alice:did:bns:bob").unwrap()).unwrap().contains("secret\""));
    }

    #[tokio::test]
    async fn a_wrong_password_is_not_kept() {
        let (script, sessions, key, secrets) = fixture();
        script.answer("login_by_password", Err(rpc_error("Invalid password")));
        assert!(sessions.login(&key, "bob.example", credential()).await.is_err());
        let status = sessions.status(&key);
        assert_eq!(status.state, SessionState::NeedPassword);
        assert_eq!(status.reason.as_deref(), Some("password"));
        assert!(secrets.get("credential:did:bns:alice:did:bns:bob").is_none());
    }

    #[tokio::test]
    async fn refreshes_before_signing_in_again() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Ok(pair(10, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        script.answer("refresh_token", Ok(pair(900, "b")));
        assert_eq!(sessions.token(&key, "bob.example").await.unwrap(), token_mark(&sessions, &key, "b"));
        assert_eq!(script.asked("refresh_token")[0]["params"], json!({ "refresh_token": "r-a" }));
        assert_eq!(script.asked("login_by_password").len(), 1);
    }

    fn token_mark(sessions: &Sessions, key: &ZoneKey, mark: &str) -> String {
        let entry = sessions.entry(key);
        let data = entry.data.lock().unwrap();
        let token = data.tokens.as_ref().unwrap().session_token.clone();
        assert!(token.ends_with(mark));
        token
    }

    #[tokio::test]
    async fn a_refused_refresh_falls_back_to_the_digest_and_then_to_the_user() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Ok(pair(10, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        script.answer("refresh_token", Err(ZoneError::Rpc { code: Some("access_denied".into()), message: "access denied".into(), data: None }));
        script.answer("login_by_password", Ok(pair(10, "c")));
        sessions.token(&key, "bob.example").await.unwrap();
        assert_eq!(sessions.status(&key).state, SessionState::SignedIn);
        // and when the digest is refused too, the user is asked, once
        script.answer("refresh_token", Err(rpc_error("refresh token revoked")));
        script.answer("login_by_password", Err(rpc_error("Invalid password")));
        assert!(matches!(sessions.token(&key, "bob.example").await, Err(ZoneError::NeedPassword)));
        assert_eq!(sessions.status(&key).state, SessionState::NeedPassword);
        assert!(matches!(sessions.token(&key, "bob.example").await, Err(ZoneError::NeedPassword)));
        assert_eq!(script.asked("login_by_password").len(), 3);
    }

    #[tokio::test]
    async fn a_lost_network_keeps_the_session() {
        let (script, sessions, key, secrets) = fixture();
        script.answer("login_by_password", Ok(pair(10, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        script.answer("refresh_token", Err(ZoneError::Network("down".into())));
        assert!(sessions.token(&key, "bob.example").await.unwrap_err().is_network());
        assert_eq!(sessions.status(&key).state, SessionState::Offline);
        assert!(secrets.get("session:did:bns:alice:did:bns:bob").is_some());
        script.answer("refresh_token", Ok(pair(900, "b")));
        assert!(sessions.token(&key, "bob.example").await.is_ok());
        assert_eq!(sessions.status(&key).state, SessionState::SignedIn);
    }

    #[tokio::test]
    async fn a_restart_goes_on_with_the_saved_session() {
        let (script, sessions, key, secrets) = fixture();
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        let again = Sessions::new(script.clone(), secrets);
        assert_eq!(again.status(&key).state, SessionState::SignedIn);
        assert!(again.token(&key, "bob.example").await.unwrap().ends_with(".a"));
        assert_eq!(script.asked("login_by_password").len(), 1);
    }

    #[tokio::test]
    async fn a_restart_after_the_session_ended_signs_in_again_by_itself() {
        let (script, sessions, key, secrets) = fixture();
        script.answer("login_by_password", Ok(pair(10, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        let again = Sessions::new(script.clone(), secrets);
        // not "signed out": the saved credential has not been tried yet
        assert_eq!(again.status(&key).state, SessionState::SigningIn);
        script.answer("refresh_token", Err(rpc_error("expired")));
        script.answer("login_by_password", Ok(pair(900, "b")));
        again.resume(&key, "bob.example").await;
        assert_eq!(again.status(&key).state, SessionState::SignedIn);
    }

    #[tokio::test]
    async fn zones_do_not_share_anything() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        let other = ZoneKey { zone: "did:web:charlie.me".into(), ..key.clone() };
        assert!(matches!(sessions.token(&other, "charlie.me").await, Err(ZoneError::NeedPassword)));
        let other_account = ZoneKey { account: "did:bns:carol".into(), ..key };
        assert!(matches!(sessions.token(&other_account, "bob.example").await, Err(ZoneError::NeedPassword)));
    }

    #[tokio::test]
    async fn forwards_a_request_body_with_the_token_and_retries_a_dead_one() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        script.answer("apps.list", Err(rpc_error("Invalid token: revoked")));
        script.answer("refresh_token", Ok(pair(900, "b")));
        script.answer("apps.list", Ok(json!({ "apps": [] })));
        let answer = sessions
            .forward(&key, "bob.example", "control-panel", r#"{"method":"apps.list","params":{},"sys":[7,"stale","trace-1"]}"#)
            .await
            .unwrap();
        assert!(answer.contains("\"apps\""));
        let asked = script.asked("apps.list");
        assert_eq!(asked[0]["sys"][0], json!(7));
        assert!(asked[0]["sys"][1].as_str().unwrap().ends_with(".a"));
        assert!(asked[1]["sys"][1].as_str().unwrap().ends_with(".b"));
        assert_eq!(asked[1]["sys"][2], json!("trace-1"));
    }

    #[tokio::test]
    async fn a_zone_that_is_only_starting_does_not_ask_for_the_password() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Err(ZoneError::Http(404, String::new())));
        assert!(sessions.login_unasked(&key, "bob.example", credential()).await.is_err());
        assert_eq!(sessions.status(&key).state, SessionState::Offline);
        assert!(sessions.token(&key, "bob.example").await.is_err());
        assert_eq!(sessions.status(&key).state, SessionState::Offline);
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login_unasked(&key, "bob.example", credential()).await.unwrap();
        assert_eq!(sessions.status(&key).state, SessionState::SignedIn);
    }

    #[tokio::test]
    async fn the_state_follows_the_connection() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        script.answer("auth.current_identity", Err(ZoneError::Network("no route".into())));
        assert!(sessions.check(&key, "bob.example").await.is_err());
        assert_eq!(sessions.status(&key).state, SessionState::Offline);
        script.answer("auth.current_identity", Err(ZoneError::Http(502, String::new())));
        assert!(sessions.check(&key, "bob.example").await.is_err());
        assert_eq!(sessions.status(&key).state, SessionState::SignedIn);
        script.answer("auth.current_identity", Ok(identity()));
        assert!(sessions.check(&key, "bob.example").await.is_ok());
        assert_eq!(sessions.status(&key).state, SessionState::SignedIn);
    }

    #[tokio::test]
    async fn the_session_goes_to_the_zone_root_only() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        let get = |url: &str| HttpRequest { method: "GET".into(), url: url.into(), headers: vec![], body: None };
        assert!(sessions.fetch(&key, "bob.example", get("https://bob.example/api/desktop")).await.is_ok());
        for url in ["https://notes.bob.example/icon.png", "https://evil.example/", "http://bob.example/", "https://bob.example:8443/", "https://x@bob.example/"] {
            assert!(sessions.fetch(&key, "bob.example", get(url)).await.is_err(), "{url}");
        }
    }

    #[tokio::test]
    async fn makes_one_time_callbacks_for_pages() {
        let (script, sessions, key, _) = fixture();
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        script.answer("auth.login", Ok(json!({ "sso_nonce": 42, "session_token": "x" })));
        assert_eq!(
            sessions.page_callback(&key, "bob.example", "https://bob.example/messagehub?notify=1#top").await.unwrap(),
            "https://bob.example/sso_callback?nonce=42&redirect_url=https%3A%2F%2Fbob.example%2Fmessagehub%3Fnotify%3D1%23top"
        );
        script.answer("auth.prepare_app_launch", Ok(json!({ "status": "ready", "callback_url": "https://notes.bob.example/sso_callback?nonce=1" })));
        let launch = LaunchTarget::App("notes@bob".into());
        assert!(sessions.app_callback(&key, "bob.example", &launch, "https://notes.bob.example/").await.unwrap().is_some());
        script.answer("auth.prepare_app_launch", Ok(json!({ "status": "ready", "callback_url": "https://evil.example/" })));
        assert!(sessions.app_callback(&key, "bob.example", &launch, "https://notes.bob.example/").await.unwrap().is_none());
        script.answer("auth.prepare_app_launch", Ok(json!({ "status": "invalid_target" })));
        assert!(sessions.app_callback(&key, "bob.example", &launch, "https://notes.bob.example/").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn signing_out_forgets_everything_and_tells_the_listener() {
        let (script, sessions, key, secrets) = fixture();
        let seen: Arc<Mutex<Vec<SessionState>>> = Arc::default();
        let sink = seen.clone();
        sessions.on_change(move |_, status| sink.lock().unwrap().push(status.state));
        script.answer("login_by_password", Ok(pair(900, "a")));
        script.answer("auth.current_identity", Ok(identity()));
        sessions.login(&key, "bob.example", credential()).await.unwrap();
        sessions.logout(&key, "bob.example").await;
        assert_eq!(*seen.lock().unwrap(), vec![SessionState::SigningIn, SessionState::SignedIn, SessionState::SignedOut]);
        assert_eq!(script.asked("logout").len(), 1);
        assert!(secrets.get("session:did:bns:alice:did:bns:bob").is_none());
        assert!(matches!(sessions.token(&key, "bob.example").await, Err(ZoneError::NeedPassword)));
    }
}
