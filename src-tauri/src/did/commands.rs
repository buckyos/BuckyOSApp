use bip39::{Language, Mnemonic};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

use crate::error::{CommandErrors, CommandResult};

use super::crypto::{decrypt_mnemonic, encrypt_mnemonic};
use super::domain::{BtcAddressType, DidInfo, SnStatusInfo};
use super::identity::{derive_wallets_with_requests, DidDerivationPlan, WalletRequest};
use super::store::{load_vault, new_did_id, open_store, save_vault, StoredDid};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use secrecy::{ExposeSecret, SecretString};
use std::time::{SystemTime, UNIX_EPOCH};

const OWNER_DOCUMENT_MAX_BYTES: usize = 4 * 1024;
const OWNER_DERIVATION_PATH_PREFIX: &str = "m/9777'/0'/";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RegistrationDerivation {
    pub index: u32,
    pub derivation_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RegistrationMaterial {
    pub normalized_name: String,
    pub owner_did: String,
    pub owner_public_jwk: Value,
    pub owner_derivation: RegistrationDerivation,
    pub evm_address: String,
    pub evm_derivation: RegistrationDerivation,
}

struct ValidatedOwnerDocument {
    name: String,
    id: String,
    raw_json: String,
    public_key_x: String,
    evm_address: String,
}

fn is_evm_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value[2..].chars().all(|ch| ch.is_ascii_hexdigit())
}

fn contains_sensitive_owner_field(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, child)| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "email"
                    | "mnemonic"
                    | "mnemonic_words"
                    | "private_key"
                    | "private_key_pem"
                    | "private_key_hex"
                    | "password"
                    | "pwd_hash"
                    | "password_hash"
                    | "active_code"
                    | "access_token"
                    | "refresh_token"
                    | "sn_token"
            ) || contains_sensitive_owner_field(child)
        }),
        Value::Array(items) => items.iter().any(contains_sensitive_owner_field),
        _ => false,
    }
}

fn validate_avatar(value: &str) -> bool {
    let Some((method, payload)) = value.split_once(':') else {
        return false;
    };
    !payload.trim().is_empty()
        && method.chars().enumerate().all(|(index, ch)| {
            ch.is_ascii_lowercase()
                || (index > 0 && (ch.is_ascii_digit() || ch == '_' || ch == '-'))
        })
}

fn validate_owner_document_json(raw_json: String) -> CommandResult<ValidatedOwnerDocument> {
    if raw_json.as_bytes().len() >= OWNER_DOCUMENT_MAX_BYTES {
        return Err(CommandErrors::internal("owner_document_too_large"));
    }

    let value: Value = serde_json::from_str(&raw_json)
        .map_err(|_| CommandErrors::internal("invalid_owner_document"))?;
    if !value.is_object() || contains_sensitive_owner_field(&value) {
        return Err(CommandErrors::internal("invalid_owner_document"));
    }

    // A successful round trip through Rust name-lib proves the WebSDK shape
    // remains compatible with the canonical OwnerDocument schema.
    let owner: name_lib::OwnerDocument = serde_json::from_value(value.clone())
        .map_err(|_| CommandErrors::internal("invalid_owner_document"))?;
    serde_json::to_value(&owner).map_err(|_| CommandErrors::internal("invalid_owner_document"))?;

    let name = owner.name.trim().to_ascii_lowercase();
    let id = owner.id.to_string();
    if name.is_empty() || owner.name != name || id != format!("did:bns:{name}") {
        return Err(CommandErrors::internal("invalid_owner_document_identity"));
    }
    if owner.display_name.trim().is_empty() {
        return Err(CommandErrors::internal("owner_display_name_required"));
    }
    if owner.display_name.len() > 256 {
        return Err(CommandErrors::internal("owner_display_name_too_long"));
    }
    let avatar = owner
        .avatar
        .as_deref()
        .filter(|avatar| validate_avatar(avatar))
        .ok_or_else(|| CommandErrors::internal("invalid_owner_avatar"))?;
    if avatar.len() > 512 {
        return Err(CommandErrors::internal("invalid_owner_avatar"));
    }

    let main_wallet = owner
        .wallets
        .get("main")
        .filter(|wallet| wallet.wallet_type == "eth" && is_evm_address(&wallet.address))
        .ok_or_else(|| CommandErrors::internal("invalid_owner_wallet"))?;

    let public_key = value
        .get("verificationMethod")
        .and_then(Value::as_array)
        .and_then(|methods| methods.first())
        .and_then(|method| method.get("publicKeyJwk"))
        .and_then(Value::as_object)
        .ok_or_else(|| CommandErrors::internal("invalid_owner_public_key"))?;
    if public_key.get("kty").and_then(Value::as_str) != Some("OKP")
        || public_key.get("crv").and_then(Value::as_str) != Some("Ed25519")
    {
        return Err(CommandErrors::internal("invalid_owner_public_key"));
    }
    let public_key_x = public_key
        .get("x")
        .and_then(Value::as_str)
        .filter(|x| {
            x.len() == 43
                && x.chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
        })
        .ok_or_else(|| CommandErrors::internal("invalid_owner_public_key"))?
        .to_string();

    Ok(ValidatedOwnerDocument {
        name,
        id,
        raw_json,
        public_key_x,
        evm_address: main_wallet.address.clone(),
    })
}

