use serde::Serialize;
use tauri::ipc::InvokeError;
use thiserror::Error;

#[derive(Debug, Copy, Clone, Serialize)]
#[repr(u32)]
pub enum CommandErrorCode {
    NotFound = 1001,
    InvalidPassword = 1002,
    NicknameExists = 1010,
    MnemonicRequired = 1011,
    IdentityExists = 1012,
    CountMustBePositive = 1013,
    SignMessageRequired = 1014,
    InvalidMnemonic = 1015,
    StoreUnavailable = 1100,
    VaultCorrupted = 1101,
    CryptoFailure = 1200,
    KeyDerivationFailure = 1201,
    JwtFailure = 1300,
    Internal = 1999,
}

#[derive(Debug, Error)]
pub enum CommandErrors {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Invalid password")]
    InvalidPassword,
    #[error("Nickname already exists")]
    NicknameExists,
    #[error("Mnemonic required")]
    MnemonicRequired,
    #[error("Identity already exists")]
    IdentityExists,
    #[error("Count must be positive")]
    CountMustBePositive,
    #[error("Sign message required")]
    SignMessageRequired,
    #[error("Invalid mnemonic: {0}")]
    InvalidMnemonic(String),
    #[error("Store unavailable: {0}")]
    StoreUnavailable(String),
    #[error("Vault data corrupted: {0}")]
    VaultCorrupted(String),
    #[error("Crypto failure: {0}")]
    CryptoFailure(String),
    #[error("Key derivation failure: {0}")]
    KeyDerivationFailure(String),
    #[error("JWT failure: {0}")]
    JwtFailure(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

pub type CommandResult<T> = Result<T, CommandErrors>;

#[derive(Debug, Serialize)]
pub struct CommandErrorPayload {
    pub code: CommandErrorCode,
    pub message: String,
}

impl CommandErrors {
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound(message.into())
    }

    pub fn invalid_password() -> Self {
        Self::InvalidPassword
    }

    pub fn store_unavailable(message: impl Into<String>) -> Self {
        Self::StoreUnavailable(message.into())
    }

    pub fn vault_corrupted(message: impl Into<String>) -> Self {
        Self::VaultCorrupted(message.into())
    }

    pub fn crypto_failed(message: impl Into<String>) -> Self {
        Self::CryptoFailure(message.into())
    }

    pub fn key_derivation_failed(message: impl Into<String>) -> Self {
        Self::KeyDerivationFailure(message.into())
    }

    pub fn jwt_failed(message: impl Into<String>) -> Self {
        Self::JwtFailure(message.into())
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal(message.into())
    }
    pub fn invalid_mnemonic(message: impl Into<String>) -> Self {
        Self::InvalidMnemonic(message.into())
    }

    pub fn code(&self) -> CommandErrorCode {
        match self {
            CommandErrors::NotFound(_) => CommandErrorCode::NotFound,
            CommandErrors::InvalidPassword => CommandErrorCode::InvalidPassword,
            CommandErrors::NicknameExists => CommandErrorCode::NicknameExists,
            CommandErrors::MnemonicRequired => CommandErrorCode::MnemonicRequired,
            CommandErrors::IdentityExists => CommandErrorCode::IdentityExists,
            CommandErrors::CountMustBePositive => CommandErrorCode::CountMustBePositive,
            CommandErrors::SignMessageRequired => CommandErrorCode::SignMessageRequired,
            CommandErrors::InvalidMnemonic(_) => CommandErrorCode::InvalidMnemonic,
            CommandErrors::StoreUnavailable(_) => CommandErrorCode::StoreUnavailable,
            CommandErrors::VaultCorrupted(_) => CommandErrorCode::VaultCorrupted,
            CommandErrors::CryptoFailure(_) => CommandErrorCode::CryptoFailure,
            CommandErrors::KeyDerivationFailure(_) => CommandErrorCode::KeyDerivationFailure,
            CommandErrors::JwtFailure(_) => CommandErrorCode::JwtFailure,
            CommandErrors::Internal(_) => CommandErrorCode::Internal,
        }
    }

    pub fn message(&self) -> String {
        match self {
            CommandErrors::NotFound(msg)
            | CommandErrors::StoreUnavailable(msg)
            | CommandErrors::VaultCorrupted(msg)
            | CommandErrors::CryptoFailure(msg)
            | CommandErrors::KeyDerivationFailure(msg)
            | CommandErrors::JwtFailure(msg)
            | CommandErrors::Internal(msg) => msg.clone(),
            CommandErrors::InvalidPassword => "invalid_password".to_string(),
            CommandErrors::NicknameExists => "nickname_already_exists".to_string(),
            CommandErrors::MnemonicRequired => "mnemonic_required".to_string(),
            CommandErrors::IdentityExists => "identity_already_exists".to_string(),
            CommandErrors::CountMustBePositive => "count_must_be_positive".to_string(),
            CommandErrors::SignMessageRequired => "sign_message_required".to_string(),
            CommandErrors::InvalidMnemonic(_) => "invalid_mnemonic".to_string(),
        }
    }
}

impl From<bip39::Error> for CommandErrors {
    fn from(value: bip39::Error) -> Self {
        CommandErrors::invalid_mnemonic(value.to_string())
    }
}

impl From<jsonwebtoken::errors::Error> for CommandErrors {
    fn from(value: jsonwebtoken::errors::Error) -> Self {
        CommandErrors::jwt_failed(value.to_string())
    }
}

impl From<CommandErrors> for CommandErrorPayload {
    fn from(value: CommandErrors) -> Self {
        Self {
            code: value.code(),
            message: value.message(),
        }
    }
}

impl From<CommandErrors> for InvokeError {
    fn from(value: CommandErrors) -> Self {
        InvokeError::from(CommandErrorPayload::from(value))
    }
}
