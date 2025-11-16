use bip39::{Language, Mnemonic};
use rand::{rngs::OsRng, RngCore};
use serde::Deserialize;
use tauri::AppHandle;
use serde_json::Value;
use serde_json::json;

use super::crypto::{decrypt_mnemonic, encrypt_mnemonic};
use super::domain::{BtcAddressType, DidInfo, DEFAULT_BTC_ADDRESS_TYPE};
use super::identity::{derive_wallets_with_requests, DidDerivationPlan, WalletRequest};
use super::store::{load_vault, new_did_id, open_store, save_vault, StoredDid};
use secrecy::{ExposeSecret, SecretString};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(test)]
use super::derive::{derive_eth_address, SeedCtx};

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
pub fn generate_mnemonic() -> Result<Vec<String>, String> {
    let mut entropy = [0u8; 16]; // 128 bits for 12 words
    OsRng.fill_bytes(&mut entropy);
    let mnemonic =
        Mnemonic::from_entropy_in(Language::English, &entropy).map_err(|e| e.to_string())?;
    Ok(mnemonic
        .to_string()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect())
}

#[tauri::command]
pub fn create_did(
    app_handle: AppHandle,
    nickname: String,
    password: String,
    mnemonic_words: Vec<String>,
) -> Result<DidInfo, String> {
    let mnemonic_phrase = mnemonic_words.join(" ");
    let mnemonic =
        Mnemonic::parse_in(Language::English, &mnemonic_phrase).map_err(|e| e.to_string())?;

    let requests = DidDerivationPlan::default_requests();
    let wallets = derive_wallets_with_requests(&mnemonic, "", &requests, None)?;

    let encrypted_seed = encrypt_mnemonic(&password, &mnemonic).map_err(|e| e.to_string())?;

    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    if vault
        .dids
        .iter()
        .any(|did| did.nickname.eq_ignore_ascii_case(&nickname))
    {
        return Err("nickname_already_exists".to_string());
    }

    let record = StoredDid {
        id: new_did_id(),
        nickname,
        seed: encrypted_seed,
        wallets,
    };

    vault.active_did = Some(record.id.clone());
    vault.dids.push(record.clone());

    save_vault(&store, &vault)?;

    Ok(record.to_info())
}

#[tauri::command]
pub fn import_did(
    app_handle: AppHandle,
    nickname: String,
    password: String,
    mnemonic_words: Vec<String>,
) -> Result<DidInfo, String> {
    if mnemonic_words.is_empty() {
        return Err("mnemonic_required".to_string());
    }

    let decrypted = mnemonic_words.join(" ");
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())
        .map_err(|e| e.to_string())?;
    drop(secret_phrase);

    let requests = DidDerivationPlan::default_requests();
    let wallets = derive_wallets_with_requests(&mnemonic, "", &requests, None)?;

    let encrypted_seed = encrypt_mnemonic(&password, &mnemonic).map_err(|e| e.to_string())?;

    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    if vault
        .dids
        .iter()
        .any(|did| did.nickname.eq_ignore_ascii_case(&nickname))
    {
        return Err("nickname_already_exists".to_string());
    }

    if let Some(new_identity) = wallets.bucky.entries.first() {
        if vault.dids.iter().any(|existing| {
            existing
                .wallets
                .bucky
                .entries
                .iter()
                .any(|entry| entry.did == new_identity.did)
        }) {
            return Err("identity_already_exists".to_string());
        }
    }

    let record = StoredDid {
        id: new_did_id(),
        nickname,
        seed: encrypted_seed,
        wallets,
    };

    vault.active_did = Some(record.id.clone());
    vault.dids.push(record.clone());

    save_vault(&store, &vault)?;

    Ok(record.to_info())
}

#[tauri::command]
pub fn extend_wallets(
    app_handle: AppHandle,
    password: String,
    did_id: String,
    request: WalletExtensionKind,
) -> Result<DidInfo, String> {
    let count = match &request {
        WalletExtensionKind::Btc { count, .. }
        | WalletExtensionKind::Eth { count }
        | WalletExtensionKind::Bucky { count } => *count,
    };
    if count == 0 {
        return Err("count_must_be_positive".to_string());
    }

    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    let info = {
        let record = vault
            .dids
            .iter_mut()
            .find(|did| did.id == did_id)
            .ok_or_else(|| "wallet_not_found".to_string())?;

        let decrypted = decrypt_mnemonic(&password, &record.seed).map_err(|e| e.to_string())?;
        let secret_phrase = SecretString::new(decrypted);
        let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())
            .map_err(|e| e.to_string())?;
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
pub fn wallet_exists(app_handle: AppHandle) -> Result<bool, String> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    Ok(!vault.dids.is_empty())
}