fn validate_document_matches_wallets(
    document: &ValidatedOwnerDocument,
    wallets: &super::domain::WalletCollection,
) -> CommandResult<()> {
    let owner_x = wallets
        .bucky
        .entries
        .first()
        .and_then(|identity| identity.public_key.get("x"))
        .and_then(Value::as_str)
        .ok_or_else(|| CommandErrors::key_derivation_failed("missing_bucky_public_key"))?;
    let evm_address = wallets
        .eth
        .entries
        .first()
        .map(|entry| entry.address.as_str())
        .ok_or_else(|| CommandErrors::key_derivation_failed("missing_evm_address"))?;

    if owner_x != document.public_key_x || !evm_address.eq_ignore_ascii_case(&document.evm_address)
    {
        return Err(CommandErrors::internal("owner_document_key_mismatch"));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WalletExtensionKind {
    Btc {
        address_type: BtcAddressType,
        #[serde(default = "default_count")]
        count: u32,
    },
    Eth {
        #[serde(default = "default_count")]
        count: u32,
    },
    Bucky {
        #[serde(default = "default_count")]
        count: u32,
    },
}

fn default_count() -> u32 {
    1
}

#[tauri::command]
pub fn generate_mnemonic() -> CommandResult<Vec<String>> {
    let mut entropy = [0u8; 16]; // 128 bits for 12 words
    OsRng.fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)?;
    Ok(mnemonic
        .to_string()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect())
}

#[tauri::command]
pub fn validate_mnemonic_words(words: Vec<String>) -> CommandResult<Option<String>> {
    for word in words {
        let trimmed = word.trim();
        if trimmed.is_empty() {
            continue;
        }
        if Language::English.find_word(trimmed).is_none() {
            return Ok(Some(trimmed.to_string()));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn derive_registration_material(
    mnemonic_words: Vec<String>,
    normalized_name: String,
) -> CommandResult<RegistrationMaterial> {
    if mnemonic_words.is_empty() {
        return Err(CommandErrors::MnemonicRequired);
    }

    let decrypted = mnemonic_words.join(" ");
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())?;
    drop(secret_phrase);
    let normalized_name = normalized_name.trim().to_ascii_lowercase();
    if normalized_name.is_empty() {
        return Err(CommandErrors::internal("invalid_bns_name"));
    }

    let requests = vec![WalletRequest::bucky(1), WalletRequest::eth(1)];
    let wallets = derive_wallets_with_requests(&mnemonic, "", &requests, None)?;
    let owner = wallets
        .bucky
        .entries
        .first()
        .ok_or_else(|| CommandErrors::key_derivation_failed("missing_bucky_public_key"))?;
    let evm = wallets
        .eth
        .entries
        .first()
        .ok_or_else(|| CommandErrors::key_derivation_failed("missing_evm_address"))?;
    let owner_index = owner.index;
    let evm_index = evm.index;

    Ok(RegistrationMaterial {
        owner_did: format!("did:bns:{normalized_name}"),
        normalized_name,
        owner_public_jwk: owner.public_key.clone(),
        owner_derivation: RegistrationDerivation {
            index: owner_index,
            // name-lib's utility path is m/9777'/0'/{index}'. It currently
            // exposes the derived public material but not the path string.
            derivation_path: format!("{OWNER_DERIVATION_PATH_PREFIX}{owner_index}'"),
        },
        evm_address: evm.address.clone(),
        evm_derivation: RegistrationDerivation {
            index: evm_index,
            derivation_path: name_lib::evm_derivation_path(evm_index),
        },
    })
}

#[tauri::command]
pub fn create_did(
    app_handle: AppHandle<impl Runtime>,
    password: String,
    mnemonic_words: Vec<String>,
    owner_document_json: String,
) -> CommandResult<DidInfo> {
    let mnemonic_phrase = mnemonic_words.join(" ");
    let mnemonic = Mnemonic::parse_in(Language::English, &mnemonic_phrase)?;

    let requests = DidDerivationPlan::default_requests();
    let wallets = derive_wallets_with_requests(&mnemonic, "", &requests, None)?;
    let owner_document = validate_owner_document_json(owner_document_json)?;
    validate_document_matches_wallets(&owner_document, &wallets)?;

    let encrypted_seed = encrypt_mnemonic(&password, &mnemonic)?;

    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    if vault
        .dids
        .iter()
        .any(|did| did.nickname.eq_ignore_ascii_case(&owner_document.name))
    {
        return Err(CommandErrors::NicknameExists);
    }

    let record = StoredDid {
        id: new_did_id(),
        nickname: owner_document.name.clone(),
        seed: encrypted_seed,
        wallets,
        owner_document: Some(owner_document.raw_json),
        sn_status: Some(SnStatusInfo {
            username: Some(owner_document.name),
            zone_config: None,
        }),
    };

    vault.active_did = Some(record.id.clone());
    vault.dids.push(record.clone());

    save_vault(&store, &vault)?;

    Ok(record.to_info())
}

#[tauri::command]
pub fn import_did(
    app_handle: AppHandle<impl Runtime>,
    password: String,
    mnemonic_words: Vec<String>,
    owner_document_json: String,
) -> CommandResult<DidInfo> {
    if mnemonic_words.is_empty() {
        return Err(CommandErrors::MnemonicRequired);
    }

    let decrypted = mnemonic_words.join(" ");
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())?;
    drop(secret_phrase);

    let requests = DidDerivationPlan::default_requests();
    let wallets = derive_wallets_with_requests(&mnemonic, "", &requests, None)?;
    let owner_document = validate_owner_document_json(owner_document_json)?;
    validate_document_matches_wallets(&owner_document, &wallets)?;

    let encrypted_seed = encrypt_mnemonic(&password, &mnemonic)?;

    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    if vault.dids.iter().any(|existing| {
        existing
            .owner_document
            .as_ref()
            .and_then(|json| serde_json::from_str::<Value>(json).ok())
            .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_string))
            .as_deref()
            == Some(owner_document.id.as_str())
    }) {
        return Err(CommandErrors::IdentityExists);
    }

    if vault
        .dids
        .iter()
        .any(|did| did.nickname.eq_ignore_ascii_case(&owner_document.name))
    {
        return Err(CommandErrors::NicknameExists);
    }

    let username = owner_document.name.clone();
    let record = StoredDid {
        id: new_did_id(),
        nickname: owner_document.name,
        seed: encrypted_seed,
        wallets,
        owner_document: Some(owner_document.raw_json),
        sn_status: Some(SnStatusInfo {
            username: Some(username),
            zone_config: None,
        }),
    };

    vault.active_did = Some(record.id.clone());
    vault.dids.push(record.clone());

    save_vault(&store, &vault)?;

    Ok(record.to_info())
}

