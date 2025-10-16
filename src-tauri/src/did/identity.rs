use bip39::Mnemonic;
use name_lib::{generate_ed25519_key_pair_from_mnemonic, get_device_did_from_ed25519_jwk};

use super::derive::{derive_btc_address, derive_eth_address, SeedCtx};
use super::domain::{BtcAddress, BtcAddressType, BuckyIdentity, ChainAddress, WalletCollection};

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

#[derive(Clone, Debug)]
pub struct DidDerivationPlan {
    pub wallets: Vec<WalletPlan>,
}

impl DidDerivationPlan {
    pub fn is_empty(&self) -> bool {
        self.wallets.is_empty()
    }

    pub fn from_requests(requests: &[WalletRequest], existing: Option<&WalletCollection>) -> Self {
        let mut wallets = Vec::new();

        for request in requests {
            match request {
                WalletRequest::Btc {
                    address_type,
                    count,
                } => {
                    if *count == 0 {
                        continue;
                    }
                    let start = existing
                        .and_then(|collection| collection.btc.get(address_type))
                        .map(|series| series.next_index())
                        .unwrap_or(0);
                    let indices: Vec<u32> = (start..start.saturating_add(*count)).collect();
                    if !indices.is_empty() {
                        wallets.push(WalletPlan {
                            kind: WalletKind::Btc {
                                address_type: *address_type,
                            },
                            indices,
                        });
                    }
                }
                WalletRequest::Eth { count } => {
                    if *count == 0 {
                        continue;
                    }
                    let start = existing
                        .map(|collection| collection.eth.next_index())
                        .unwrap_or(0);
                    let indices: Vec<u32> = (start..start.saturating_add(*count)).collect();
                    if !indices.is_empty() {
                        wallets.push(WalletPlan {
                            kind: WalletKind::Eth,
                            indices,
                        });
                    }
                }
                WalletRequest::Bucky { count } => {
                    if *count == 0 {
                        continue;
                    }
                    let start = existing
                        .map(|collection| collection.bucky.next_index())
                        .unwrap_or(0);
                    let indices: Vec<u32> = (start..start.saturating_add(*count)).collect();
                    if !indices.is_empty() {
                        wallets.push(WalletPlan {
                            kind: WalletKind::Bucky,
                            indices,
                        });
                    }
                }
            }
        }

        Self { wallets }
    }

    pub fn default_requests() -> Vec<WalletRequest> {
        vec![WalletRequest::bucky(1)]
    }
}

#[derive(Clone, Debug)]
pub enum WalletRequest {
    Btc {
        address_type: BtcAddressType,
        count: u32,
    },
    Eth {
        count: u32,
    },
    Bucky {
        count: u32,
    },
}

impl WalletRequest {
    pub fn btc(address_type: BtcAddressType, count: u32) -> Self {
        Self::Btc {
            address_type,
            count,
        }
    }

    pub fn eth(count: u32) -> Self {
        Self::Eth { count }
    }

    pub fn bucky(count: u32) -> Self {
        Self::Bucky { count }
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

    let need_bucky = plan
        .wallets
        .iter()
        .any(|wallet| matches!(wallet.kind, WalletKind::Bucky));
    let mnemonic_phrase = if need_bucky {
        Some(mnemonic.to_string())
    } else {
        None
    };
    let passphrase_opt = if passphrase.is_empty() {
        None
    } else {
        Some(passphrase)
    };

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
                let phrase = mnemonic_phrase
                    .as_ref()
                    .expect("mnemonic phrase required for bucky derivation");
                for index in &wallet.indices {
                    let (_pem, public_jwk) = generate_ed25519_key_pair_from_mnemonic(
                        phrase.as_str(),
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

        for entry in self.btc {
            let index = entry.index;
            wallets
                .btc_series_mut(entry.address_type)
                .push_with_index(index, entry);
        }

        wallets.eth.extend_from(self.eth, |entry| entry.index);
        wallets.bucky.extend_from(self.bucky, |entry| entry.index);

        wallets
    }
}

pub fn derive_wallets_with_requests(
    mnemonic: &Mnemonic,
    passphrase: &str,
    requests: &[WalletRequest],
    existing: Option<&WalletCollection>,
) -> Result<WalletCollection, String> {
    let plan = DidDerivationPlan::from_requests(requests, existing);
    if plan.is_empty() {
        return Ok(WalletCollection::default());
    }
    let derived = derive_did_from_mnemonic(mnemonic, passphrase, &plan)?;
    Ok(derived.into_wallets())
}
