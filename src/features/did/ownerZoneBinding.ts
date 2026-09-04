import { namelib, ndn } from "buckyos";
import type { OwnerDocument } from "./types";
import { resolveBnsOwnerDocument, type ResolvedBnsOwnerDocument } from "../../services/bns_client";

export const OWNER_REMOVE_BOUND_ZONE_AUDIENCE = "sn-bns-proxy";
export const OWNER_REMOVE_BOUND_ZONE_OPERATION = "owner.remove_bound_zone";
export const OWNER_AUTHORIZATION_TTL_SECONDS = 300;
export const OWNER_UNBIND_CONFIRM_TIMEOUT_MS = 120_000;
export const OWNER_UNBIND_CONFIRM_INTERVAL_MS = 2_000;

export interface OwnerRemoveBoundZoneClaims extends Record<string, unknown> {
    sub: string;
    aud: typeof OWNER_REMOVE_BOUND_ZONE_AUDIENCE;
    operation: typeof OWNER_REMOVE_BOUND_ZONE_OPERATION;
    name: string;
    zone_did: string;
    expected_owner_hash: string;
    request_id: string;
    iat: number;
    exp: number;
}

export async function canonicalOwnerDocumentHash(document: OwnerDocument): Promise<string> {
    const bytes = new TextEncoder().encode(ndn.toCanonicalJsonString(document));
    return `sha256:${await sha256Hex(bytes)}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ownerBoundZoneDids(document: OwnerDocument): string[] {
    if (document.zone_binding_model_version !== undefined &&
        document.zone_binding_model_version !== namelib.ZONE_BINDING_MODEL_VERSION) {
        throw new Error("unsupported_zone_binding_model_version");
    }
    const zones = document.binded_zone_list;
    if (zones === undefined) return [];
    if (!Array.isArray(zones) || zones.some((zone) => typeof zone !== "string" || !zone.trim())) {
        throw new Error("invalid_bound_zone_list");
    }
    return [...new Set(zones.map((zone) => zone.trim()))];
}

export function isLegacyOwnerZoneBinding(document: OwnerDocument): boolean {
    return document.zone_binding_model_version === undefined;
}

export function defaultBoundZoneDid(document: OwnerDocument): string | null {
    return ownerBoundZoneDids(document)[0] ?? null;
}

export async function resolveOwnerUnbindTarget(
    document: OwnerDocument,
    requestedZoneDid: string | null,
    legacySameNameZoneExists: () => Promise<boolean>
): Promise<string | null> {
    const zones = ownerBoundZoneDids(document);
    const requested = requestedZoneDid?.trim() || null;
    if (requested && zones.includes(requested)) return requested;
    if (requested && zones.length > 0) throw new Error("zone_binding_changed");
    if (!requested && zones.length > 0) return zones[0];
    if (!isLegacyOwnerZoneBinding(document)) return null;
    if (!document.id.startsWith("did:bns:")) throw new Error("unsupported_owner_did");
    if (requested && requested !== document.id) throw new Error("zone_binding_changed");
    return await legacySameNameZoneExists() ? document.id : null;
}

export function ownerAuthenticationKeyId(document: OwnerDocument): string {
    const keyId = document.authentication?.find((value) => typeof value === "string" && value.trim());
    if (!keyId) throw new Error("owner_authentication_key_missing");
    return keyId;
}

export async function createOwnerUnbindRequestId(
    name: string,
    zoneDid: string,
    expectedOwnerHash: string
): Promise<string> {
    const intent = `${name.trim().toLowerCase()}\u0000${zoneDid.trim()}\u0000${expectedOwnerHash}`;
    return `owner-unbind:${await sha256Hex(new TextEncoder().encode(intent))}`;
}

export function buildOwnerRemoveBoundZoneClaims(input: {
    name: string;
    zoneDid: string;
    expectedOwnerHash: string;
    requestId: string;
    nowSeconds?: number;
}): OwnerRemoveBoundZoneClaims {
    const name = input.name.trim().toLowerCase();
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    return {
        sub: `did:bns:${name}`,
        aud: OWNER_REMOVE_BOUND_ZONE_AUDIENCE,
        operation: OWNER_REMOVE_BOUND_ZONE_OPERATION,
        name,
        zone_did: input.zoneDid,
        expected_owner_hash: input.expectedOwnerHash,
        request_id: input.requestId,
        iat: now,
        exp: now + OWNER_AUTHORIZATION_TTL_SECONDS,
    };
}

export async function waitForOwnerZoneUnbound(
    name: string,
    zoneDid: string,
    expectedOwnerHash: string,
    options: {
        timeoutMs?: number;
        intervalMs?: number;
        resolveOwner?: (name: string) => Promise<ResolvedBnsOwnerDocument>;
        sleep?: (milliseconds: number) => Promise<void>;
        now?: () => number;
    } = {}
): Promise<ResolvedBnsOwnerDocument> {
    const timeoutMs = options.timeoutMs ?? OWNER_UNBIND_CONFIRM_TIMEOUT_MS;
    const intervalMs = options.intervalMs ?? OWNER_UNBIND_CONFIRM_INTERVAL_MS;
    const resolveOwner = options.resolveOwner ?? resolveBnsOwnerDocument;
    const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const now = options.now ?? Date.now;
    const deadline = now() + timeoutMs;

    for (;;) {
        try {
            const resolved = await resolveOwner(name);
            const hash = await canonicalOwnerDocumentHash(resolved.document);
            if (hash === expectedOwnerHash && !ownerBoundZoneDids(resolved.document).includes(zoneDid)) {
                return resolved;
            }
        } catch (error) {
            console.warn("[BNS] owner unlink confirmation read failed", error);
        }
        if (now() >= deadline) throw new Error("sn_unbind_timeout");
        await sleep(intervalMs);
    }
}
