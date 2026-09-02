import { sn } from "buckyos";
import type { OwnerDocument } from "../features/did/types";
import { getServiceEndpoints, setServiceEndpointsForTests } from "./endpoints";

const SN_CHECK_TIMEOUT_MS = 10_000;
const SN_REGISTER_TIMEOUT_MS = 180_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGISTRATION_ERROR_NAMES = new Set([
    "invalid_params",
    "invalid_email",
    "email_already_bound",
    "username_already_exists",
    "invalid_active_code",
    "bns_permission_denied",
    "bns_name_already_exists",
    "bns_write_failed",
    "bns_proxy_unavailable",
    "bns_controller_unavailable",
    "sn_register_timeout",
    "sn_register_contract_violation",
]);

export function isLocallyValidEmail(value: string): boolean {
    return EMAIL_PATTERN.test(value.trim());
}

export function snRegistrationErrorMessageKey(codeName: string): string | null {
    return REGISTRATION_ERROR_NAMES.has(codeName) ? `sn.error.${codeName}` : null;
}

export type SnRegistrationErrorCode =
    | "invalid_params"
    | "invalid_email"
    | "email_already_bound"
    | "username_already_exists"
    | "invalid_active_code"
    | "bns_permission_denied"
    | "bns_name_already_exists"
    | "bns_write_failed"
    | "bns_proxy_unavailable"
    | "bns_controller_unavailable"
    | "sn_register_failed"
    | "sn_register_contract_violation"
    | "sn_register_timeout";

export class SnServiceError extends Error {
    readonly codeName: SnRegistrationErrorCode | string;

    constructor(codeName: SnRegistrationErrorCode | string, detail?: string) {
        super(detail || codeName);
        this.name = "SnServiceError";
        this.codeName = codeName;
    }
}

export interface SnUsernameCheck {
    valid: boolean;
    reason: string;
    message: string;
    normalized_name: string;
}

export interface SnRegisterInput {
    name: string;
    email: string;
    passwordHash: string;
    activeCode: string;
    requestId: string;
    assetOwner: string;
    ownerDocument: OwnerDocument;
}

export interface SnRegisterResult {
    code: number;
    need_bind_owner_key: false;
    access_token: string;
    refresh_token: string;
    bns?: unknown;
}

export function buildSnRegisterRequest(input: SnRegisterInput): sn.SnAuthRegisterReq {
    return {
        name: input.name,
        email: input.email,
        pwd_hash: input.passwordHash,
        active_code: input.activeCode.trim(),
        request_id: input.requestId,
        asset_owner: input.assetOwner,
        owner_config: input.ownerDocument,
    };
}

function timeoutFetcher(timeoutMs: number, timeoutCode: string) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const controller = new AbortController();
        const sourceSignal = init?.signal;
        const forwardAbort = () => controller.abort(sourceSignal?.reason);
        if (sourceSignal) {
            if (sourceSignal.aborted) forwardAbort();
            else sourceSignal.addEventListener("abort", forwardAbort, { once: true });
        }
        const timer = setTimeout(() => controller.abort(timeoutCode), timeoutMs);
        try {
            return await fetch(input, { ...init, signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted && !sourceSignal?.aborted) throw new SnServiceError(timeoutCode);
            throw error;
        } finally {
            clearTimeout(timer);
            sourceSignal?.removeEventListener("abort", forwardAbort);
        }
    };
}

async function client(timeoutMs: number, timeoutCode: string): Promise<sn.SnClient> {
    const endpoints = await getServiceEndpoints();
    return new sn.SnClient(endpoints.sn_api_url, null, {
        fetcher: timeoutFetcher(timeoutMs, timeoutCode),
    });
}

function translateClientError(error: unknown): never {
    if (error instanceof SnServiceError) throw error;
    if (error instanceof sn.SnClientError) {
        if (error.detail.includes("sn_register_timeout") || error.message.includes("sn_register_timeout")) {
            throw new SnServiceError("sn_register_timeout");
        }
        if (error.detail.includes("sn_check_timeout") || error.message.includes("sn_check_timeout")) {
            throw new SnServiceError("sn_check_timeout");
        }
        throw new SnServiceError(error.codeName || "sn_register_failed", error.detail);
    }
    throw error;
}

