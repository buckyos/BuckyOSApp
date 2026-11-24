import type { ZoneView } from "../zone/types";

/** How often the owner document is read again while an activation page is open. */
export const ACTIVATION_POLL_MS = 5000;
/** The owner document may take a while to change after the page was closed. */
export const ACTIVATION_AFTER_CLOSE_MS = 120_000;
export const ACTIVATION_LIMIT_MS = 60 * 60_000;

export interface ActivationSession {
    startedAt: number;
    /** The owner's Zones when the page was opened. */
    before: ReadonlySet<string>;
    closedAt: number | null;
}

/** The Zone the activation added, once the owner document lists it. */
export function activatedZone(session: ActivationSession, zones: readonly Pick<ZoneView, "did" | "source">[]): string | null {
    return zones.find((zone) => zone.source === "owner" && !session.before.has(zone.did))?.did ?? null;
}

export function activationOver(session: ActivationSession, now: number): boolean {
    if (now - session.startedAt > ACTIVATION_LIMIT_MS) return true;
    return session.closedAt !== null && now - session.closedAt > ACTIVATION_AFTER_CLOSE_MS;
}
