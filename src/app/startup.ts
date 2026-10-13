import { invoke } from "@tauri-apps/api/core";

let pendingWalletCheck: Promise<boolean> | null = null;

// StrictMode mounts effects twice in dev. Share only concurrent reads; the
// next startup/deletion check must still consult the current local vault.
export function checkStartupWallet(): Promise<boolean> {
    if (!pendingWalletCheck) {
        pendingWalletCheck = invoke<boolean>("wallet_exists").finally(() => {
            pendingWalletCheck = null;
        });
    }
    return pendingWalletCheck;
}
