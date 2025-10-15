use bip39::Mnemonic;
use name_lib::{generate_ed25519_key_pair_from_mnemonic, get_device_did_from_ed25519_jwk};
use std::collections::HashMap;

use super::derive::{derive_btc_address, derive_eth_address, SeedCtx};
use super::domain::{
    address_series_from_sorted, BtcAddress, BtcAddressType, BuckyIdentity, ChainAddress,
    WalletCollection, DEFAULT_BTC_ADDRESS_TYPE,
};

#[derive(Clone, Debug)]
pub enum WalletKind {
    Btc { address_type: BtcAddressType },
    Eth,
    Bucky,
}

#[derive(Clone, Debug)]
pub struct WalletPlan {
    pub kind: WalletKind,
    pub indices: Vec<u32>,
}

impl WalletPlan {
    pub fn btc(address_type: BtcAddressType, indices: Vec<u32>) -> Self {
        Self {
            kind: WalletKind::Btc { address_type },
            indices,
        }
    }

    pub fn eth(indices: Vec<u32>) -> Self {
        Self {
            kind: WalletKind::Eth,
            indices,
        }
    }

    pub fn bucky(indices: Vec<u32>) -> Self {
        Self {
            kind: WalletKind::Bucky,
            indices,
        }
    }
}

#[derive(Clone, Debug)]
pub struct DidDerivationPlan {
    pub wallets: Vec<WalletPlan>,
}

impl DidDerivationPlan {
    pub fn new() -> Self {
        Self {
            wallets: Vec::new(),
        }
    }

    pub fn with_wallet(wallet: WalletPlan) -> Self {
        Self {
            wallets: vec![wallet],
        }
    }

    pub fn push_wallet(&mut self, wallet: WalletPlan) {
        self.wallets.push(wallet);
    }
}

impl Default for DidDerivationPlan {
    fn default() -> Self {
        Self {
            wallets: vec![
                WalletPlan::btc(DEFAULT_BTC_ADDRESS_TYPE, vec![0]),
                WalletPlan::eth(vec![0]),
                WalletPlan::bucky(vec![0]),
            ],
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct DerivedDid {
    pub btc: Vec<BtcAddress>,
    pub eth: Vec<ChainAddress>,
    pub bucky: Vec<BuckyIdentity>,
}

pub fn derive_did_from_mnemonic(
    mnemonic: &Mnemonic,
    passphrase: &str,
    plan: &DidDerivationPlan,
) -> Result<DerivedDid, String> {
    let ctx = SeedCtx::new(mnemonic, passphrase).map_err(|e| e.to_string())?;

    let mut result = DerivedDid::default();

    for wallet in &plan.wallets {
        match &wallet.kind {
            WalletKind::Btc { address_type } => {
                for index in &wallet.indices {
                    let derived = derive_btc_address(&ctx, *address_type, *index)
                        .map_err(|e| e.to_string())?
                        .to_string();
                    result.btc.push(BtcAddress {
                        address_type: *address_type,
                        index: *index,
                        address: derived,
                    });
                }
            }
            WalletKind::Eth => {
                for index in &wallet.indices {
                    let derived = derive_eth_address(&ctx, *index).map_err(|e| e.to_string())?;
                    result.eth.push(ChainAddress {
                        index: *index,
                        address: derived,
                    });
                }
            }
            WalletKind::Bucky => {
                let mnemonic_phrase = mnemonic.to_string();
                let passphrase_opt = if passphrase.is_empty() {
                    None
                } else {
                    Some(passphrase)
                };
                for index in &wallet.indices {
                    let (_pem, public_jwk) = generate_ed25519_key_pair_from_mnemonic(
                        mnemonic_phrase.as_str(),
                        passphrase_opt,
                        *index,
                    )
                    .map_err(|e| e.to_string())?;
                    let did =
                        get_device_did_from_ed25519_jwk(&public_jwk).map_err(|e| e.to_string())?;
                    result.bucky.push(BuckyIdentity {
                        index: *index,
                        did,
                        public_key: public_jwk.clone(),
                    });
                }
            }
        }
    }

    result
        .btc
        .sort_by(|a, b| (a.address_type as u8, a.index).cmp(&(b.address_type as u8, b.index)));
    result.eth.sort_by(|a, b| a.index.cmp(&b.index));
    result.bucky.sort_by(|a, b| a.index.cmp(&b.index));

    Ok(result)
}

impl DerivedDid {
    pub fn into_wallets(self) -> WalletCollection {
        let mut wallets = WalletCollection::default();

        let mut btc_groups: HashMap<BtcAddressType, Vec<BtcAddress>> = HashMap::new();
        for entry in self.btc {
            btc_groups
                .entry(entry.address_type)
                .or_default()
                .push(entry);
        }

        for (addr_type, mut entries) in btc_groups {
            entries.sort_by_key(|entry| entry.index);
            let series = address_series_from_sorted(entries, |entry| entry.index);
            wallets.btc.insert(addr_type, series);
        }

        let mut eth_entries = self.eth;
        eth_entries.sort_by_key(|entry| entry.index);
        wallets.eth = address_series_from_sorted(eth_entries, |entry| entry.index);

        let mut bucky_entries = self.bucky;
        bucky_entries.sort_by_key(|entry| entry.index);
        wallets.bucky = address_series_from_sorted(bucky_entries, |entry| entry.index);

        wallets
    }
}

pub fn derive_wallets_from_mnemonic(
    mnemonic: &Mnemonic,
    passphrase: &str,
    plan: &DidDerivationPlan,
) -> Result<WalletCollection, String> {
    let derived = derive_did_from_mnemonic(mnemonic, passphrase, plan)?;
    Ok(derived.into_wallets())
}
