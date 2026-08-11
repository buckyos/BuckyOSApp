use bip39::Mnemonic;
use bitcoin::bip32::{DerivationPath, Xpriv, Xpub};
use bitcoin::key::Secp256k1;
use bitcoin::{Address, PublicKey};

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
