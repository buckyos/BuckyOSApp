use bip39::{Language, Mnemonic};
use rand::{rngs::OsRng, RngCore};
use tauri::AppHandle;

use super::crypto::{decrypt_mnemonic, encrypt_mnemonic};
use super::derive::{derive_btc_address, derive_eth_address, SeedCtx};
use super::store::{
    load_vault, new_did_id, open_store, save_vault, AccountBook, AccountSeries, BtcAddress,
    BuckyDidInfo, ChainAddress, DidInfo, DidRecord, DEFAULT_BTC_ADDRESS_TYPE,
};
use name_lib::{generate_ed25519_key_pair_from_mnemonic, get_device_did_from_ed25519_jwk};

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

    let ctx = SeedCtx::new(&mnemonic, "").map_err(|e| e.to_string())?;

    let btc_address = derive_btc_address(&ctx, DEFAULT_BTC_ADDRESS_TYPE, 0)
        .map_err(|e| e.to_string())?
        .to_string();

    let eth_address = derive_eth_address(&ctx, 0).map_err(|e| e.to_string())?;

    let btc_entry = BtcAddress {
        address_type: DEFAULT_BTC_ADDRESS_TYPE,
        index: 0,
        address: btc_address,
    };
    let eth_entry = ChainAddress {
        index: 0,
        address: eth_address,
    };

    let mut accounts = AccountBook::default();
    accounts.btc.insert(
        DEFAULT_BTC_ADDRESS_TYPE,
        AccountSeries::with_entry(btc_entry.clone()),
    );
    accounts.eth = AccountSeries::with_entry(eth_entry.clone());

    let encrypted_seed = encrypt_mnemonic(&password, &mnemonic).map_err(|e| e.to_string())?;

    let (_pem, public_jwk) =
        generate_ed25519_key_pair_from_mnemonic(mnemonic_phrase.as_str(), None, 0)
            .map_err(|e| e.to_string())?;
    let buckyos_identity = Some(BuckyDidInfo {
        index: 0,
        did: get_device_did_from_ed25519_jwk(&public_jwk).map_err(|e| e.to_string())?,
        public_key: public_jwk,
    });

    let store = open_store(&app_handle)?;
    let mut vault = load_vault(&store)?;

    if vault
        .dids
        .iter()
        .any(|did| did.nickname.eq_ignore_ascii_case(&nickname))
    {
        return Err("nickname_already_exists".to_string());
    }

    let record = DidRecord {
        id: new_did_id(),
        nickname,
        seed: encrypted_seed,
        accounts,
        buckyos_identity,
    };

    vault.active_did = Some(record.id.clone());
    vault.dids.push(record.clone());

    save_vault(&store, &vault)?;

    Ok(record.to_info())
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
    Ok(vault.dids.iter().map(DidRecord::to_info).collect())
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
            .map(DidRecord::to_info)
    }))
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

    let phrase = decrypt_mnemonic(&password, &record.seed).map_err(|e| e.to_string())?;
    let mnemonic = Mnemonic::parse_in(Language::English, &phrase).map_err(|e| e.to_string())?;
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

#[cfg(test)]
mod tests {
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
        assert_eq!(did_info.btc_addresses.len(), 1);
        assert_eq!(did_info.eth_addresses.len(), 1);
        assert_eq!(did_info.btc_addresses[0].index, 0);
        assert_eq!(
            did_info.btc_addresses[0].address_type,
            DEFAULT_BTC_ADDRESS_TYPE
        );
        assert_eq!(did_info.eth_addresses[0].index, 0);
        let identity = did_info
            .buckyos_identity
            .as_ref()
            .expect("buckyos identity present");
        assert_eq!(identity.index, 0);
        assert!(
            identity.did.starts_with("did:dev:"),
            "unexpected DID: {}",
            identity.did
        );

        let dids = list_dids(app_handle.clone()).unwrap();
        assert_eq!(dids.len(), 1);
        assert_eq!(dids[0].id, did_info.id);
        assert!(dids[0].buckyos_identity.is_some());

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
}
