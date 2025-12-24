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

export interface SnStatusInfo {
    registered: boolean;
    username?: string | null;
}

export interface DidInfo {
    id: string;
    nickname: string;
    btc_addresses: BtcAddress[];
    eth_addresses: ChainAddress[];
    bucky_wallets: BuckyWallet[];
    sn_status?: SnStatusInfo | null;
}

export type WalletExtensionRequest =
    | { kind: "btc"; address_type: BtcAddressType; count?: number }
    | { kind: "eth"; count?: number }
    | { kind: "bucky"; count?: number };