#[tauri::command]
pub fn list_dids(app_handle: AppHandle) -> Result<Vec<DidInfo>, String> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    Ok(vault.dids.iter().map(StoredDid::to_info).collect())
}

#[tauri::command]
pub fn active_did(app_handle: AppHandle) -> Result<Option<DidInfo>, String> {
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
pub fn active_did_public_key(app_handle: AppHandle) -> Result<Option<Value>, String> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;

    let active_id = match &vault.active_did {
        Some(id) => id,
        None => return Ok(None),
    };

    let record = match vault.dids.iter().find(|d| &d.id == active_id) {
        Some(r) => r,
        None => return Ok(None),
    };

    let pubkey = record
        .wallets
        .bucky
        .entries
        .first()
        .map(|b| b.public_key.clone());

    Ok(pubkey)
}

#[tauri::command]
pub fn set_active_did(app_handle: AppHandle, did_id: String) -> Result<DidInfo, String> {
    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    let record = vault
        .dids
        .iter()
        .find(|did| did.id == did_id)
        .cloned()
        .ok_or_else(|| "wallet_not_found".to_string())?;

    vault.active_did = Some(record.id.clone());
    save_vault(&store, &vault)?;

    Ok(record.to_info())
}

#[tauri::command]
pub fn delete_wallet(
    app_handle: AppHandle,
    password: String,
    did_id: Option<String>,
) -> Result<(), String> {
    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    let target_id = match did_id {
        Some(id) => id,
        None => vault
            .active_did
            .clone()
            .ok_or_else(|| "wallet_not_found".to_string())?,
    };

    let position = vault
        .dids
        .iter()
        .position(|did| did.id == target_id)
        .ok_or_else(|| "wallet_not_found".to_string())?;

    let record = vault.dids.get(position).expect("did exists");
    decrypt_mnemonic(&password, &record.seed).map_err(|e| e.to_string())?;

    vault.dids.remove(position);

    if matches!(vault.active_did.as_deref(), Some(active) if active == target_id) {
        vault.active_did = vault.dids.first().map(|d| d.id.clone());
    }

    save_vault(&store, &vault)?;
    Ok(())
}

#[tauri::command]
pub fn reveal_mnemonic(
    app_handle: AppHandle,
    password: String,
    did_id: Option<String>,
) -> Result<Vec<String>, String> {
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;

    let target_id = did_id
        .or_else(|| vault.active_did.clone())
        .ok_or_else(|| "wallet_not_found".to_string())?;

    let record = vault
        .dids
        .iter()
        .find(|did| did.id == target_id)
        .ok_or_else(|| "wallet_not_found".to_string())?;

    let decrypted = decrypt_mnemonic(&password, &record.seed).map_err(|e| e.to_string())?;
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())
        .map_err(|e| e.to_string())?;
    drop(secret_phrase);

    Ok(mnemonic
        .to_string()
        .split_whitespace()
        .map(|w| w.to_string())
        .collect())
}

#[tauri::command]
pub fn current_wallet_nickname(app_handle: AppHandle) -> Result<Option<String>, String> {
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

#[tauri::command]
pub fn generate_zone_boot_config_jwt(
    app_handle: AppHandle,
    password: String,
    did_id: Option<String>,
    sn: Option<String>,
    #[allow(unused_variables)] ood_name: Option<String>,
) -> Result<String, String> {
    // resolve target DID (active by default)
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    let target_id = did_id
        .or(vault.active_did.clone())
        .ok_or_else(|| "wallet_not_found".to_string())?;
    let record = vault
        .dids
        .iter()
        .find(|d| d.id == target_id)
        .ok_or_else(|| "wallet_not_found".to_string())?;

    // unlock mnemonic to validate password and derive private key
    let decrypted = decrypt_mnemonic(&password, &record.seed).map_err(|e| e.to_string())?;
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())
        .map_err(|e| e.to_string())?;
    drop(secret_phrase);

    // derive ed25519 owner private key from mnemonic index 0 (Bucky identity)
    let phrase = mnemonic.to_string();
    let passphrase_opt: Option<&str> = None;
    let index = 0u32;
    let (private_pem, _public_jwk) = name_lib::generate_ed25519_key_pair_from_mnemonic(
        &phrase,
        passphrase_opt,
        index,
    )
    .map_err(|e| e.to_string())?;

    let pem_key = EncodingKey::from_ed_pem(private_pem.as_bytes())
        .map_err(|e| format!("invalid ed25519 private key: {}", e))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as usize;

    let ood = ood_name.unwrap_or_else(|| "ood1".to_string());
    let claims = ZoneBootClaims {
        oods: vec![ood],
        sn: sn.filter(|s| !s.is_empty()),
        // 10 years validity
        exp: now + 3600 * 24 * 365 * 10,
        iat: now,
    };

    let token = encode(&Header { alg: Algorithm::EdDSA, ..Default::default() }, &claims, &pem_key)
        .map_err(|e| e.to_string())?;

    Ok(token)
}

