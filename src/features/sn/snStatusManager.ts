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

const SN_STATUS_STORAGE_KEY = "buckyos.sn.status";

const memoryCache: Record<string, SnStatusRecord | undefined> = loadPersistedCache();

function loadPersistedCache(): Record<string, SnStatusRecord | undefined> {
    if (typeof window === "undefined") return {};
    try {
        const raw = localStorage.getItem(SN_STATUS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const entries: Record<string, SnStatusRecord | undefined> = {};
        Object.entries(parsed as Record<string, SnStatusRecord>).forEach(([did, record]) => {
            if (!record) return;
            entries[did] = {
                registered: !!record.registered,
                username: record.username ?? null,
                info: null,
            };
        });
        return entries;
    } catch (err) {
        console.warn("[SN] failed to parse cached status", err);
        return {};
    }
}

function persistCache() {
    if (typeof window === "undefined") return;
    try {
        const serialized: Record<string, { registered: boolean; username?: string | null }> = {};
        Object.entries(memoryCache).forEach(([did, record]) => {
            if (!record) return;
            serialized[did] = {
                registered: record.registered,
                username: record.username ?? null,
            };
        });
        localStorage.setItem(SN_STATUS_STORAGE_KEY, JSON.stringify(serialized));
    } catch (err) {
        console.warn("[SN] failed to persist status", err);
    }
}

export function getCachedSnStatus(didId: string): SnStatusRecord | undefined {
    return memoryCache[didId];
}

export function setCachedSnStatus(didId: string, record: SnStatusRecord): void {
    memoryCache[didId] = record;
    persistCache();
}

export function clearCachedSnStatus(didId: string): void {
    delete memoryCache[didId];
    persistCache();
}

export async function fetchSnStatus(didId: string, publicKeyJwk: string): Promise<SnStatusRecord> {
    const { ok, raw } = await getUserByPublicKey(publicKeyJwk);
    const username = ok && typeof raw?.user_name === "string" ? raw.user_name.trim() : null;
    const record: SnStatusRecord = ok
        ? { registered: true, info: raw, username }
        : { registered: false, info: null, username: null };
    setCachedSnStatus(didId, record);
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
    setCachedSnStatus(didId, record);
    return record;
}
