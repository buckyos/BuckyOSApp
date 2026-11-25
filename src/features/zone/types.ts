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