#[tauri::command]
pub fn sign_with_active_did(
    app_handle: AppHandle,
    password: String,
    payload: String,
) -> Result<String, String> {
    // 打开存储并获取当前激活 DID
    let store = open_store(&app_handle)?;
    let vault = load_vault(&store)?;
    let active_id = vault
        .active_did
        .ok_or_else(|| "wallet_not_found".to_string())?;
    let record = vault
        .dids
        .iter()
        .find(|d| d.id == active_id)
        .ok_or_else(|| "wallet_not_found".to_string())?;

    // 使用密码解锁助记词来验证并提取私钥
    let decrypted = decrypt_mnemonic(&password, &record.seed).map_err(|e| e.to_string())?;
    let secret_phrase = SecretString::new(decrypted);
    let mnemonic = Mnemonic::parse_in(Language::English, secret_phrase.expose_secret())
        .map_err(|e| e.to_string())?;
    drop(secret_phrase);

    // 从助记词派生 ed25519 私钥（Bucky identity index 0）
    let phrase = mnemonic.to_string();
    let passphrase_opt: Option<&str> = None;
    let index = 0u32;
    let (private_pem, _public_jwk) = name_lib::generate_ed25519_key_pair_from_mnemonic(
        &phrase,
        passphrase_opt,
        index,
    )
    .map_err(|e| e.to_string())?;

    let pem_key = EncodingKey::from_ed_pem(private_pem.as_bytes())
        .map_err(|e| format!("invalid ed25519 private key: {}", e))?;

    // 以 EdDSA 生成 JWT，claims 为 { data: payload }
    let mut header = Header::new(Algorithm::EdDSA);
    header.typ = None; // 节省空间
    header.kid = Some(record.id.clone());

    let claims = json!({ "data": payload });
    let token = encode(&header, &claims, &pem_key).map_err(|e| e.to_string())?;
    Ok(token)
}

// removed legacy password prompt helpers; frontend handles prompting

// removed submit_password; not used

