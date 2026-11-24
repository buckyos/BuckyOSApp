//! The system keychain, as a small key-value store.
//!
//! A password digest is as good as the password for signing in to the Zone (TODO R9), so nothing
//! here is ever written to a plain file. Where the platform offers no keychain (a Linux session
//! without a Secret Service) values stay in memory and are asked for again after a restart.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub trait SecretBackend: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String>;
    fn set(&self, key: &str, value: &[u8]) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

#[cfg(test)]
#[derive(Default)]
pub struct MemoryBackend(Mutex<HashMap<String, Vec<u8>>>);

#[cfg(test)]
impl SecretBackend for MemoryBackend {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        Ok(self.0.lock().expect("secrets poisoned").get(key).cloned())
    }

    fn set(&self, key: &str, value: &[u8]) -> Result<(), String> {
        self.0
            .lock()
            .expect("secrets poisoned")
            .insert(key.to_string(), value.to_vec());
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        self.0.lock().expect("secrets poisoned").remove(key);
        Ok(())
    }
}

#[cfg(any(desktop, target_os = "ios"))]
struct KeyringBackend;

#[cfg(any(desktop, target_os = "ios"))]
const KEYRING_SERVICE: &str = "com.buckyos.buckyosapp";

#[cfg(any(desktop, target_os = "ios"))]
impl SecretBackend for KeyringBackend {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())?;
        match entry.get_secret() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn set(&self, key: &str, value: &[u8]) -> Result<(), String> {
        keyring::Entry::new(KEYRING_SERVICE, key)
            .and_then(|entry| entry.set_secret(value))
            .map_err(|e| e.to_string())
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, key).map_err(|e| e.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

/// Values read once are kept in memory, so a keychain prompt or a slow backend is met at most once
/// per value and run.
#[derive(Clone)]
pub struct SecretStore {
    backend: Arc<dyn SecretBackend>,
    cache: Arc<Mutex<HashMap<String, Option<Vec<u8>>>>>,
}

impl SecretStore {
    pub fn new(backend: Arc<dyn SecretBackend>) -> Self {
        Self {
            backend,
            cache: Arc::default(),
        }
    }

    #[cfg(any(desktop, target_os = "ios"))]
    pub fn system() -> Self {
        Self::new(Arc::new(KeyringBackend))
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self::new(Arc::new(MemoryBackend::default()))
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        if let Some(value) = self.cache.lock().expect("secret cache poisoned").get(key) {
            return value.clone();
        }
        match self.backend.get(key) {
            Ok(value) => {
                self.cache
                    .lock()
                    .expect("secret cache poisoned")
                    .insert(key.to_string(), value.clone());
                value
            }
            Err(error) => {
                log::warn!("[secret] reading the keychain failed: {error}");
                None
            }
        }
    }

    pub fn set(&self, key: &str, value: &[u8]) {
        self.cache
            .lock()
            .expect("secret cache poisoned")
            .insert(key.to_string(), Some(value.to_vec()));
        if let Err(error) = self.backend.set(key, value) {
            log::warn!("[secret] writing the keychain failed, kept in memory: {error}");
        }
    }

    pub fn delete(&self, key: &str) {
        self.cache
            .lock()
            .expect("secret cache poisoned")
            .insert(key.to_string(), None);
        if let Err(error) = self.backend.delete(key) {
            log::warn!("[secret] deleting from the keychain failed: {error}");
        }
    }

    pub fn get_json<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        serde_json::from_slice(&self.get(key)?).ok()
    }

    pub fn set_json<T: serde::Serialize>(&self, key: &str, value: &T) {
        match serde_json::to_vec(value) {
            Ok(bytes) => self.set(key, &bytes),
            Err(error) => log::error!("[secret] encoding failed: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailingBackend;
    impl SecretBackend for FailingBackend {
        fn get(&self, _: &str) -> Result<Option<Vec<u8>>, String> {
            Err("locked".into())
        }
        fn set(&self, _: &str, _: &[u8]) -> Result<(), String> {
            Err("locked".into())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Err("locked".into())
        }
    }

    #[test]
    fn keeps_values_in_memory_when_the_keychain_fails() {
        let store = SecretStore::new(Arc::new(FailingBackend));
        assert_eq!(store.get("a"), None);
        store.set("a", b"1");
        assert_eq!(store.get("a"), Some(b"1".to_vec()));
        store.delete("a");
        assert_eq!(store.get("a"), None);
    }
}
