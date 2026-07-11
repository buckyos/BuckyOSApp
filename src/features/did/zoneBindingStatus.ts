import { CommandErrorCodes } from "../../constants/commandErrorCodes";
import { parseCommandError } from "../../utils/commandError";
import { resolveDid } from "./api";

const STORAGE_KEY = "buckyos.zone-binding-status.v1";

type PersistedZoneBindingStatuses = Record<string, boolean>;

let cachedStatuses: PersistedZoneBindingStatuses | null = null;
const pendingResolutions = new Map<string, Promise<boolean | null>>();

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

// Call this from UI-facing flows only: every uncached invocation can access the network.
// A confirmed missing zone document means "not bound". Other failures (including an
// unavailable network) preserve and return the last successfully resolved status.
export function resolveZoneBindingStatus(currentUserDid: string): Promise<boolean | null> {
    const did = currentUserDid.trim();
    if (!did) return Promise.resolve(null);

    const pending = pendingResolutions.get(did);
    if (pending) return pending;

    const resolution = (async () => {
        try {
            await resolveDid(did, "zone");
            setLastZoneBindingStatus(did, true);
            return true;
        } catch (error) {
            const parsed = parseCommandError(error);
            if (parsed.code === CommandErrorCodes.NotFound) {
                setLastZoneBindingStatus(did, false);
                return false;
            }

            console.warn("[OOD] failed to resolve zone binding status; using last result", error);
            return getLastZoneBindingStatus(did);
        } finally {
            pendingResolutions.delete(did);
        }
    })();

    pendingResolutions.set(did, resolution);
    return resolution;
}