#[tauri::command]
pub fn extend_wallets(
    app_handle: AppHandle<impl Runtime>,
    password: String,
    did_id: String,
    request: WalletExtensionKind,
) -> CommandResult<DidInfo> {
    let count = match &request {
        WalletExtensionKind::Btc { count, .. }
        | WalletExtensionKind::Eth { count }
        | WalletExtensionKind::Bucky { count } => *count,
    };
    if count == 0 {
        return Err(CommandErrors::CountMustBePositive);
    }

    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    let info = {
        let record = vault
            .dids
            .iter_mut()
            .find(|did| did.id == did_id)
            .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

        let decrypted = decrypt_mnemonic(&password, &record.seed)?;
        let secret_phrase = SecretString::new(decrypted);
        let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())?;
        drop(secret_phrase);

        let requests = match request {
            WalletExtensionKind::Btc {
                address_type,
                count,
            } => vec![WalletRequest::btc(address_type, count)],
            WalletExtensionKind::Eth { count } => vec![WalletRequest::eth(count)],
            WalletExtensionKind::Bucky { count } => vec![WalletRequest::bucky(count)],
        };

        if requests.is_empty() {
            record.to_info()
        } else {
            let new_wallets =
                derive_wallets_with_requests(&mnemonic, "", &requests, Some(&record.wallets))?;
            record.wallets.merge(new_wallets);
            record.to_info()
        }
    };

    save_vault(&store, &vault)?;
    Ok(info)
}

