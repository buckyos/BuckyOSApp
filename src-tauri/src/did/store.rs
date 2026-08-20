use serde::{Deserialize, Serialize};
use std::io::ErrorKind;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::{Error as StoreError, Store, StoreExt};
use ulid::Ulid;

use super::domain::{BtcAddress, DidInfo, SnStatusInfo, WalletCollection};
use crate::error::{CommandErrors, CommandResult};

// 固定使用主网，后续可以抽象为配置项。
pub const NETWORK: bitcoin::Network = bitcoin::Network::Bitcoin;
pub const STORE_KEY: &str = "vault";
const DID_PREFIX: &str = "did:bk:1:";
const VAULT_VERSION: u32 = 2;
const SN_USERNAME_MIGRATION_VERSION: u32 = 2;

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
    /// Public BNS owner document. The mnemonic remains encrypted in `seed`;
    /// this document intentionally stays as plain JSON for exact recovery.
    #[serde(default)]
    pub owner_document: Option<String>,
    #[serde(default)]
    pub sn_status: Option<SnStatusInfo>,
}

impl StoredDid {
    fn recover_sn_username(&self) -> Option<String> {
        let owner_document = self.owner_document.as_ref()?;
        let value: serde_json::Value = serde_json::from_str(owner_document).ok()?;
        let name = value.get("name")?.as_str()?.trim();
        let normalized_name = name.to_ascii_lowercase();
        let owner_did = value.get("id")?.as_str()?.trim();

        if name.is_empty()
            || name != normalized_name
            || owner_did != format!("did:bns:{normalized_name}")
        {
            return None;
        }

        Some(normalized_name)
    }

    fn migrate_legacy_sn_status(&mut self) -> bool {
        let has_username = self
            .sn_status
            .as_ref()
            .and_then(|status| status.username.as_deref())
            .is_some_and(|username| !username.trim().is_empty());
        if has_username {
            return false;
        }

        let Some(username) = self.recover_sn_username() else {
            return false;
        };

        match &mut self.sn_status {
            Some(status) => status.username = Some(username),
            None => {
                self.sn_status = Some(SnStatusInfo {
                    username: Some(username),
                    zone_config: None,
                });
            }
        }
        true
    }

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
            owner_document: self
                .owner_document
                .as_ref()
                .and_then(|json| serde_json::from_str(json).ok()),
            sn_status: self.sn_status.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct VaultStore {
    version: u32,
    pub active_did: Option<String>,
    #[serde(default)]
    pub dids: Vec<StoredDid>,
}

impl VaultStore {
    fn migrate_to_current(&mut self) -> bool {
        let mut changed = false;
        if self.version < SN_USERNAME_MIGRATION_VERSION {
            changed = self.migrate_legacy_sn_statuses();
        }
        if self.version < VAULT_VERSION {
            self.version = VAULT_VERSION;
            changed = true;
        }
        changed
    }

    fn migrate_legacy_sn_statuses(&mut self) -> bool {
        self.dids.iter_mut().fold(false, |migrated, did| {
            did.migrate_legacy_sn_status() || migrated
        })
    }

    #[cfg(test)]
    pub(crate) fn mark_legacy_for_test(&mut self) {
        self.version = SN_USERNAME_MIGRATION_VERSION - 1;
    }
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

pub type AppStore<R> = std::sync::Arc<Store<R>>;

pub fn open_store<R: Runtime>(app_handle: &AppHandle<R>) -> CommandResult<AppStore<R>> {
    app_handle
        .store("wallet.store")
        .map_err(|e| CommandErrors::store_unavailable(e.to_string()))
}

pub fn load_vault<R: Runtime>(store: &AppStore<R>) -> CommandResult<VaultStore> {
    match store.reload() {
        Ok(_) => {}
        Err(StoreError::Io(io_err)) if io_err.kind() == ErrorKind::NotFound => {
            return Ok(VaultStore::default());
        }
        Err(err) => return Err(CommandErrors::store_unavailable(err.to_string())),
    }

    let mut vault = match store.get(STORE_KEY) {
        Some(value) => serde_json::from_value::<VaultStore>(value)
            .map_err(|e| CommandErrors::vault_corrupted(e.to_string())),
        None => Ok(VaultStore::default()),
    }?;

    if vault.migrate_to_current() {
        save_vault(store, &vault)?;
    }

    Ok(vault)
}

pub fn save_vault<R: Runtime>(store: &AppStore<R>, vault: &VaultStore) -> CommandResult<()> {
    let value =
        serde_json::to_value(vault).map_err(|e| CommandErrors::vault_corrupted(e.to_string()))?;
    store.set(STORE_KEY.to_string(), value);
    store
        .save()
        .map_err(|e| CommandErrors::store_unavailable(e.to_string()))
}
