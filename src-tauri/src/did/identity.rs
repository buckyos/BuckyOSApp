use bip39::Mnemonic;
use name_lib::{derive_bucky_key_from_mnemonic, derive_evm_key_from_mnemonic};

use super::derive::{derive_btc_address, SeedCtx};
use super::domain::{BtcAddress, BtcAddressType, BuckyIdentity, ChainAddress, WalletCollection};
use crate::error::{CommandErrors, CommandResult};

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
) -> CommandResult<DerivedDid> {
    let ctx = SeedCtx::new(mnemonic, passphrase)?;
    let mut result = DerivedDid::default();

    let need_mnemonic_phrase = plan
        .wallets
        .iter()
        .any(|wallet| matches!(wallet.kind, WalletKind::Bucky | WalletKind::Eth));
    let mnemonic_phrase = if need_mnemonic_phrase {
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
                    let derived = derive_btc_address(&ctx, *address_type, *index)?.to_string();
                    result.btc.push(BtcAddress {
                        address_type: *address_type,
                        index: *index,
                        address: derived,
                    });
                }
            }
            WalletKind::Eth => {
                let phrase = mnemonic_phrase
                    .as_ref()
                    .expect("mnemonic phrase required for evm derivation");
                for index in &wallet.indices {
                    let derived =
                        derive_evm_key_from_mnemonic(phrase.as_str(), passphrase_opt, *index)
                            .map_err(|e| CommandErrors::crypto_failed(e.to_string()))?;
                    result.eth.push(ChainAddress {
                        index: *index,
                        address: derived.address,
                    });
                }
            }
            WalletKind::Bucky => {
                let phrase = mnemonic_phrase
                    .as_ref()
                    .expect("mnemonic phrase required for bucky derivation");
                for index in &wallet.indices {
                    let derived =
                        derive_bucky_key_from_mnemonic(phrase.as_str(), passphrase_opt, *index)
                            .map_err(|e| CommandErrors::crypto_failed(e.to_string()))?;
                    result.bucky.push(BuckyIdentity {
                        index: *index,
                        did: derived.did,
                        public_key: derived.public_jwk,
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
) -> CommandResult<WalletCollection> {
    let plan = DidDerivationPlan::from_requests(requests, existing);
    if plan.is_empty() {
        return Ok(WalletCollection::default());
    }
    let derived = derive_did_from_mnemonic(mnemonic, passphrase, &plan)?;
    Ok(derived.into_wallets())
}
