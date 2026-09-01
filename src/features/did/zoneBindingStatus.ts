import { bnsDocumentExists, resolveBnsOwnerDocument } from "../../services/bns_client";
import { isLegacyOwnerZoneBinding, ownerBoundZoneDids } from "./ownerZoneBinding";

const STORAGE_KEY = "buckyos.zone-binding-status.v1";

type PersistedZoneBindingStatuses = Record<string, boolean>;

let cachedStatuses: PersistedZoneBindingStatuses | null = null;
const pendingResolutions = new Map<string, Promise<boolean | null>>();

export interface ZoneBindingSnapshot {
    isBound: boolean;
    zoneDids: string[];
    legacy: boolean;
}

function loadStatuses(): PersistedZoneBindingStatuses {
    if (cachedStatuses) return cachedStatuses;

    cachedStatuses = {};
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return cachedStatuses;

        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [did, status] of Object.entries(parsed)) {
            if (typeof status === "boolean") {
                cachedStatuses[did] = status;
            }
        }
    } catch (error) {
        console.warn("[OOD] failed to load cached zone binding statuses", error);
    }
    return cachedStatuses;
}

function persistStatuses(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loadStatuses()));
    } catch (error) {
        console.warn("[OOD] failed to persist zone binding status", error);
    }
}

export function getLastZoneBindingStatus(currentUserDid: string): boolean | null {
    const did = currentUserDid.trim();
    if (!did) return null;

    const status = loadStatuses()[did];
    return typeof status === "boolean" ? status : null;
}

export function setLastZoneBindingStatus(currentUserDid: string, status: boolean): void {
    const did = currentUserDid.trim();
    if (!did) return;

    loadStatuses()[did] = status;
    persistStatuses();
}

export async function resolveZoneBindingSnapshot(currentUserDid: string): Promise<ZoneBindingSnapshot | null> {
    const did = currentUserDid.trim();
    if (!did) return null;

    try {
        if (!did.startsWith("did:bns:")) throw new Error("unsupported_owner_did");
        const name = did.slice("did:bns:".length);
        const resolved = await resolveBnsOwnerDocument(name);
        const explicitZones = ownerBoundZoneDids(resolved.document);
        const legacy = isLegacyOwnerZoneBinding(resolved.document);
        const zoneDids = explicitZones.length > 0
            ? explicitZones
            : legacy && await bnsDocumentExists(name, "zone")
                ? [did]
                : [];
        setLastZoneBindingStatus(did, zoneDids.length > 0);
        return { isBound: zoneDids.length > 0, zoneDids, legacy };
    } catch (error) {
        console.warn("[OOD] failed to resolve zone binding status; using last result", error);
        const last = getLastZoneBindingStatus(did);
        return last === null ? null : { isBound: last, zoneDids: [], legacy: false };
    }
}

// Call this from UI-facing flows only: every uncached invocation can access the network.
// Other failures (including an unavailable network) preserve and return the last
// successfully resolved status.
export function resolveZoneBindingStatus(currentUserDid: string): Promise<boolean | null> {
    const did = currentUserDid.trim();
    if (!did) return Promise.resolve(null);

    const pending = pendingResolutions.get(did);
    if (pending) return pending;

    const resolution = (async () => {
        try {
            return (await resolveZoneBindingSnapshot(did))?.isBound ?? null;
        } finally {
            pendingResolutions.delete(did);
        }
    })();

    pendingResolutions.set(did, resolution);
    return resolution;
}

