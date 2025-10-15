import { invoke } from "@tauri-apps/api/core";
import type { DidInfo, WalletExtensionRequest } from "./types";

export async function listDids(): Promise<DidInfo[]> {
    return invoke("list_dids");
}

export async function fetchActiveDid(): Promise<DidInfo | null> {
    return invoke("active_did");
}

export async function setActiveDid(didId: string): Promise<DidInfo> {
    return invoke("set_active_did", { didId });
}

export async function deleteDid(password: string, didId: string): Promise<void> {
    await invoke("delete_wallet", { password, didId });
}

export async function revealMnemonic(password: string, didId: string): Promise<string[]> {
    return invoke("reveal_mnemonic", { password, didId });
}

export async function extendWallets(
    password: string,
    didId: string,
    request: WalletExtensionRequest
): Promise<DidInfo> {
    return invoke("extend_wallets", { password, didId, request });
}
