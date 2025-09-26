export type BtcAddressType = "legacy" | "nested_segwit" | "native_segwit" | "taproot";

export interface ChainAddress {
    index: number;
    address: string;
}

export interface BtcAddress extends ChainAddress {
    address_type: BtcAddressType;
}

export interface DidInfo {
    id: string;
    nickname: string;
    btc_addresses: BtcAddress[];
    eth_addresses: ChainAddress[];
}
