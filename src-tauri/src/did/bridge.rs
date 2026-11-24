//! The wallet methods of `window.BuckyApi`, answered `{ code, data, message }`.

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use super::commands::{active_account, active_did, sign_json_with_active_did, update_owner_document};
use super::domain::DidInfo;
use crate::error::CommandErrors;
use crate::zone::session::password_digest;

pub const BUCKY_API_OK: u32 = 0;
pub const BUCKY_API_NATIVE_ERROR: u32 = 2;
pub const BUCKY_API_NO_KEY: u32 = 3;
pub const BUCKY_API_NO_ACTIVE_DID: u32 = 4;
pub const BUCKY_API_NO_MESSAGE: u32 = 5;
pub const BUCKY_API_CANCELLED: u32 = 7;
pub const BUCKY_API_BUSY: u32 = 8;

fn answer(code: u32, message: &str) -> Value {
    json!({ "code": code, "message": message })
}

pub fn bridge_failure(message: impl Into<String>) -> Value {
    json!({ "code": BUCKY_API_NATIVE_ERROR, "message": message.into() })
}

pub fn bridge_busy() -> Value {
    answer(BUCKY_API_BUSY, "busy")
}

pub fn bridge_cancelled() -> Value {
    answer(BUCKY_API_CANCELLED, "cancelled")
}

fn active<R: Runtime>(app: &AppHandle<R>) -> Result<DidInfo, Value> {
    match active_did(app.clone()) {
        Ok(Some(did)) => Ok(did),
        Ok(None) => Err(answer(BUCKY_API_NO_ACTIVE_DID, "no_active_did")),
        Err(error) => Err(bridge_failure(error.message())),
    }
}

pub fn bridge_public_key<R: Runtime>(app: &AppHandle<R>) -> Value {
    match active(app) {
        Ok(did) => match did.bucky_wallets.first() {
            Some(wallet) => json!({ "code": BUCKY_API_OK, "data": { "key": wallet.public_key } }),
            None => answer(BUCKY_API_NO_KEY, "no_key"),
        },
        Err(failure) => failure,
    }
}

async fn current_user<R: Runtime>(app: &AppHandle<R>) -> Result<Value, Value> {
    let did = active(app)?;
    let wallet = did.bucky_wallets.first().ok_or_else(|| answer(BUCKY_API_NO_KEY, "no_key"))?;
    let owner_did = did
        .owner_document
        .as_ref()
        .and_then(|document| document.get("id")?.as_str().map(str::to_string))
        .ok_or_else(|| bridge_failure("owner_document_not_found"))?;
    let document = crate::name_resolution::resolve_document(app, &owner_did, Some("owner"))
        .await
        .map_err(|error| bridge_failure(error.message()))?;
    if document.get("id").and_then(Value::as_str) != Some(owner_did.as_str()) {
        return Err(bridge_failure("invalid_owner_document_identity"));
    }
    let updated = update_owner_document(app.clone(), did.id.clone(), document.to_string())
        .map_err(|error| bridge_failure(error.message()))?;
    let document = updated.owner_document.ok_or_else(|| bridge_failure("owner_document_not_found"))?;
    Ok(json!({
        "code": BUCKY_API_OK,
        "data": {
            "did": owner_did,
            "username": document.get("name").cloned().unwrap_or(Value::Null),
            "public_key": wallet.public_key,
            "sn_username": updated.sn_status.and_then(|status| status.username),
            "owner_document": document,
        },
    }))
}

pub async fn bridge_current_user<R: Runtime>(app: &AppHandle<R>) -> Value {
    current_user(app).await.unwrap_or_else(|failure| failure)
}

pub async fn bridge_resolve<R: Runtime>(app: &AppHandle<R>, payload: &Value) -> Value {
    let Some(did) = payload.get("did").and_then(Value::as_str).map(str::trim).filter(|did| !did.is_empty()) else {
        return bridge_failure("invalid_did");
    };
    let doc_type = match payload.get("docType") {
        None | Some(Value::Null) => None,
        Some(Value::String(doc_type)) => Some(doc_type.clone()),
        Some(_) => return bridge_failure("invalid_did_doc_type"),
    };
    match crate::name_resolution::resolve_did(app.clone(), did.to_string(), doc_type).await {
        Ok(document) => json!({ "code": BUCKY_API_OK, "data": document }),
        Err(error) => bridge_failure(error.message()),
    }
}

/// The objects to sign out of a `signJsonWithActiveDid` payload; an answer when there is nothing.
pub fn bridge_sign_payloads<R: Runtime>(app: &AppHandle<R>, payload: &Value) -> Result<Vec<Value>, Value> {
    active(app)?;
    let payloads: Vec<Value> = payload
        .get("payloads")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter(|item| item.is_object()).cloned().collect())
        .unwrap_or_default();
    if payloads.is_empty() {
        return Err(answer(BUCKY_API_NO_MESSAGE, "sign_message_required"));
    }
    Ok(payloads)
}

/// Signs with the password the user just typed into a window of the client, as the identity that
/// was asked; a switch meanwhile ends it. Only the activation page, which sets the password of the
/// new Zone, gets `pwd_hash`: the digest signs in to the account's own Zones.
pub fn bridge_sign<R: Runtime>(
    app: &AppHandle<R>,
    account: &str,
    password: &str,
    payloads: Vec<Value>,
    with_password_hash: bool,
) -> Result<Value, CommandErrors> {
    if active_account(app).as_deref() != Some(account) {
        return Err(CommandErrors::Canceled);
    }
    let signatures = sign_json_with_active_did(app.clone(), password.to_string(), payloads, None)?;
    let pwd_hash = if with_password_hash {
        active_did(app.clone())?
            .and_then(|did| did.sn_status)
            .and_then(|status| status.username)
            .map(|name| name.trim().to_ascii_lowercase())
            .filter(|name| !name.is_empty())
            .map(|username| password_digest(&username, password))
    } else {
        None
    };
    Ok(json!({ "code": BUCKY_API_OK, "data": { "signatures": signatures, "pwd_hash": pwd_hash } }))
}

/// The identity a page deals with, as the client shows it.
pub fn bridge_identity<R: Runtime>(app: &AppHandle<R>) -> Option<(String, String)> {
    let account = active_account(app)?;
    let name = active_did(app.clone()).ok().flatten().map(|did| did.nickname).unwrap_or_default();
    Some((account, name))
}
