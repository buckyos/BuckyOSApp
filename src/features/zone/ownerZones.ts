import { namelib } from "buckyos";
import { resolveDid } from "../did/api";
import { resolveZoneBindingSnapshot } from "../did/zoneBindingStatus";
import type { OwnerZone } from "./types";

/** The host a Zone's own document names; never an address with a path, a port or credentials. */
export function zoneHostOfDocument(document: unknown, zoneDid: string): string | null {
    const value = document as { id?: unknown; hostname?: unknown } | null;
    if (!value || value.id !== zoneDid || typeof value.hostname !== "string") return null;
    const hostname = value.hostname.trim().replace(/\.$/, "").toLowerCase();
    if (!hostname || /[\s/?#@\\:]/.test(hostname)) return null;
    return hostname;
}

async function resolveZoneHost(zoneDid: string): Promise<string | null> {
    const encoded = await resolveDid(zoneDid, "zone");
    return zoneHostOfDocument(namelib.encodedDocumentToJsonValue(encoded), zoneDid);
}

/**
 * The Zones of an account's owner document. Null when the document, or the host of one of its
 * Zones, could not be read: a network failure must not take Zones off the list.
 */
export async function resolveOwnerZones(
    ownerDid: string,
    deps = { snapshot: resolveZoneBindingSnapshot, host: resolveZoneHost }
): Promise<OwnerZone[] | null> {
    const snapshot = await deps.snapshot(ownerDid);
    if (!snapshot || (snapshot.isBound && snapshot.zoneDids.length === 0)) return null;
    const zones: OwnerZone[] = [];
    for (const did of snapshot.zoneDids) {
        const host = await deps.host(did).catch((error) => {
            console.warn("[Zone] resolving a Zone failed", did, error);
            return null;
        });
        if (!host) return null;
        zones.push({ did, host });
    }
    return zones;
}