#[tauri::command]
pub fn wallet_exists(app_handle: AppHandle<impl Runtime>) -> CommandResult<bool> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    Ok(!vault.dids.is_empty())
}

#[tauri::command]
pub fn list_dids(app_handle: AppHandle<impl Runtime>) -> CommandResult<Vec<DidInfo>> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    Ok(vault.dids.iter().map(StoredDid::to_info).collect())
}

#[tauri::command]
pub fn active_did(app_handle: AppHandle<impl Runtime>) -> CommandResult<Option<DidInfo>> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;

    Ok(vault.active_did.and_then(|id| {
        vault
            .dids
            .iter()
            .find(|did| did.id == id)
            .map(StoredDid::to_info)
    }))
}

#[tauri::command]
pub fn set_active_did(
    app_handle: AppHandle<impl Runtime>,
    did_id: String,
) -> CommandResult<DidInfo> {
    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    let record = vault
        .dids
        .iter()
        .find(|did| did.id == did_id)
        .cloned()
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    vault.active_did = Some(record.id.clone());
    save_vault(&store, &vault)?;

    Ok(record.to_info())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
pub struct SnStatusPayload {
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone_config: Option<String>,
}

#[tauri::command]
pub fn list_sn_statuses(
    app_handle: AppHandle<impl Runtime>,
) -> CommandResult<HashMap<String, SnStatusInfo>> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    let mut map = HashMap::new();
    for did in &vault.dids {
        if let Some(status) = &did.sn_status {
            map.insert(did.id.clone(), status.clone());
        }
    }
    Ok(map)
}

#[tauri::command]
pub fn set_sn_status(
    app_handle: AppHandle<impl Runtime>,
    did_id: String,
    status: SnStatusPayload,
) -> CommandResult<()> {
    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    let username = status
        .username
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let record = vault
        .dids
        .iter_mut()
        .find(|did| did.id == did_id)
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    record.sn_status = Some(SnStatusInfo {
        username,
        zone_config: status
            .zone_config
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    });

    save_vault(&store, &vault)
}

