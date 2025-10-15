use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Wry};
use tauri_plugin_store::{Store, StoreExt};
use ulid::Ulid;

use super::domain::{BtcAddress, BuckyIdentity, ChainAddress, DidInfo, WalletCollection};

// 固定使用主网，后续可以抽象为配置项。
pub const NETWORK: bitcoin::Network = bitcoin::Network::Bitcoin;
pub const STORE_KEY: &str = "vault";
const DID_PREFIX: &str = "did:bk:1:";
const VAULT_VERSION: u32 = 1;

pub fn new_did_id() -> String {
    format!("{}{}", DID_PREFIX, Ulid::new())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EncryptedSeed {
    pub kdf_iter: u32,
    pub kdf_salt_hex: String,
    pub cipher_nonce_hex: String,
    pub cipher_hex: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct StoredDid {
    pub id: String,
    pub nickname: String,
    pub seed: EncryptedSeed,
    #[serde(default)]
    pub wallets: WalletCollection,
}

impl StoredDid {
    pub fn to_info(&self) -> DidInfo {
        let mut btc_addresses: Vec<BtcAddress> = self
            .wallets
            .btc
            .values()
            .flat_map(|series| series.entries.clone())
            .collect();
        btc_addresses
            .sort_by(|a, b| (a.address_type as u8, a.index).cmp(&(b.address_type as u8, b.index)));

        let mut eth_addresses = self.wallets.eth.entries.clone();
        eth_addresses.sort_by_key(|entry| entry.index);

        let mut bucky_wallets = self.wallets.bucky.entries.clone();
        bucky_wallets.sort_by_key(|entry| entry.index);

        DidInfo {
            id: self.id.clone(),
            nickname: self.nickname.clone(),
            btc_addresses,
            eth_addresses,
            bucky_wallets,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct VaultStore {
    version: u32,
    pub active_did: Option<String>,
    #[serde(default)]
    pub dids: Vec<StoredDid>,
}

impl VaultStore {
    pub fn ensure_version(mut self) -> Self {
        self.version = VAULT_VERSION;
        self
    }
}

pub type AppStore = std::sync::Arc<Store<Wry>>;

pub fn open_store(app_handle: &AppHandle) -> Result<AppStore, String> {
    app_handle.store("wallet.store").map_err(|e| e.to_string())
}

pub fn load_vault(store: &AppStore) -> Result<VaultStore, String> {
    match store.reload() {
        Ok(_) => {}
        Err(err) => {
            let msg = err.to_string();
            if msg.contains("No such file or directory") || msg.contains("os error 2") {
                return Ok(VaultStore::default());
            }
            return Err(msg);
        }
    }

    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value::<VaultStore>(value)
            .map(VaultStore::ensure_version)
            .map_err(|e| e.to_string()),
        None => Ok(VaultStore::default()),
    }
}

pub fn save_vault(store: &AppStore, vault: &VaultStore) -> Result<(), String> {
    let value = serde_json::to_value(vault).map_err(|e| e.to_string())?;
    store.set(STORE_KEY.to_string(), value);
    store.save().map_err(|e| e.to_string())
}
