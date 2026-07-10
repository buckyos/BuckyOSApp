import { invoke } from "@tauri-apps/api/core";
import { buckyos } from "buckyos";

const DEFAULT_SN_API_BASE_URL = "https://sn.buckyos.ai/kapi/sn";
const SN_API_TIMEOUT_MS = 10000;

let snApiUrlOverride: string | null = null;
let snApiUrlPromise: Promise<string> | null = null;

interface SnRpcTransport {
    call<TResult, TParams>(method: string, params: TParams): Promise<TResult>;
}

interface SnCodeResponse {
    code?: number;
}

export interface SnCheckUsernameParams {
    name: string;
}

export interface SnCheckUsernameResponse extends SnCodeResponse {
    valid?: boolean;
}

export interface SnCheckActiveCodeParams {
    active_code: string;
}

export interface SnCheckActiveCodeResponse extends SnCodeResponse {
    valid?: boolean;
}

export interface SnRegisterParams {
    name: string;
    pwd_hash: string;
    active_code: string;
}

export interface SnRegisterResponse extends SnCodeResponse {
    access_token?: string;
    refresh_token?: string;
    need_bind_owner_key?: boolean;
}

export interface SnBindOwnerKeyParams {
    public_key: string;
}

export type SnBindOwnerKeyResponse = SnCodeResponse;

export interface SnGetByPublicKeyParams {
    public_key: string;
}

export interface SnGetByPublicKeyResponse {
    device_info?: string | null;
    device_name?: string | null;
    device_sn_ip?: string | null;
    found?: boolean | null;
    public_key?: string | null;
    reason?: string | null;
    sn_ips?: string[] | null;
    user_name?: string | null;
    zone_config?: string | null;
}

export interface SnUnbindZoneConfigParams {
    user_name: string;
}

export type SnUnbindZoneConfigResponse = SnCodeResponse;

abstract class SnRpcClient {
    private readonly rpcClient: SnRpcTransport;

    protected constructor(url: string, token?: string | null) {
        this.rpcClient = new buckyos.kRPCClient(url, token ?? null);
    }

    protected call<TResult, TParams>(method: string, params: TParams): Promise<TResult> {
        return this.rpcClient.call<TResult, TParams>(method, params);
    }
}

export class SnAuthClient extends SnRpcClient {
    constructor(url: string) {
        super(url);
    }

    checkUsername(params: SnCheckUsernameParams): Promise<SnCheckUsernameResponse> {
        return this.call("auth.check_username", params);
    }

    checkActiveCode(params: SnCheckActiveCodeParams): Promise<SnCheckActiveCodeResponse> {
        return this.call("auth.check_active_code", params);
    }

    register(params: SnRegisterParams): Promise<SnRegisterResponse> {
        return this.call("auth.register", params);
    }
}

export class SnBindingClient extends SnRpcClient {
    constructor(url: string, token?: string | null) {
        super(url, token);
    }

    bindOwnerKey(params: SnBindOwnerKeyParams): Promise<SnBindOwnerKeyResponse> {
        return this.call("user.bind_owner_key", params);
    }

    unbindZoneConfig(params: SnUnbindZoneConfigParams): Promise<SnUnbindZoneConfigResponse> {
        return this.call("zone.unbind_config", params);
    }
}

export class SnDeviceClient extends SnRpcClient {
    constructor(url: string) {
        super(url);
    }

    getByPublicKey(params: SnGetByPublicKeyParams): Promise<SnGetByPublicKeyResponse> {
        return this.call("device.get_by_pk", params);
    }
}

function normalizeUsername(value: string): string {
    return value.trim().toLowerCase();
}

export function setSnApiUrl(url: string) {
    snApiUrlOverride = url;
    snApiUrlPromise = Promise.resolve(url);
}

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

async function getSnAuthClient(): Promise<SnAuthClient> {
    return new SnAuthClient(await getSnRouteUrl("auth"));
}

async function getSnBindingClient(token?: string | null): Promise<SnBindingClient> {
    return new SnBindingClient(await getSnRouteUrl("bns"), token ?? null);
}

async function getSnDeviceClient(): Promise<SnDeviceClient> {
    return new SnDeviceClient(await getSnRouteUrl("root"));
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
    const client = await getSnAuthClient();
    const data = await withTimeout(
        client.checkUsername({
            name: normalized,
        }),
        SN_API_TIMEOUT_MS,
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
    const client = await getSnAuthClient();
    const data = await withTimeout(
        client.checkActiveCode({ active_code: trimmedCode }),
        SN_API_TIMEOUT_MS,
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
    const authClient = await getSnAuthClient();
    const registration = await withTimeout(
        authClient.register({
            name: normalizedUserName,
            pwd_hash: args.passwordHash,
            active_code: args.activeCode.trim(),
        }),
        SN_API_TIMEOUT_MS,
        "register_sn_user_failed"
    );

    if ((registration?.code ?? -1) !== 0 || !registration?.access_token) {
        return { ok: false, raw: registration };
    }

    const bindingClient = await getSnBindingClient(registration.access_token);
    const bindResult = await withTimeout(
        bindingClient.bindOwnerKey({ public_key: args.publicKeyJwk }),
        SN_API_TIMEOUT_MS,
        "register_sn_user_failed"
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

    const client = await getSnDeviceClient();
    const data = await withTimeout(
        client.getByPublicKey({ public_key: publicKeyJwk }),
        SN_API_TIMEOUT_MS,
        "sn_import_timeout"
    );

    const ok = typeof data?.user_name === "string" && data.user_name.trim().length > 0;
    console.info("[OOD-CHECK] device.get_by_pk response", { keySummary, raw: data });

    return {
        ok,
        raw: data,
    };
}

export async function unbindZoneConfig(userName: string, token: string): Promise<void> {
    const normalizedUserName = normalizeUsername(userName);
    console.info("[OOD-UNBIND] zone.unbind_config request", { userName: normalizedUserName });
    const client = await getSnBindingClient(token);
    const result = await withTimeout(
        client.unbindZoneConfig({ user_name: normalizedUserName }),
        SN_API_TIMEOUT_MS,
        "sn_unbind_timeout"
    );
    console.info("[OOD-UNBIND] zone.unbind_config response", {
        userName: normalizedUserName,
        raw: result,
    });

    if ((result?.code ?? -1) !== 0) {
        console.error("[OOD-UNBIND] zone.unbind_config failed", {
            userName: normalizedUserName,
            raw: result,
        });
        throw new Error("sn_unbind_failed");
    }
}
