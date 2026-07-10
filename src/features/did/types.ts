export type BtcAddressType = "legacy" | "nested_segwit" | "native_segwit" | "taproot";

export interface ChainAddress {
    index: number;
    address: string;
}

export interface BtcAddress extends ChainAddress {
    address_type: BtcAddressType;
}

export interface BuckyWallet {
    index: number;
    did: string;
    public_key: Record<string, unknown>;
}

export interface OwnerPublicJwk {
    kty: "OKP";
    crv: "Ed25519";
    x: string;
    [key: string]: unknown;
}

export interface RegistrationDerivation {
    index: number;
    derivation_path: string;
}

export interface RegistrationMaterial {
    normalized_name: string;
    owner_did: string;
    owner_public_jwk: OwnerPublicJwk;
    owner_derivation: RegistrationDerivation;
    evm_address: string;
    evm_derivation: RegistrationDerivation;
}

export interface OwnerWallet {
    type: string;
    address: string;
}

export interface OwnerDocument {
    "@context": string | string[];
    id: string;
    verificationMethod: Array<{
        type: string;
        id: string;
        controller: string;
        publicKeyJwk: OwnerPublicJwk | Record<string, unknown>;
        [key: string]: unknown;
    }>;
    authentication: string[];
    assertion_method?: string[];
    capabilityInvocation?: string[];
    exp: number;
    iat: number;
    version_seq?: number;
    name: string;
    display_name: string;
    avatar: string;
    wallets: Record<string, OwnerWallet>;
    [key: string]: unknown;
}

export interface OwnerDocumentForm {
    fullName: string;
    email: string;
    avatar: string;
}

export type RegistrationPhase = "idle" | "preparing" | "submitting" | "succeeded" | "failed";

export interface BnsIdentityCandidate {
    name: string;
    ownerDocument: OwnerDocument;
    ownerDocumentJson: string;
}

export interface SnStatusInfo {
    username?: string | null;
}

export interface DidInfo {
    id: string;
    nickname: string;
    btc_addresses: BtcAddress[];
    eth_addresses: ChainAddress[];
    bucky_wallets: BuckyWallet[];
    owner_document?: OwnerDocument | null;
    sn_status?: SnStatusInfo | null;
}

export type WalletExtensionRequest =
    | { kind: "btc"; address_type: BtcAddressType; count?: number }
    | { kind: "eth"; count?: number }
    | { kind: "bucky"; count?: number };
