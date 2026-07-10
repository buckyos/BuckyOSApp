import { bns } from "buckyos";
import type { BnsIdentityCandidate, OwnerDocument, RegistrationMaterial } from "../features/did/types";
import {
    getOwnerPublicKeyX,
    OWNER_DOCUMENT_MAX_BYTES,
    validateOwnerDocumentForRegistration,
} from "../features/did/ownerDocument";
import { getServiceEndpoints } from "./endpoints";

const BNS_TIMEOUT_MS = 20_000;
const BNS_PAGE_SIZE = 100;

export interface BnsReadClient {
    queryNamesByAddress(address: string, cursor?: string | null, limit?: number): Promise<{
        names: string[];
        next_cursor: string | null;
    }>;
    resolveDocument(name: string, docType: string): Promise<{
        document_state: {
            document: {
                storage_type: string;
                inline_document: number[];
            };
        };
    }>;
}

function timeoutFetcher(timeoutMs: number) {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort("bns_import_timeout"), timeoutMs);
        try {
            return await fetch(input, { ...init, signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted) throw new Error("bns_import_timeout");
            throw error;
        } finally {
            clearTimeout(timer);
        }
    };
}

async function getBnsClient(): Promise<bns.BnsClient> {
    const endpoints = await getServiceEndpoints();
    return new bns.BnsClient(endpoints.bns_api_url, null, {
        fetcher: timeoutFetcher(BNS_TIMEOUT_MS),
    });
}

function decodeInlineOwnerDocument(bytes: number[]): { document: OwnerDocument; rawJson: string } {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid_owner_document");
    }
    return { document: parsed as OwnerDocument, rawJson: raw };
}

export async function queryAllNamesByAddress(evmAddress: string): Promise<string[]> {
    const client = await getBnsClient();
    return queryAllNamesByAddressWithClient(client, evmAddress);
}

export async function queryAllNamesByAddressWithClient(
    client: BnsReadClient,
    evmAddress: string
): Promise<string[]> {
    const names: string[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
        const page = await client.queryNamesByAddress(evmAddress, cursor, BNS_PAGE_SIZE);
        names.push(...page.names);
        cursor = page.next_cursor;
        if (cursor && seenCursors.has(cursor)) throw new Error("invalid_bns_pagination");
        if (cursor) seenCursors.add(cursor);
    } while (cursor !== null);
    return names;
}

export async function findBnsIdentitiesForMaterial(
    material: RegistrationMaterial
): Promise<BnsIdentityCandidate[]> {
    const client = await getBnsClient();
    return findBnsIdentitiesForMaterialWithClient(client, material);
}

export async function findBnsIdentitiesForMaterialWithClient(
    client: BnsReadClient,
    material: RegistrationMaterial
): Promise<BnsIdentityCandidate[]> {
    const names = await queryAllNamesByAddressWithClient(client, material.evm_address);
    const candidates: BnsIdentityCandidate[] = [];

    for (const name of names) {
        try {
            const resolved = await client.resolveDocument(name, "owner");
            const reference = resolved.document_state.document;
            if (reference.storage_type !== "inline" || reference.inline_document.length === 0) continue;
            const decoded = decodeInlineOwnerDocument(reference.inline_document);
            const ownerDocument = decoded.document;
            if (ownerDocument.name !== name || ownerDocument.id !== `did:bns:${name}`) continue;
            if (getOwnerPublicKeyX(ownerDocument) !== material.owner_public_jwk.x) continue;
            validateOwnerDocumentForRegistration(ownerDocument, material.evm_address);
            if (new TextEncoder().encode(decoded.rawJson).byteLength >= OWNER_DOCUMENT_MAX_BYTES) continue;
            const ownerDocumentJson = decoded.rawJson;
            candidates.push({ name, ownerDocument, ownerDocumentJson });
        } catch (error) {
            if (
                error instanceof bns.BnsClientError &&
                (error.kind === "transport" || error.kind === "timeout" || error.kind === "invalid_response")
            ) {
                throw error;
            }
            // A malformed or missing owner document invalidates only that BNS
            // candidate. Other names held by the same address must still be checked.
            console.warn("[BNS] skipped invalid owner document", {
                name,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return candidates;
}
