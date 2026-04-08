import { buckyos } from "buckyos";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_SN_API_BASE_URL = "https://sn.buckyos.ai/kapi/sn";

let snApiUrlOverride: string | null = null;
let snApiUrlPromise: Promise<string> | null = null;

function normalizeUsername(value: string): string {
    return value.trim().toLowerCase();
}

export function setSnApiUrl(url: string) {
    snApiUrlOverride = url;
    snApiUrlPromise = Promise.resolve(url);
}

type JsonValue = Record<string, any>;

async function getSnApiBaseUrl(): Promise<string> {
    if (snApiUrlPromise) {
        return snApiUrlPromise;
    }
    snApiUrlPromise = (async () => {
        if (snApiUrlOverride) return snApiUrlOverride;
        try {
            const host = await invoke<string>("get_sn_api_host");
            if (typeof host === "string" && host.trim().length > 0) {
                return host;
            }
        } catch (err) {
            console.warn("[SN] failed to load host config, fallback to default", err);
        }
        return DEFAULT_SN_API_BASE_URL;
    })();
    return snApiUrlPromise;
}

async function getSnRouteUrl(route: "root" | "auth" | "bns"): Promise<string> {
    const baseUrl = await getSnApiBaseUrl();
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    if (route === "root") return normalizedBase;
    if (normalizedBase.endsWith(`/${route}`)) return normalizedBase;
    return `${normalizedBase}/${route}`;
}

async function snCall<T = any>(
    route: "root" | "auth" | "bns",
    method: string,
    params: JsonValue,
    token?: string | null
): Promise<T> {
    const client = new buckyos.kRPCClient(await getSnRouteUrl(route), token ?? null);
    const data = await client.call(method, params);
    return data as T;
}

export async function checkBuckyUsername(username: string): Promise<boolean> {
    const normalized = normalizeUsername(username);
    if (!normalized) return false;
    const data = await snCall<{ valid?: boolean; code?: number }>("auth", "auth.check_username", {
        name: normalized,
    });

    if (typeof data?.valid === "boolean") return data.valid;
    if (typeof data?.code === "number") return data.code === 0;
    return false;
}

export async function checkSnActiveCode(activeCode: string): Promise<boolean> {
    const data = await snCall<{ valid?: boolean; code?: number }>(
        "auth",
        "auth.check_active_code",
        { active_code: activeCode.trim() }
    );

    if (typeof data?.valid === "boolean") return data.valid;
    return false;
}

export async function registerSnAccountWithPassword(args: {
    userName: string;
    passwordHash: string;
    activeCode: string;
    publicKeyJwk: string;
}): Promise<{ ok: boolean; raw: any }> {
    const normalizedUserName = normalizeUsername(args.userName);
    const registration = await snCall<{
        code?: number;
        access_token?: string;
        refresh_token?: string;
        need_bind_owner_key?: boolean;
    }>("auth", "auth.register", {
        name: normalizedUserName,
        pwd_hash: args.passwordHash,
        active_code: args.activeCode.trim(),
    });

    if ((registration?.code ?? -1) !== 0 || !registration?.access_token) {
        return { ok: false, raw: registration };
    }

    const bindResult = await snCall<{ code?: number }>(
        "bns",
        "user.bind_owner_key",
        { public_key: args.publicKeyJwk },
        registration.access_token
    );

    return {
        ok: (bindResult?.code ?? -1) === 0,
        raw: {
            registration,
            bind_owner_key: bindResult,
        },
    };
}

export async function getUserByPublicKey(publicKeyJwk: string): Promise<{ ok: boolean; raw: any }> {
    const data = await snCall<{
        device_info?: string | null;
        device_name?: string | null;
        device_sn_ip?: string | null;
        found?: boolean | null;
        public_key?: string | null;
        reason?: string | null;
        sn_ips?: string[] | null;
        user_name?: string | null;
        zone_config?: string | null;
    }>("root", "device.get_by_pk", { public_key: publicKeyJwk });

    return {
        ok: typeof data?.user_name === "string" && data.user_name.trim().length > 0,
        raw: data,
    };
}
