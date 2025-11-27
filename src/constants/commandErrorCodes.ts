export enum CommandErrorCodes {
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

export type CommandErrorCode = CommandErrorCodes;