#[tauri::command]
pub fn clear_sn_status(app_handle: AppHandle<impl Runtime>, did_id: String) -> CommandResult<()> {
    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;
    if let Some(record) = vault.dids.iter_mut().find(|did| did.id == did_id) {
        record.sn_status = None;
    }
    save_vault(&store, &vault)
}

#[tauri::command]
pub fn delete_wallet(
    app_handle: AppHandle<impl Runtime>,
    password: String,
    did_id: Option<String>,
) -> CommandResult<()> {
    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    let target_id = match did_id {
        Some(id) => id,
        None => vault
            .active_did
            .clone()
            .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?,
    };

    let position = vault
        .dids
        .iter()
        .position(|did| did.id == target_id)
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    let record = vault.dids.get(position).expect("did exists");
    decrypt_mnemonic(&password, &record.seed)?;

    vault.dids.remove(position);

    if matches!(vault.active_did.as_deref(), Some(active) if active == target_id) {
        vault.active_did = None;
    }

    save_vault(&store, &vault)?;
    Ok(())
}

#[tauri::command]
pub fn reveal_mnemonic(
    app_handle: AppHandle<impl Runtime>,
    password: String,
    did_id: Option<String>,
) -> CommandResult<Vec<String>> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;

    let target_id = did_id
        .or_else(|| vault.active_did.clone())
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    let record = vault
        .dids
        .iter()
        .find(|did| did.id == target_id)
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    let decrypted = decrypt_mnemonic(&password, &record.seed)?;
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())?;
    drop(secret_phrase);

    Ok(mnemonic
        .to_string()
        .split_whitespace()
        .map(|w| w.to_string())
        .collect())
}

#[tauri::command]
pub fn current_wallet_nickname(
    app_handle: AppHandle<impl Runtime>,
) -> CommandResult<Option<String>> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;

    match &vault.active_did {
        Some(active_id) => Ok(vault
            .dids
            .iter()
            .find(|did| &did.id == active_id)
            .map(|did| did.nickname.clone())),
        None => Ok(None),
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ZoneBootClaims {
    oods: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sn: Option<String>,
    exp: usize,
    iat: usize,
}

fn load_active_signing_key(
    app_handle: &AppHandle<impl Runtime>,
    password: &str,
) -> CommandResult<(EncodingKey, Option<String>)> {
    let store = open_store(app_handle)?;
    let vault = load_vault(&store)?;
    let target_id = vault
        .active_did
        .clone()
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    let record = vault
        .dids
        .iter()
        .find(|d| d.id == target_id)
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    let decrypted = decrypt_mnemonic(password, &record.seed)?;
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())?;
    drop(secret_phrase);

    let phrase = mnemonic.to_string();
    let index = 0u32;
    let derived = name_lib::derive_bucky_key_from_mnemonic(&phrase, None, index)
        .map_err(|e| CommandErrors::crypto_failed(e.to_string()))?;

    let pem_key = EncodingKey::from_ed_pem(derived.private_key_pem.as_bytes())
        .map_err(|e| CommandErrors::crypto_failed(format!("invalid ed25519 private key: {e}")))?;

    let did_label = record
        .wallets
        .bucky
        .entries
        .first()
        .map(|entry| entry.did.clone());

    Ok((pem_key, did_label))
}

#[tauri::command]
pub fn sign_json_with_active_did(
    app_handle: AppHandle<impl Runtime>,
    password: String,
    payloads: Vec<Value>,
) -> CommandResult<Vec<Option<String>>> {
    let mut sanitized = Vec::with_capacity(payloads.len());
    let mut invalid_found = false;
    for value in payloads {
        match value {
            Value::Object(_) => sanitized.push(value),
            _ => {
                invalid_found = true;
                break;
            }
        }
    }

    if sanitized.is_empty() || invalid_found {
        return Err(CommandErrors::SignMessageRequired);
    }

    let (pem_key, _did_label) = load_active_signing_key(&app_handle, &password)?;

    let mut signatures = Vec::with_capacity(sanitized.len());
    for payload in sanitized {
        let mut header = Header::new(Algorithm::EdDSA);
        header.kid = None;
        header.typ = None;

        match encode(&header, &payload, &pem_key) {
            Ok(token) => signatures.push(Some(token)),
            Err(err) => {
                log::error!("sign_json_with_active_did encode failed: {err}");
                signatures.push(None);
            }
        }
    }

    Ok(signatures)
}