function rpcErrorDetails(error: unknown): Record<string, unknown> {
    if (error instanceof sn.SnClientError) {
        return {
            name: error.name,
            message: error.message,
            kind: error.kind,
            code: error.code,
            codeName: error.codeName,
            detail: error.detail,
            stack: error.stack,
        };
    }
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: unknown }).cause;
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: cause instanceof Error
                ? {
                      name: cause.name,
                      message: cause.message,
                      stack: cause.stack,
                  }
                : cause,
        };
    }
    return { value: String(error) };
}

async function logUsernameCheckFailure(username: string, error: unknown): Promise<void> {
    let rpcUrl = "unavailable";
    try {
        const endpoints = await getServiceEndpoints();
        rpcUrl = `${endpoints.sn_api_url}/kapi/sn/auth`;
    } catch (endpointError) {
        rpcUrl = `endpoint lookup failed: ${
            endpointError instanceof Error ? endpointError.message : String(endpointError)
        }`;
    }

    console.error("[SN RPC] auth.check_username failed", {
        rpcUrl,
        method: "auth.check_username",
        params: { name: username },
        pageOrigin: typeof window !== "undefined" ? window.location.origin : null,
        online: typeof navigator !== "undefined" ? navigator.onLine : null,
        error: rpcErrorDetails(error),
        rawError: error,
    });
}

export function setSnApiUrl(url: string): void {
    const parsed = new URL(url);
    const root = parsed.hostname.replace(/^(sn|bns)\./, "");
    setServiceEndpointsForTests({
        sn_host: root,
        sn_api_url: `${parsed.protocol}//sn.${root}${parsed.port ? `:${parsed.port}` : ""}`,
        bns_api_url: `${parsed.protocol}//bns.${root}${parsed.port ? `:${parsed.port}` : ""}`,
    });
}

export async function checkSnUsername(username: string): Promise<SnUsernameCheck> {
    const normalized = username.trim().toLowerCase();
    if (!normalized) {
        return { valid: false, reason: "invalid_username", message: "", normalized_name: "" };
    }
    try {
        return await (await client(SN_CHECK_TIMEOUT_MS, "sn_check_timeout")).checkUsername(normalized);
    } catch (error) {
        await logUsernameCheckFailure(normalized, error);
        translateClientError(error);
    }
}

export async function checkBuckyUsername(username: string): Promise<boolean> {
    return (await checkSnUsername(username)).valid;
}

export async function checkSnActiveCode(activeCode: string): Promise<boolean> {
    const code = activeCode.trim();
    if (!code) return false;
    try {
        return (await (await client(SN_CHECK_TIMEOUT_MS, "sn_check_timeout")).checkActiveCode(code)).valid;
    } catch (error) {
        translateClientError(error);
    }
}

export async function registerSnIdentity(input: SnRegisterInput): Promise<SnRegisterResult> {
    try {
        const response = await (await client(SN_REGISTER_TIMEOUT_MS, "sn_register_timeout")).register(
            buildSnRegisterRequest(input)
        );
        if (response.code !== 0) throw new SnServiceError("sn_register_failed");
        if (response.need_bind_owner_key !== false) {
            throw new SnServiceError("sn_register_contract_violation");
        }
        return response as SnRegisterResult;
    } catch (error) {
        translateClientError(error);
    }
}

// Owner-key-authorized atomic/CAS unlink. The App confirms the submitted
// result through BNS readback before changing any local binding state.
export async function removeOwnerBoundZone(
    request: sn.SnOwnerRemoveBoundZoneReq
): Promise<sn.SnOwnerRemoveBoundZoneResp> {
    const result = await (await client(SN_REGISTER_TIMEOUT_MS, "sn_unbind_timeout")).removeBoundZone(request);
    if (result.code !== 0) throw new Error("sn_unbind_failed");
    return result;
}
