export type SessionState = "signed_out" | "signing_in" | "signed_in" | "need_password" | "offline";

export interface ZoneIdentity {
    user_id: string;
    did: string;
    show_name?: string | null;
    user_type?: string | null;
}

export interface SessionStatus {
    state: SessionState;
    username: string | null;
    identity: ZoneIdentity | null;
    /** Why the last sign-in did not work: `password`, `no_password`, `clock`, `denied`. */
    reason: string | null;
}

export type LineKind = "local" | "lan" | "internet";

/** A way to a Zone: the BuckyOS on this computer, a device in the same network, or over the internet. */
export interface Line {
    kind: LineKind;
    address?: string;
}

export type LineOutcome = "usable" | "expired" | "untrusted" | "refused" | "timeout" | "unreachable";

export interface LineAttempt extends Line {
    outcome: LineOutcome;
    detail: string;
}

export interface LineStatus {
    /** Null until the first try. */
    line: Line | null;
    /** The BuckyOS on this computer is the way and does not answer right now. */
    waiting: boolean;
    /** The last attempt over the internet failed. */
    unreachable: boolean;
    attempts: LineAttempt[];
    /** The end of the certificate's validity (Unix seconds), where it was seen. */
    cert_expires_at: number | null;
}

/** `internet`: never directly. */
export type LineMode = "auto" | "internet";

/** One Zone on the active account's list. */
export interface ZoneView {
    did: string;
    host: string;
    name: string | null;
    icon: string | null;
    /** The account's own accent color for this Zone (`#RRGGBB`), as last read. */
    accent: string | null;
    source: "owner" | "manual";
    notify: boolean;
    /** The user signed out, as opposed to a credential that is not there (any more). */
    signed_out: boolean;
    session: SessionStatus;
    line: LineStatus | null;
    route: { mode: LineMode };
}

export interface ZoneList {
    account: string | null;
    zones: ZoneView[];
    current: string | null;
}

export interface ZoneProbe {
    did: string;
    host: string;
    name: string | null;
    icon: string | null;
}

export interface OwnerZone {
    did: string;
    host: string;
}

export function zoneTitle(zone: Pick<ZoneView, "name" | "host">): string {
    return zone.name?.trim() || zone.host;
}
