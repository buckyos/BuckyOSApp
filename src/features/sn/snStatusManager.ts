import { invoke } from "@tauri-apps/api/core";
import { getUserByPublicKey, registerSnUser } from "../../services/sn";

export interface SnStatusRecord {
    registered: boolean;
    info: any;
    username?: string | null;
    zoneConfig?: string | null;
}

export interface RegisterSnOptions {
    didId: string;
    username: string;
    inviteCode: string;
    publicKeyJwk: string;
    maxPollAttempts?: number;
    pollIntervalMs?: number;
}

type SnStatusStoreRecord = {
    registered: boolean;
    username?: string | null;
    zone_config?: string | null;
};

const memoryCache: Record<string, SnStatusRecord | undefined> = {};
let cachePromise: Promise<void> | null = null;

async function ensureCacheLoaded(): Promise<void> {
    if (!cachePromise) {
        cachePromise = (async () => {
            try {
                const stored = await invoke<Record<string, SnStatusStoreRecord>>("list_sn_statuses");
                if (stored && typeof stored === "object") {
                    Object.entries(stored).forEach(([did, record]) => {
                        if (!record) return;
                        memoryCache[did] = {
                            registered: !!record.registered,
                            username: record.username ?? null,
                            zoneConfig: record.zone_config ?? null,
                            info: null,
                        };
                    });
                }
            } catch (err) {
                console.warn("[SN] failed to load persisted SN status", err);
            }
        })();
    }
    await cachePromise;
}

export async function getCachedSnStatus(didId: string): Promise<SnStatusRecord | undefined> {
    await ensureCacheLoaded();
    return memoryCache[didId];
}

export async function setCachedSnStatus(didId: string, record: SnStatusRecord): Promise<void> {
    await ensureCacheLoaded();
    memoryCache[didId] = record;
    await invoke("set_sn_status", {
        didId,
        status: {
            registered: record.registered,
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

export async function fetchSnStatus(didId: string, publicKeyJwk: string): Promise<SnStatusRecord> {
    const { ok, raw } = await getUserByPublicKey(publicKeyJwk);
    const username = ok && typeof raw?.user_name === "string" ? raw.user_name.trim() : null;
    const zoneConfig = ok && typeof raw?.zone_config === "string" ? raw.zone_config : null;
    const record: SnStatusRecord = ok
        ? { registered: true, info: raw, username, zoneConfig }
        : { registered: false, info: null, username: null, zoneConfig: null };
    await setCachedSnStatus(didId, record);
    return record;
}

export async function registerSnAccount(options: RegisterSnOptions): Promise<SnStatusRecord> {
    const {
        didId,
        username,
        inviteCode,
        publicKeyJwk,
        maxPollAttempts = 20,
        pollIntervalMs = 2000,
    } = options;

    const registration = await registerSnUser({
        userName: username,
        activeCode: inviteCode,
        publicKeyJwk,
    });
    if (!registration.ok) {
        console.error("[SN-BIND]", "registerSnUser: failed");
        throw new Error("register_sn_user_failed");
    }

    let info: any = null;
    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
        try {
            console.debug("[SN-BIND]", "poll", { attempt });
            const { ok, raw } = await getUserByPublicKey(publicKeyJwk);
            if (ok) {
                info = raw;
                break;
            }
        } catch (err) {
            console.error("[SN-BIND]", "poll error", { attempt, err });
        }
        if (attempt < maxPollAttempts) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }

    if (!info) {
        console.error("[SN-BIND]", "bind timeout");
        throw new Error("sn_bind_timeout");
    }

    const finalUsername =
        (typeof info?.user_name === "string" && info.user_name.trim()) || username.trim() || null;
    const zoneConfig =
        (typeof info?.zone_config === "string" && info.zone_config.trim()) || null;
    const record: SnStatusRecord = {
        registered: true,
        info,
        username: finalUsername,
        zoneConfig,
    };
    console.debug("[SN-BIND]", "registerSnAccount: success", record);
    await setCachedSnStatus(didId, record);
    return record;
}
