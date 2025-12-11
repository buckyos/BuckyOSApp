use bip39::Mnemonic;
use bitcoin::bip32::{DerivationPath, Xpriv, Xpub};
use bitcoin::key::Secp256k1;
use bitcoin::{Address, PublicKey};
use sha3::{Digest, Keccak256};

use super::domain::BtcAddressType;
use super::store::NETWORK;
use crate::error::{CommandErrors, CommandResult};

pub struct SeedCtx {
    secp: Secp256k1<bitcoin::secp256k1::All>,
    master_xprv: Xpriv,
}

impl SeedCtx {
    pub fn new(mnemonic: &Mnemonic, passphrase: &str) -> CommandResult<Self> {
        let seed_bytes = mnemonic.to_seed(passphrase);
        let secp = Secp256k1::new();
        let master_xprv = Xpriv::new_master(NETWORK, &seed_bytes).map_err(|e| {
            CommandErrors::key_derivation_failed(format!("master key derivation failed: {e}"))
        })?;
        Ok(Self { secp, master_xprv })
    }

    pub fn secp(&self) -> &Secp256k1<bitcoin::secp256k1::All> {
        &self.secp
    }
}

pub fn derive_btc_address(
    ctx: &SeedCtx,
    address_type: BtcAddressType,
    index: u32,
) -> CommandResult<Address> {
    let purpose = address_type.purpose();
    let path: DerivationPath = format!("m/{}'/0'/0'/0/{index}", purpose)
        .parse()
        .expect("static derivation path");
    let child_prv = ctx
        .master_xprv
        .derive_priv(ctx.secp(), &path)
        .map_err(|e| {
            CommandErrors::key_derivation_failed(format!("btc derive_priv failed: {e}"))
        })?;
    let child_pub = Xpub::from_priv(ctx.secp(), &child_prv);
    let secp_pk = child_pub.public_key;
    let pubkey = PublicKey::new(secp_pk);
    let address = match address_type {
        BtcAddressType::Legacy => Address::p2pkh(&pubkey, NETWORK),
        BtcAddressType::NestedSegwit => Address::p2shwpkh(&pubkey, NETWORK)
            .map_err(|e| CommandErrors::key_derivation_failed(format!("p2shwpkh failed: {e}")))?,
        BtcAddressType::NativeSegwit => Address::p2wpkh(&pubkey, NETWORK)
            .map_err(|e| CommandErrors::key_derivation_failed(format!("p2wpkh failed: {e}")))?,
        BtcAddressType::Taproot => {
            let (xonly, _parity) = pubkey.inner.x_only_public_key();
            Address::p2tr(ctx.secp(), xonly, None, NETWORK)
        }
    };
    Ok(address)
}

pub fn derive_eth_address(ctx: &SeedCtx, index: u32) -> CommandResult<String> {
    // 使用常见路径：m/44'/60'/0'/0/{index}
    let path: DerivationPath = format!("m/44'/60'/0'/0/{index}").parse().unwrap();
    let child_prv = ctx
        .master_xprv
        .derive_priv(ctx.secp(), &path)
        .map_err(|e| {
            CommandErrors::key_derivation_failed(format!("eth derive_priv failed: {e}"))
        })?;
    let xpub = Xpub::from_priv(ctx.secp(), &child_prv);
    let secp_pk = xpub.public_key;
    let uncompressed = secp_pk.serialize_uncompressed();
    let hash = Keccak256::digest(&uncompressed[1..]);
    let mut addr20 = [0u8; 20];
    addr20.copy_from_slice(&hash[12..]);
    Ok(to_eip55(&addr20))
}

fn to_eip55(addr20: &[u8; 20]) -> String {
    let lower_hex = hex::encode(addr20);
    let hash = Keccak256::digest(lower_hex.as_bytes());
    let mut out = String::with_capacity(42);
    out.push_str("0x");
    for (i, ch) in lower_hex.chars().enumerate() {
        let nibble = (hash[i / 2] >> (4 * (1 - (i % 2)))) & 0x0f;
        if ch.is_ascii_hexdigit() && ch.is_ascii_lowercase() && nibble > 7 {
            out.push(ch.to_ascii_uppercase());
        } else {
            out.push(ch);
        }
    }
    out
}
