import { invoke } from "@tauri-apps/api/core";

/**
 * 获取本机可用的 IPv4 地址列表（排除 127.*）。
 */
export async function getLocalIPv4List(): Promise<string[]> {
    return invoke<string[]>("local_ipv4_list");
}
