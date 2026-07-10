import { namelib } from "buckyos";
import type { OwnerDocument, OwnerPublicJwk } from "./types";

export const OWNER_DOCUMENT_MAX_BYTES = 4 * 1024;

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const AVATAR_PATTERN = /^[a-z][a-z0-9_-]*:.+$/;
const SENSITIVE_FIELDS = new Set([
    "email",
    "mnemonic",
    "mnemonic_words",
    "private_key",
    "private_key_pem",
    "private_key_hex",
    "password",
    "pwd_hash",
    "password_hash",
    "active_code",
    "access_token",
    "refresh_token",
    "sn_token",
]);

export interface BuildOwnerDocumentOptions {
    normalizedName: string;
    displayName: string;
    avatar: string;
    ownerPublicJwk: OwnerPublicJwk;
    evmAddress: string;
    now?: number;
}

function containsSensitiveField(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(containsSensitiveField);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value as Record<string, unknown>).some(
        ([key, child]) => SENSITIVE_FIELDS.has(key.toLowerCase()) || containsSensitiveField(child)
    );
}

function isOwnerPublicJwk(value: unknown): value is OwnerPublicJwk {
    if (!value || typeof value !== "object") return false;
    const jwk = value as Record<string, unknown>;
    return (
        jwk.kty === "OKP" &&
        jwk.crv === "Ed25519" &&
        typeof jwk.x === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(jwk.x)
    );
}

export function parseAvatar(value: string): { method: string; value: string } | null {
    if (!AVATAR_PATTERN.test(value)) return null;
    const separator = value.indexOf(":");
    return { method: value.slice(0, separator), value: value.slice(separator + 1) };
}

export function avatarDisplayUrl(value: string): string | null {
    const parsed = parseAvatar(value);
    if (!parsed || parsed.method !== "dicebear") return null;
    return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(parsed.value)}`;
}

export function buildOwnerDocument(options: BuildOwnerDocumentOptions): OwnerDocument {
    const document = namelib.newOwnerDocument({
        did: `did:bns:${options.normalizedName}`,
        name: options.normalizedName,
        displayName: options.displayName,
        publicKeyJwk: options.ownerPublicJwk,
        now: options.now,
    });
    document.avatar = options.avatar;
    document.wallets = {
        main: {
            type: "eth",
            address: options.evmAddress,
        },
    };
    return document as OwnerDocument;
}

export function validateOwnerDocumentForRegistration(
    document: OwnerDocument,
    assetOwner: string
): void {
    const normalizedName = document.name.trim().toLowerCase();
    if (!normalizedName || document.name !== normalizedName || document.id !== `did:bns:${normalizedName}`) {
        throw new Error("invalid_owner_document_identity");
    }
    if (!document.display_name.trim()) throw new Error("owner_display_name_required");
    if (document.display_name.length > 256) throw new Error("owner_display_name_too_long");
    if (!parseAvatar(document.avatar) || document.avatar.length > 512) {
        throw new Error("invalid_owner_avatar");
    }

    const method = document.verificationMethod?.[0];
    if (
        !method ||
        method.type !== "Ed25519VerificationKey2020" ||
        method.id !== "#main_key" ||
        method.controller !== document.id ||
        !isOwnerPublicJwk(method.publicKeyJwk)
    ) {
        throw new Error("invalid_owner_public_key");
    }

    const wallet = document.wallets?.main;
    if (!wallet || wallet.type !== "eth" || !EVM_ADDRESS_PATTERN.test(wallet.address)) {
        throw new Error("invalid_owner_wallet");
    }
    if (!EVM_ADDRESS_PATTERN.test(assetOwner) || wallet.address.toLowerCase() !== assetOwner.toLowerCase()) {
        throw new Error("asset_owner_mismatch");
    }
    if (containsSensitiveField(document)) throw new Error("owner_document_contains_sensitive_data");
}

export function serializeOwnerDocumentForRegistration(
    document: OwnerDocument,
    assetOwner: string
): string {
    validateOwnerDocumentForRegistration(document, assetOwner);
    const json = JSON.stringify(document);
    if (new TextEncoder().encode(json).byteLength >= OWNER_DOCUMENT_MAX_BYTES) {
        throw new Error("owner_document_too_large");
    }
    return json;
}

export function getOwnerPublicKeyX(document: OwnerDocument): string | null {
    const jwk = document.verificationMethod?.[0]?.publicKeyJwk;
    return isOwnerPublicJwk(jwk) ? jwk.x : null;
}
