import { buckyos } from "buckyos";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_SN_API_BASE_URL = "https://sn.buckyos.ai/kapi/sn";
const SN_CHECK_TIMEOUT_MS = 5000;

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

function shortenValue(value: string, keep = 16): string {
    if (value.length <= keep * 2) return value;
    return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

function summarizePublicKeyJwk(publicKeyJwk: string): string {
    try {
        const parsed = JSON.parse(publicKeyJwk) as Record<string, unknown>;
        const kty = typeof parsed.kty === "string" ? parsed.kty : "unknown";
        const crv = typeof parsed.crv === "string" ? parsed.crv : "unknown";
        const x = typeof parsed.x === "string" ? shortenValue(parsed.x, 10) : "missing-x";
        return `${kty}/${crv}/${x}`;
    } catch {
        return shortenValue(publicKeyJwk, 24);
    }
}

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function checkBuckyUsername(username: string): Promise<boolean> {
    const normalized = normalizeUsername(username);
    if (!normalized) {
        console.info("[SN-CHECK] auth.check_username request", { name: normalized });
        console.info("[SN-CHECK] auth.check_username result", { name: normalized, valid: false, raw: null });
        return false;
    }
    console.info("[SN-CHECK] auth.check_username request", { name: normalized });
    const data = await withTimeout(
        snCall<{ valid?: boolean; code?: number }>("auth", "auth.check_username", {
            name: normalized,
        }),
        SN_CHECK_TIMEOUT_MS,
        "sn_check_timeout"
    );

    let valid = false;
    if (typeof data?.valid === "boolean") {
        valid = data.valid;
    } else if (typeof data?.code === "number") {
        valid = data.code === 0;
    }

    console.info("[SN-CHECK] auth.check_username result", { name: normalized, valid, raw: data });
    return valid;
}

export async function checkSnActiveCode(activeCode: string): Promise<boolean> {
    const trimmedCode = activeCode.trim();
    console.info("[SN-CHECK] auth.check_active_code request", { activeCode: trimmedCode });
    const data = await withTimeout(
        snCall<{ valid?: boolean; code?: number }>(
            "auth",
            "auth.check_active_code",
            { active_code: trimmedCode }
        ),
        SN_CHECK_TIMEOUT_MS,
        "sn_check_timeout"
    );

    const valid = typeof data?.valid === "boolean" ? data.valid : false;
    console.info("[SN-CHECK] auth.check_active_code result", { activeCode: trimmedCode, valid, raw: data });
    return valid;
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
    const keySummary = summarizePublicKeyJwk(publicKeyJwk);
    console.info("[OOD-CHECK] device.get_by_pk request", { keySummary });

    const data = await withTimeout(
        snCall<{
            device_info?: string | null;
            device_name?: string | null;
            device_sn_ip?: string | null;
            found?: boolean | null;
            public_key?: string | null;
            reason?: string | null;
            sn_ips?: string[] | null;
            user_name?: string | null;
            zone_config?: string | null;
        }>("root", "device.get_by_pk", { public_key: publicKeyJwk }),
        SN_CHECK_TIMEOUT_MS,
        "sn_import_timeout"
    );

    const ok = typeof data?.user_name === "string" && data.user_name.trim().length > 0;
    console.info("[OOD-CHECK] device.get_by_pk response", { keySummary, raw: data });

    return {
        ok,
        raw: data,
    };
}
