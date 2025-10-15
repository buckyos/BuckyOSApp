use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BtcAddress {
    #[serde(default = "default_btc_address_type")]
    pub address_type: BtcAddressType,
    pub index: u32,
    pub address: String,
}

fn default_btc_address_type() -> BtcAddressType {
    DEFAULT_BTC_ADDRESS_TYPE
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChainAddress {
    pub index: u32,
    pub address: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BuckyIdentity {
    pub index: u32,
    pub did: String,
    pub public_key: Value,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AddressSeries<T> {
    pub entries: Vec<T>,
    pub next_index: u32,
}

impl<T> AddressSeries<T> {
    pub fn new(entries: Vec<T>, next_index: u32) -> Self {
        Self {
            entries,
            next_index,
        }
    }

    pub fn empty() -> Self {
        Self {
            entries: Vec::new(),
            next_index: 0,
        }
    }

    pub fn next_index(&self) -> u32 {
        self.next_index
    }
}

impl<T> Default for AddressSeries<T> {
    fn default() -> Self {
        Self::empty()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct WalletCollection {
    #[serde(default)]
    pub btc: HashMap<BtcAddressType, AddressSeries<BtcAddress>>,
    #[serde(default)]
    pub eth: AddressSeries<ChainAddress>,
    #[serde(default)]
    pub bucky: AddressSeries<BuckyIdentity>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DidInfo {
    pub id: String,
    pub nickname: String,
    pub btc_addresses: Vec<BtcAddress>,
    pub eth_addresses: Vec<ChainAddress>,
    pub bucky_wallets: Vec<BuckyIdentity>,
}

pub fn address_series_from_sorted<T, F>(entries: Vec<T>, index_lookup: F) -> AddressSeries<T>
where
    F: Fn(&T) -> u32,
{
    let next_index = entries
        .iter()
        .map(|entry| index_lookup(entry).saturating_add(1))
        .max()
        .unwrap_or(0);
    AddressSeries::new(entries, next_index)
}
