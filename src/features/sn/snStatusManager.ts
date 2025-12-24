import { invoke } from "@tauri-apps/api/core";
import { getUserByPublicKey, registerSnUser } from "../../services/sn";

export interface SnStatusRecord {
    registered: boolean;
    info: any;
    username?: string | null;
}

export interface RegisterSnOptions {
    didId: string;
    password: string;
    username: string;
    inviteCode: string;
    publicKeyJwk: string;
    oodName?: string;
    maxPollAttempts?: number;
    pollIntervalMs?: number;
}

type SnStatusStoreRecord = {
    registered: boolean;
    username?: string | null;
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
    const record: SnStatusRecord = ok
        ? { registered: true, info: raw, username }
        : { registered: false, info: null, username: null };
    await setCachedSnStatus(didId, record);
    return record;
}

export async function registerSnAccount(options: RegisterSnOptions): Promise<SnStatusRecord> {
    const {
        didId,
        password,
        username,
        inviteCode,
        publicKeyJwk,
        oodName = "ood1",
        maxPollAttempts = 20,
        pollIntervalMs = 2000,
    } = options;

    const maskedInvite =
        inviteCode.length <= 6
            ? `${inviteCode[0] ?? ""}***${inviteCode[inviteCode.length - 1] ?? ""}(${inviteCode.length})`
            : `${inviteCode.slice(0, 2)}***${inviteCode.slice(-2)}(${inviteCode.length})`;

    console.debug("[SN-BIND]", "generate_zone_boot_config_jwt: start", { didId, username, invite: maskedInvite });
    let zoneConfigJwt: string;
    try {
        zoneConfigJwt = await invoke<string>("generate_zone_boot_config_jwt", {
            password,
            didId,
            sn: username,
            oodName,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const wrapped = new Error(`zone_config_failed::${message}`);
        (wrapped as Error & { cause?: unknown }).cause = err;
        throw wrapped;
    }
    console.debug("[SN-BIND]", "generate_zone_boot_config_jwt: success", { jwtLen: zoneConfigJwt.length });

    const registration = await registerSnUser({
        userName: username,
        activeCode: inviteCode,
        publicKeyJwk,
        zoneConfigJwt,
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
    const record: SnStatusRecord = {
        registered: true,
        info,
        username: finalUsername,
    };
    await setCachedSnStatus(didId, record);
    return record;
}