#[tauri::command]
pub fn generate_zone_boot_config_jwt(
    app_handle: AppHandle<impl Runtime>,
    password: String,
    did_id: Option<String>,
    sn: Option<String>,
    #[allow(unused_variables)] ood_name: Option<String>,
) -> CommandResult<String> {
    // resolve target DID (active by default)
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    let target_id = did_id
        .or(vault.active_did.clone())
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;
    let record = vault
        .dids
        .iter()
        .find(|d| d.id == target_id)
        .ok_or_else(|| CommandErrors::not_found("wallet_not_found"))?;

    // unlock mnemonic to validate password and derive private key
    let decrypted = decrypt_mnemonic(&password, &record.seed)?;
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())?;
    drop(secret_phrase);

    // derive ed25519 owner private key from mnemonic index 0 (Bucky identity)
    let phrase = mnemonic.to_string();
    let index = 0u32;
    let derived = name_lib::derive_bucky_key_from_mnemonic(&phrase, None, index)
        .map_err(|e| CommandErrors::crypto_failed(e.to_string()))?;

    let pem_key = EncodingKey::from_ed_pem(derived.private_key_pem.as_bytes())
        .map_err(|e| CommandErrors::crypto_failed(format!("invalid ed25519 private key: {e}")))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| CommandErrors::internal(e.to_string()))?
        .as_secs() as usize;

    let ood = ood_name.unwrap_or_else(|| "ood1".to_string());
    let claims = ZoneBootClaims {
        oods: vec![ood],
        sn: sn.filter(|s| !s.is_empty()),
        // 10 years validity
        exp: now + 3600 * 24 * 365 * 10,
        iat: now,
    };

    let mut header = Header::new(Algorithm::EdDSA);
    header.kid = None;
    header.typ = None;
    let token = encode(&header, &claims, &pem_key)?;

    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::did::domain::DEFAULT_BTC_ADDRESS_TYPE;
    use crate::did::store::{save_vault, VaultStore, STORE_KEY};
    use name_lib::{OwnerDocument, OwnerWallet, DID};
    use std::collections::HashMap;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

    static STORE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn test_app() -> tauri::App<MockRuntime> {
        mock_builder()
            .plugin(tauri_plugin_store::Builder::default().build())
            .build(mock_context(noop_assets()))
            .unwrap()
    }

    fn reset_vault(app_handle: &AppHandle<MockRuntime>) {
        let store = open_store(app_handle).unwrap();
        save_vault(&store, &VaultStore::default()).unwrap();
    }

    fn mnemonic_words() -> Vec<String> {
        vec![
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "about",
        ]
        .into_iter()
        .map(String::from)
        .collect()
    }

    fn owner_document_json(name: &str) -> String {
        let phrase = mnemonic_words().join(" ");
        let bucky = name_lib::derive_bucky_key_from_mnemonic(&phrase, None, 0).unwrap();
        let evm = name_lib::derive_evm_key_from_mnemonic(&phrase, None, 0).unwrap();
        let public_key = serde_json::from_value(bucky.public_jwk).unwrap();
        let mut owner = OwnerDocument::new(
            DID::new("bns", name),
            name.to_string(),
            "Test User".to_string(),
            public_key,
        );
        owner.avatar = Some("dicebear:test-user".to_string());
        owner.wallets = HashMap::from([(
            "main".to_string(),
            OwnerWallet {
                wallet_type: "eth".to_string(),
                address: evm.address,
            },
        )]);
        serde_json::to_string(&owner).unwrap()
    }

    #[test]
    fn test_generate_mnemonic() {
        let words = generate_mnemonic().unwrap();
        assert_eq!(words.len(), 12);
    }

    #[test]
    fn test_eth_address_derivation_and_eip55() {
        let mnemonic =
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let address = name_lib::derive_evm_key_from_mnemonic(mnemonic, None, 0)
            .unwrap()
            .address;
        assert_eq!(address, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    }

    #[test]
    fn test_registration_material_derivation_vector() {
        let material = derive_registration_material(mnemonic_words(), "alice0001".to_string())
            .expect("registration material");
        assert_eq!(material.owner_did, "did:bns:alice0001");
        assert_eq!(material.owner_derivation.index, 0);
        assert_eq!(material.owner_derivation.derivation_path, "m/9777'/0'/0'");
        assert_eq!(
            material.owner_public_jwk,
            serde_json::json!({
                "kty": "OKP",
                "crv": "Ed25519",
                "x": "TFCczaH036J93MRNk0bMMy5zpAha29uNOO7WgcWnrWo"
            })
        );
        assert_eq!(material.evm_derivation.derivation_path, "m/44'/60'/0'/0/0");
        assert_eq!(
            material.evm_address,
            "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
        );
    }

    #[test]
    fn test_owner_document_round_trip_and_sensitive_fields() {
        let raw = owner_document_json("alice0001");
        let validated = validate_owner_document_json(raw.clone()).unwrap();
        assert_eq!(validated.name, "alice0001");
        assert_eq!(validated.id, "did:bns:alice0001");
        assert_eq!(validated.raw_json, raw);

        let websdk_snapshot = serde_json::json!({
            "@context": [
                "https://www.w3.org/ns/did/v1",
                "https://buckyos.org/ns/owner/v1"
            ],
            "id": "did:bns:alice0001",
            "verificationMethod": [{
                "type": "Ed25519VerificationKey2020",
                "id": "#main_key",
                "controller": "did:bns:alice0001",
                "publicKeyJwk": {
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "x": "TFCczaH036J93MRNk0bMMy5zpAha29uNOO7WgcWnrWo"
                }
            }],
            "authentication": ["#main_key"],
            "assertion_method": ["#main_key"],
            "capabilityInvocation": ["#main_key"],
            "exp": 2098915200_u64,
            "iat": 1783555200_u64,
            "version_seq": 0,
            "name": "alice0001",
            "display_name": "Alice Zhang",
            "avatar": "dicebear:alice-avatar-01",
            "wallets": {
                "main": {
                    "type": "eth",
                    "address": "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
                }
            }
        });
        validate_owner_document_json(websdk_snapshot.to_string()).unwrap();

        let mut invalid: Value = serde_json::from_str(&owner_document_json("alice0001")).unwrap();
        invalid["email"] = Value::String("alice@example.com".to_string());
        assert!(validate_owner_document_json(invalid.to_string()).is_err());
    }

    #[test]
    fn test_create_did_flow() {
        let _guard = STORE_TEST_LOCK.lock().unwrap();
        let app = test_app();
        let app_handle = app.handle();
        reset_vault(app_handle);

        let nickname = "test_user".to_string();
        let password = "password123".to_string();
        let did_info = create_did(
            app_handle.clone(),
            password.clone(),
            mnemonic_words(),
            owner_document_json(&nickname),
        )
        .unwrap();

        assert_eq!(did_info.nickname, nickname);
        assert!(did_info.btc_addresses.is_empty());
        assert_eq!(did_info.eth_addresses.len(), 1);
        assert_eq!(did_info.bucky_wallets.len(), 1);
        assert_eq!(
            did_info.owner_document.as_ref().unwrap()["id"],
            "did:bns:test_user"
        );
        assert_eq!(
            did_info.sn_status.as_ref().unwrap().username.as_deref(),
            Some("test_user")
        );
        let identity = &did_info.bucky_wallets[0];
        assert_eq!(identity.index, 0);
        assert!(
            identity.did.starts_with("did:dev:"),
            "unexpected DID: {}",
            identity.did
        );

        let dids = list_dids(app_handle.clone()).unwrap();
        assert_eq!(dids.len(), 1);
        assert_eq!(dids[0].id, did_info.id);
        assert_eq!(dids[0].bucky_wallets.len(), 1);

        let active = active_did(app_handle.clone()).unwrap().unwrap();
        assert_eq!(active.id, did_info.id);

        let mnemonic = reveal_mnemonic(
            app_handle.clone(),
            password.clone(),
            Some(did_info.id.clone()),
        )
        .unwrap();
        assert_eq!(mnemonic.len(), 12);

        delete_wallet(app_handle.clone(), password, Some(did_info.id)).unwrap();
        let dids_after = list_dids(app_handle.clone()).unwrap();
        assert!(dids_after.is_empty());
    }

    #[test]
    fn test_import_did_persists_sn_username_and_migrates_legacy_record() {
        let _guard = STORE_TEST_LOCK.lock().unwrap();
        let app = test_app();
        let app_handle = app.handle();
        reset_vault(app_handle);

        let nickname = "import_user".to_string();
        let imported = import_did(
            app_handle.clone(),
            "password123".to_string(),
            mnemonic_words(),
            owner_document_json(&nickname),
        )
        .unwrap();

        assert_eq!(
            imported.sn_status.as_ref().unwrap().username.as_deref(),
            Some("import_user")
        );

        let store = open_store(app_handle).unwrap();
        let mut legacy_vault = load_vault(&store).unwrap();
        legacy_vault.dids[0].sn_status = None;
        legacy_vault.mark_legacy_for_test();
        save_vault(&store, &legacy_vault).unwrap();

        let migrated = active_did(app_handle.clone()).unwrap().unwrap();
        assert_eq!(
            migrated.sn_status.as_ref().unwrap().username.as_deref(),
            Some("import_user")
        );

        store.reload().unwrap();
        let persisted: VaultStore = serde_json::from_value(store.get(STORE_KEY).unwrap()).unwrap();
        assert_eq!(
            persisted.dids[0]
                .sn_status
                .as_ref()
                .unwrap()
                .username
                .as_deref(),
            Some("import_user")
        );
    }

    #[test]
    fn test_extend_wallets() {
        let _guard = STORE_TEST_LOCK.lock().unwrap();
        let app = test_app();
        let app_handle = app.handle();
        reset_vault(app_handle);

        let nickname = "extend_user".to_string();
        let password = "password123".to_string();
        let did_info = create_did(
            app_handle.clone(),
            password.clone(),
            mnemonic_words(),
            owner_document_json(&nickname),
        )
        .unwrap();

        let extended_btc = extend_wallets(
            app_handle.clone(),
            password.clone(),
            did_info.id.clone(),
            WalletExtensionKind::Btc {
                address_type: DEFAULT_BTC_ADDRESS_TYPE,
                count: 2,
            },
        )
        .unwrap();
        assert_eq!(extended_btc.btc_addresses.len(), 2);

        let extended_eth = extend_wallets(
            app_handle.clone(),
            password.clone(),
            did_info.id.clone(),
            WalletExtensionKind::Eth { count: 1 },
        )
        .unwrap();
        assert_eq!(extended_eth.eth_addresses.len(), 2);

        let extended_bucky = extend_wallets(
            app_handle.clone(),
            password.clone(),
            did_info.id.clone(),
            WalletExtensionKind::Bucky { count: 1 },
        )
        .unwrap();
        assert_eq!(extended_bucky.bucky_wallets.len(), 2);

        let listed = list_dids(app_handle.clone()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].btc_addresses.len(), 2);
        assert_eq!(listed[0].eth_addresses.len(), 2);
        assert_eq!(listed[0].bucky_wallets.len(), 2);

        delete_wallet(app_handle.clone(), password, Some(did_info.id)).unwrap();
        let after_delete = list_dids(app_handle.clone()).unwrap();
        assert!(after_delete.is_empty());
    }
}
