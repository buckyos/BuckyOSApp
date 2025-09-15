use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm, Nonce};
use anyhow::{anyhow, Result};
use bip39::{Language, Mnemonic};
use bitcoin::bip32::{DerivationPath, Xpriv, Xpub};
use bitcoin::key::Secp256k1;
use bitcoin::{Address, Network, PublicKey};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use sha3::{Digest, Keccak256};
use tauri::AppHandle;
use tauri_plugin_store::{StoreBuilder, StoreExt};

// Using a fixed network for simplicity, can be made configurable later.
const NETWORK: Network = Network::Bitcoin;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DidInfo {
    pub nickname: String,
    pub btc_address: String,
    pub eth_address: String,
}

#[derive(Serialize, Deserialize)]
struct WalletFile {
    version: u32,
    nickname: String,
    kdf_iter: u32,
    kdf_salt_hex: String,
    cipher_nonce_hex: String,
    cipher_hex: String,
}

struct SeedCtx {
    secp: Secp256k1<bitcoin::secp256k1::All>,
    master_xprv: Xpriv,
}

impl SeedCtx {
    fn new(mnemonic: &Mnemonic, passphrase: &str) -> Result<Self> {
        let seed_bytes = mnemonic.to_seed(passphrase);
        let secp = Secp256k1::new();
        let master_xprv = Xpriv::new_master(NETWORK, &seed_bytes)?;
        Ok(Self { secp, master_xprv })
    }
}

struct BtcWallet;

impl BtcWallet {
    fn derive_address(&self, ctx: &SeedCtx) -> Result<Address> {
        // Using a common derivation path for simplicity: m/84'/0'/0'/0/0
        let path: DerivationPath = "m/84'/0'/0'/0/0".parse().unwrap();
        let child_prv = ctx.master_xprv.derive_priv(&ctx.secp, &path)?;
        let child_pub = Xpub::from_priv(&ctx.secp, &child_prv);
        let pk = child_pub.public_key;
        let btc_pk = PublicKey::new(pk);
        Ok(Address::p2wpkh(&btc_pk, NETWORK)?)
    }
}

struct EthWallet;

impl EthWallet {
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

    fn derive_address(&self, ctx: &SeedCtx) -> Result<String> {
        // Using a common derivation path for simplicity: m/44'/60'/0'/0/0
        let path: DerivationPath = "m/44'/60'/0'/0/0".parse().unwrap();
        let child_prv = ctx.master_xprv.derive_priv(&ctx.secp, &path)?;
        let xpub = Xpub::from_priv(&ctx.secp, &child_prv);
        let secp_pk = xpub.public_key;
        let uncompressed = secp_pk.serialize_uncompressed();
        let hash = Keccak256::digest(&uncompressed[1..]);
        let mut addr20 = [0u8; 20];
        addr20.copy_from_slice(&hash[12..]);
        Ok(Self::to_eip55(&addr20))
    }
}

fn kdf(password: &str, salt: &[u8], iter: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iter, &mut key);
    key
}

fn encrypt_mnemonic(password: &str, mnemonic: &Mnemonic, nickname: &str) -> Result<WalletFile> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);

    let iter = 100_000u32;
    let key = kdf(password, &salt, iter);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("aes key");
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = mnemonic.to_string();
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| anyhow!("encrypt failed: {e}"))?;

    Ok(WalletFile {
        version: 1,
        nickname: nickname.to_string(),
        kdf_iter: iter,
        kdf_salt_hex: hex::encode(salt),
        cipher_nonce_hex: hex::encode(nonce_bytes),
        cipher_hex: hex::encode(ciphertext),
    })
}

#[tauri::command]
pub fn generate_mnemonic() -> Result<Vec<String>, String> {
    let mut entropy = [0u8; 16]; // 128 bits for 12 words
    OsRng.fill_bytes(&mut entropy);
    let mnemonic =
        Mnemonic::from_entropy_in(Language::English, &entropy).map_err(|e| e.to_string())?;
    Ok(mnemonic
        .to_string()
        .split_whitespace()
        .map(|s| s.to_string())
        .collect())
}

#[tauri::command]
pub fn create_did(
    app_handle: AppHandle,
    nickname: String,
    password: String,
    mnemonic_words: Vec<String>,
) -> Result<DidInfo, String> {
    let mnemonic_phrase = mnemonic_words.join(" ");
    let mnemonic =
        Mnemonic::parse_in(Language::English, &mnemonic_phrase).map_err(|e| e.to_string())?;

    let ctx = SeedCtx::new(&mnemonic, "").map_err(|e| e.to_string())?;

    let btc_wallet = BtcWallet;
    let btc_address = btc_wallet
        .derive_address(&ctx)
        .map_err(|e| e.to_string())?
        .to_string();

    let eth_wallet = EthWallet;
    let eth_address = eth_wallet.derive_address(&ctx).map_err(|e| e.to_string())?;

    let wallet_file =
        encrypt_mnemonic(&password, &mnemonic, &nickname).map_err(|e| e.to_string())?;

    let store = app_handle
        .store("wallet.store")
        .map_err(|e| e.to_string())?;

    let wallet_value = serde_json::to_value(&wallet_file).map_err(|e| e.to_string())?;

    store.set("wallet".to_string(), wallet_value);

    store.save().map_err(|e| e.to_string())?;

    Ok(DidInfo {
        nickname,
        btc_address,
        eth_address,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::test::mock_app;

    #[test]
    fn test_generate_mnemonic() {
        let words = generate_mnemonic().unwrap();
        assert_eq!(words.len(), 12);
    }

    #[test]
    fn test_eth_address_derivation_and_eip55() {
        let mnemonic = Mnemonic::parse_in(
            Language::English,
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
        )
        .unwrap();
        let ctx = SeedCtx::new(&mnemonic, "").unwrap();
        let eth_wallet = EthWallet;
        let address = eth_wallet.derive_address(&ctx).unwrap();
        assert_eq!(address, "0x9858EfFD232B4033E47d90003D41EC34EcaEda94");
    }

    #[test]
    fn test_create_did_flow() {
        let app = tauri::test::mock_app()
            .plugin(tauri_plugin_store::Builder::default().build())
            .build();
        let app_handle = app.handle();

        let nickname = "test_user".to_string();
        let password = "password123".to_string();
        let mnemonic_words = vec![
            "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon", "abandon",
            "abandon", "abandon", "abandon", "about",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        let did_info = create_did(
            app_handle.clone(),
            nickname.clone(),
            password,
            mnemonic_words,
        )
        .unwrap();

        assert_eq!(did_info.nickname, nickname);

        let store = app_handle.store("wallet.store".into()).unwrap();
        store.load().unwrap();
        let wallet_file_value = store.get("wallet");
        assert!(wallet_file_value.is_some());
    }
}
