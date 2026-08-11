import { invoke } from "@tauri-apps/api/core";
import type { DidInfo } from "../did/types";

export interface SnStatusRecord {
    info: Record<string, unknown> | null;
    username?: string | null;
    zoneConfig?: string | null;
}

type SnStatusStoreRecord = {
    username?: string | null;
    zone_config?: string | null;
};

const memoryCache: Record<string, SnStatusRecord | undefined> = {};
let cachePromise: Promise<void> | null = null;

function fromStored(record?: SnStatusStoreRecord | null): SnStatusRecord {
    const username = record?.username?.trim() || null;
    const zoneConfig = record?.zone_config?.trim() || null;
    return {
        username,
        zoneConfig,
        info: username || zoneConfig ? { user_name: username, zone_config: zoneConfig } : null,
    };
}

async function ensureCacheLoaded(): Promise<void> {
    if (!cachePromise) {
        cachePromise = (async () => {
            try {
                const stored = await invoke<Record<string, SnStatusStoreRecord>>("list_sn_statuses");
                Object.entries(stored ?? {}).forEach(([did, record]) => {
                    memoryCache[did] = fromStored(record);
                });
            } catch (error) {
                console.warn("[SN] failed to load persisted SN status", error);
            }
        })();
    }
    await cachePromise;
}

export async function getCachedSnStatus(didId: string): Promise<SnStatusRecord | undefined> {
    await ensureCacheLoaded();
    return memoryCache[didId];
}

export async function primeCachedSnStatus(didId: string, username: string): Promise<void> {
    await ensureCacheLoaded();
    memoryCache[didId] = fromStored({ username });
}

export async function setCachedSnStatus(didId: string, record: SnStatusRecord): Promise<void> {
    await ensureCacheLoaded();
    memoryCache[didId] = { ...record };
    await invoke("set_sn_status", {
        didId,
        status: {
            username: record.username ?? null,
            zone_config: record.zoneConfig ?? null,
        },
    });
}

export async function clearCachedSnStatus(didId: string): Promise<void> {
    await ensureCacheLoaded();
    delete memoryCache[didId];
    await invoke("clear_sn_status", { didId });
}

// SN no longer exposes public-key lookup. Refreshing status is therefore a
// local read of the registration/login state already persisted with the DID.
export async function fetchSnStatus(
    didId: string,
    _publicKeyJwk?: string
): Promise<SnStatusRecord> {
    await ensureCacheLoaded();
    const cached = memoryCache[didId];
    if (cached) return cached;

    const dids = await invoke<DidInfo[]>("list_dids");
    const localStatus = dids.find((did) => did.id === didId)?.sn_status;
    const record = fromStored(localStatus ? { username: localStatus.username } : null);
    memoryCache[didId] = record;
    return record;
}
