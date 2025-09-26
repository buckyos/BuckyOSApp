use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Wry};
use tauri_plugin_store::{Store, StoreExt};
use ulid::Ulid;

// 固定使用主网，后续需要时可以抽象为配置项。
pub const NETWORK: bitcoin::Network = bitcoin::Network::Bitcoin;
pub const STORE_KEY: &str = "vault";
const DID_PREFIX: &str = "did:bk:1:";
const VAULT_VERSION: u32 = 1;

pub fn new_did_id() -> String {
    format!("{}{}", DID_PREFIX, Ulid::new())
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
#[serde(rename_all = "snake_case")]
pub enum BtcAddressType {
    Legacy,
    NestedSegwit,
    NativeSegwit,
    Taproot,
}

impl BtcAddressType {
    pub fn purpose(self) -> u32 {
        match self {
            Self::Legacy => 44,
            Self::NestedSegwit => 49,
            Self::NativeSegwit => 84,
            Self::Taproot => 86,
        }
    }
}

pub const DEFAULT_BTC_ADDRESS_TYPE: BtcAddressType = BtcAddressType::NativeSegwit;

fn default_btc_address_type() -> BtcAddressType {
    DEFAULT_BTC_ADDRESS_TYPE
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BtcAddress {
    #[serde(default = "default_btc_address_type")]
    pub address_type: BtcAddressType,
    pub index: u32,
    pub address: String,
}

impl Default for BtcAddress {
    fn default() -> Self {
        Self {
            address_type: DEFAULT_BTC_ADDRESS_TYPE,
            index: 0,
            address: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChainAddress {
    pub index: u32,
    pub address: String,
}

impl Default for ChainAddress {
    fn default() -> Self {
        Self {
            index: 0,
            address: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DidInfo {
    pub id: String,
    pub nickname: String,
    pub btc_addresses: Vec<BtcAddress>,
    pub eth_addresses: Vec<ChainAddress>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EncryptedSeed {
    pub kdf_iter: u32,
    pub kdf_salt_hex: String,
    pub cipher_nonce_hex: String,
    pub cipher_hex: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AccountSeries<T> {
    next_index: u32,
    #[serde(default)]
    pub entries: Vec<T>,
}

impl<T> AccountSeries<T> {
    pub fn with_entry(entry: T) -> Self {
        Self {
            next_index: 1,
            entries: vec![entry],
        }
    }

    pub fn next_index(&self) -> u32 {
        self.next_index
    }

    pub fn bump_with(&mut self, entry: T) {
        self.entries.push(entry);
        self.next_index = self
            .next_index
            .checked_add(1)
            .expect("account index overflow");
    }
}

impl<T> Default for AccountSeries<T> {
    fn default() -> Self {
        Self {
            next_index: 0,
            entries: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AccountBook {
    #[serde(default)]
    pub btc: HashMap<BtcAddressType, AccountSeries<BtcAddress>>,
    #[serde(default)]
    pub eth: AccountSeries<ChainAddress>,
}

impl AccountBook {
    pub fn btc_series_mut(&mut self, addr_type: BtcAddressType) -> &mut AccountSeries<BtcAddress> {
        self.btc
            .entry(addr_type)
            .or_insert_with(AccountSeries::default)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DidRecord {
    pub id: String,
    pub nickname: String,
    pub seed: EncryptedSeed,
    pub accounts: AccountBook,
}

impl DidRecord {
    pub fn to_info(&self) -> DidInfo {
        let mut btc_addresses: Vec<BtcAddress> = self
            .accounts
            .btc
            .values()
            .flat_map(|series| series.entries.clone())
            .collect();
        btc_addresses
            .sort_by(|a, b| (a.address_type as u8, a.index).cmp(&(b.address_type as u8, b.index)));

        let mut eth_addresses = self.accounts.eth.entries.clone();
        eth_addresses.sort_by_key(|entry| entry.index);

        DidInfo {
            id: self.id.clone(),
            nickname: self.nickname.clone(),
            btc_addresses,
            eth_addresses,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultStore {
    version: u32,
    pub active_did: Option<String>,
    #[serde(default)]
    pub dids: Vec<DidRecord>,
}

impl Default for VaultStore {
    fn default() -> Self {
        Self {
            version: VAULT_VERSION,
            active_did: None,
            dids: Vec::new(),
        }
    }
}

pub type AppStore = Arc<Store<Wry>>;

pub fn open_store(app_handle: &AppHandle) -> Result<AppStore, String> {
    app_handle.store("wallet.store").map_err(|e| e.to_string())
}

pub fn load_vault(store: &AppStore) -> Result<VaultStore, String> {
    store.reload().map_err(|e| e.to_string())?;
    match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value::<VaultStore>(value).map_err(|e| e.to_string()),
        None => Ok(VaultStore::default()),
    }
}

pub fn save_vault(store: &AppStore, vault: &VaultStore) -> Result<(), String> {
    let value = serde_json::to_value(vault).map_err(|e| e.to_string())?;
    store.set(STORE_KEY.to_string(), value);
    store.save().map_err(|e| e.to_string())
}