/*
#[tauri::command]
pub fn sign_with_active_did_prompt(
    app_handle: AppHandle,
    payload: String,
) -> Result<String, String> {
    // 生成请求 id 并创建密码对话框窗口
    let req_id = ulid::Ulid::new().to_string();

    let (tx, rx) = channel::<PasswordMsg>();
    {
        let mut map = prompt_senders().lock().map_err(|e| e.to_string())?;
        map.insert(req_id.clone(), tx);
    }

    let label = format!("pwd_prompt_{}", req_id);
    // 使用 about:blank + initialization_script 渲染受控页面，避免路径解析问题
    let url = WebviewUrl::External("about:blank".parse().unwrap());
    let script = format!(
        r#"
        (function() {{
          const reqId = {req_id_json};
          const h = String.raw;
          document.title = '输入密码';
          const style = `html, body {{ height:100%; margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial; background:#0f172a; color:#e2e8f0; }}
            .wrap {{ display:flex; height:100%; align-items:center; justify-content:center; }}
            .box {{ width:360px; background:#0b1220; border:1px solid #334155; border-radius:10px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.3); }}
            .title {{ font-size:16px; font-weight:700; margin-bottom:12px; }}
            .row {{ margin:10px 0; }}
            input {{ width:100%; padding:10px; border-radius:8px; border:1px solid #334155; background:#111827; color:#e2e8f0; outline:none; }}
            .actions {{ display:flex; gap:12px; justify-content:flex-end; margin-top:12px; }}
            button {{ cursor:pointer; padding:8px 18px; border-radius:999px; border:1px solid #475569; background:#1f2937; color:#e2e8f0; }}
            button.primary {{ background: linear-gradient(135deg, #22d3ee, #a78bfa); color:#0b1220; font-weight:700; }}`;
          document.body.innerHTML = h`<style>${{style}}</style>
            <div class="wrap">
              <div class="box">
                <div class="title">请输入当前 DID 密码</div>
                <div class="row">
                  <input id="pwd" type="password" placeholder="密码" autofocus />
                </div>
                <div class="actions">
                  <button id="cancel">取消</button>
                  <button id="ok" class="primary">确定</button>
                </div>
              </div>
            </div>`;
          function ensureInvoke() {{
            const g = window;
            if (g.__TAURI__ && g.__TAURI__.core && typeof g.__TAURI__.core.invoke === 'function') return g.__TAURI__.core.invoke;
            if (g.__TAURI_INTERNALS__ && typeof g.__TAURI_INTERNALS__.invoke === 'function') return g.__TAURI_INTERNALS__.invoke;
            return null;
          }}
          const inv = ensureInvoke();
          const pwd = document.getElementById('pwd');
          const ok = document.getElementById('ok');
          const cancel = document.getElementById('cancel');
          ok.addEventListener('click', async () => {{
            if (!inv) return alert('Tauri invoke API 不可用');
            const password = pwd.value || '';
            await inv('submit_password', {{ reqId: reqId, password, cancel: false }});
          }});
          cancel.addEventListener('click', async () => {{
            if (!inv) return alert('Tauri invoke API 不可用');
            await inv('submit_password', {{ reqId: reqId, cancel: true }});
          }});
          pwd.addEventListener('keydown', (e) => {{ if (e.key === 'Enter') ok.click(); }});
        }})();
        "#,
        req_id_json = serde_json::to_string(&req_id).unwrap()
    );

    WebviewWindowBuilder::new(&app_handle, label.clone(), url)
        .title("输入密码")
        .inner_size(420.0, 220.0)
        .resizable(false)
        .initialization_script(script)
        .build()
        .map_err(|e| e.to_string())?;

    // 等待密码输入（阻塞当前命令调用，直到用户提交/取消）
    let msg = rx.recv().map_err(|e| e.to_string())?;
    match msg {
        PasswordMsg::Cancel => Err("user_cancelled".to_string()),
        PasswordMsg::Ok(password) => {
            // 重用已有的签名逻辑
            sign_with_active_did(app_handle, password, payload)
        }
    }
}
*/

#[cfg(test)]
mod tests {
    use super::domain::DEFAULT_BTC_ADDRESS_TYPE;
    use super::*;
    use tauri::test::mock_app;

    #[test]
    fn test_generate_mnemonic() {
        let words = generate_mnemonic().unwrap();
        assert_eq!(words.len(), 12);
    }

    #[test]
    fn test_eth_address_derivation_and_eip55() {
        let mnemonic = Mnemonic::parse_in(
            Language::English,
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        )
        .unwrap();
        let ctx = SeedCtx::new(&mnemonic, "").unwrap();
        let address = derive_eth_address(&ctx, 0).unwrap();
        assert_eq!(address, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    }

    #[test]
    fn test_create_did_flow() {
        let app = mock_app()
            .plugin(tauri_plugin_store::Builder::default().build())
            .build();
        let app_handle = app.handle();

        let nickname = "test_user".to_string();
        let password = "password123".to_string();
        let mnemonic_words = vec![
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "about",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let did_info = create_did(
            app_handle.clone(),
            nickname.clone(),
            password.clone(),
            mnemonic_words,
        )
        .unwrap();

        assert_eq!(did_info.nickname, nickname);
        assert!(did_info.btc_addresses.is_empty());
        assert!(did_info.eth_addresses.is_empty());
        assert_eq!(did_info.bucky_wallets.len(), 1);
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
        let dids_after = list_dids(app_handle).unwrap();
        assert!(dids_after.is_empty());
    }

    #[test]
    fn test_extend_wallets() {
        let app = mock_app()
            .plugin(tauri_plugin_store::Builder::default().build())
            .build();
        let app_handle = app.handle();

        let nickname = "extend_user".to_string();
        let password = "password123".to_string();
        let mnemonic_words = vec![
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "about",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let did_info = create_did(
            app_handle.clone(),
            nickname.clone(),
            password.clone(),
            mnemonic_words,
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
        assert_eq!(extended_eth.eth_addresses.len(), 1);

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
        assert_eq!(listed[0].eth_addresses.len(), 1);
        assert_eq!(listed[0].bucky_wallets.len(), 2);

        delete_wallet(app_handle.clone(), password, Some(did_info.id)).unwrap();
        let after_delete = list_dids(app_handle).unwrap();
        assert!(after_delete.is_empty());
    }
}
