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

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SnStatusInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zone_config: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AddressSeries<T> {
    pub entries: Vec<T>,
    pub next_index: u32,
}

impl<T> AddressSeries<T> {
    pub fn empty() -> Self {
        Self {
            entries: Vec::new(),
            next_index: 0,
        }
    }

    pub fn next_index(&self) -> u32 {
        self.next_index
    }

    pub fn push_with_index(&mut self, index: u32, entry: T) {
        if self.entries.is_empty() && self.next_index == 0 {
            self.next_index = index;
        }

        debug_assert!(
            index >= self.next_index,
            "non-monotonic address index detected: {index} < {}",
            self.next_index
        );

        if index > self.next_index {
            self.next_index = index;
        }

        self.entries.push(entry);
        self.next_index = index
            .checked_add(1)
            .expect("address index overflow when pushing");
    }

    pub fn extend_from<F>(&mut self, entries: Vec<T>, index_lookup: F)
    where
        F: Fn(&T) -> u32,
    {
        for entry in entries {
            let index = index_lookup(&entry);
            self.push_with_index(index, entry);
        }
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

impl WalletCollection {
    pub fn merge(&mut self, other: WalletCollection) {
        for (addr_type, series) in other.btc {
            let target = self
                .btc
                .entry(addr_type)
                .or_insert_with(AddressSeries::default);
            target.extend_from(series.entries, |entry| entry.index);
        }

        self.eth.extend_from(other.eth.entries, |entry| entry.index);
        self.bucky
            .extend_from(other.bucky.entries, |entry| entry.index);
    }

    pub fn btc_series_mut(&mut self, addr_type: BtcAddressType) -> &mut AddressSeries<BtcAddress> {
        self.btc
            .entry(addr_type)
            .or_insert_with(AddressSeries::default)
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DidInfo {
    pub id: String,
    pub nickname: String,
    pub btc_addresses: Vec<BtcAddress>,
    pub eth_addresses: Vec<ChainAddress>,
    pub bucky_wallets: Vec<BuckyIdentity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sn_status: Option<SnStatusInfo>,
}
