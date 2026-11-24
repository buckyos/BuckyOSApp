import type { Tone } from "../../components/ui/States";
import { failureOfReason } from "./errors";
import type { SessionStatus, ZoneView } from "./types";

export function sessionTone(session: SessionStatus): Tone {
    switch (session.state) {
        case "signed_in":
            return "ok";
        case "signing_in":
            return "busy";
        case "need_password":
            return "warn";
        case "offline":
            return session.reason === "clock" ? "warn" : "bad";
        default:
            return "idle";
    }
}

/** The i18n key of a session's short state. */
export function sessionLabelKey(session: SessionStatus): string {
    if (session.state === "offline" && session.reason === "clock") return "zones.state.clock";
    return `zones.state.${session.state}`;
}

export type SessionAction = "sign_in" | "retry";

export interface SessionNotice {
    tone: Tone;
    /** i18n key; takes `{{zone}}`. */
    key: string;
    action?: SessionAction;
}

/** What a page says above its content while the Zone cannot be used; null when there is nothing to say. */
export function sessionNotice(session: SessionStatus): SessionNotice | null {
    switch (session.state) {
        case "need_password": {
            const reason = failureOfReason(session.reason);
            return {
                tone: "warn",
                key: reason === "no_password" || reason === "denied" ? `zones.notice.${reason}` : "zones.notice.need_password",
                action: "sign_in",
            };
        }
        case "offline":
            return session.reason === "clock"
                ? { tone: "warn", key: "zones.notice.clock", action: "retry" }
                : { tone: "bad", key: "zones.notice.offline", action: "retry" };
        case "signed_out":
            return { tone: "idle", key: "zones.notice.signed_out", action: "sign_in" };
        case "signing_in":
            return { tone: "busy", key: "zones.notice.signing_in" };
        default:
            return null;
    }
}

/** The user name the sign-in form starts with: the last one used, or the account's own name in its own Zone. */
export function signInName(zone: Pick<ZoneView, "source" | "session">, identityName: string): string {
    return zone.session.username?.trim() || (zone.source === "owner" ? identityName : "");
}
