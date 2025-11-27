use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm, Nonce};
use bip39::Mnemonic;
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;

use super::store::EncryptedSeed;
use crate::error::{CommandErrors, CommandResult};

fn kdf(password: &str, salt: &[u8], iter: u32) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iter, &mut key);
    key
}

pub fn encrypt_mnemonic(password: &str, mnemonic: &Mnemonic) -> CommandResult<EncryptedSeed> {
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
        .map_err(|e| CommandErrors::crypto_failed(format!("encrypt failed: {e}")))?;

    Ok(EncryptedSeed {
        kdf_iter: iter,
        kdf_salt_hex: hex::encode(salt),
        cipher_nonce_hex: hex::encode(nonce_bytes),
        cipher_hex: hex::encode(ciphertext),
    })
}

pub fn decrypt_mnemonic(password: &str, seed: &EncryptedSeed) -> CommandResult<String> {
    let salt = hex::decode(&seed.kdf_salt_hex)
        .map_err(|e| CommandErrors::vault_corrupted(format!("invalid salt: {e}")))?;
    let nonce_bytes = hex::decode(&seed.cipher_nonce_hex)
        .map_err(|e| CommandErrors::vault_corrupted(format!("invalid nonce: {e}")))?;
    let cipher_bytes = hex::decode(&seed.cipher_hex)
        .map_err(|e| CommandErrors::vault_corrupted(format!("invalid cipher: {e}")))?;

    let key = kdf(password, &salt, seed.kdf_iter);
    let cipher = Aes256Gcm::new_from_slice(&key).expect("aes key");
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, cipher_bytes.as_ref())
        .map_err(|_| CommandErrors::invalid_password())?;
    let phrase = String::from_utf8(plaintext)
        .map_err(|e| CommandErrors::vault_corrupted(format!("invalid utf8 mnemonic: {e}")))?;
    Ok(phrase)
}
