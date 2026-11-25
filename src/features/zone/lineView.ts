import { sessionLabelKey } from "./sessionView";
import type { LineAttempt, LineKind, LineOutcome, ZoneView } from "./types";

type Lined = Pick<ZoneView, "line">;

const DAY_S = 86_400;
const WARN_DAYS = 7;

/** The i18n key of the way a Zone is reached; null while nothing is known. */
export function lineLabelKey({ line }: Lined): string | null {
    if (!line?.line) return null;
    if (line.waiting) return "zones.line.local_down";
    if (line.unreachable) return "zones.line.none";
    return `zones.line.${line.line.kind}`;
}

/** What to say of a Zone in a few words: that it is connected and how, or what is wrong. */
export function zoneStateKeys(zone: Pick<ZoneView, "session" | "signed_out" | "line">): string[] {
    const line = zone.session.state === "signed_in" ? lineLabelKey(zone) : null;
    if (line && (zone.line?.waiting || zone.line?.unreachable)) return [line];
    return line ? [sessionLabelKey(zone), line] : [sessionLabelKey(zone)];
}

export interface CertificateNotice {
    key: "zones.notice.cert_expired" | "zones.notice.cert_ends";
    days: number;
}

/** Renewal needs the internet, and lasts a while; null while there is nothing to worry about. */
export function certificateNotice({ line }: Lined, nowMs: number = Date.now()): CertificateNotice | null {
    const end = line?.cert_expires_at;
    if (!end) return null;
    const left = end - nowMs / 1000;
    if (left <= 0) return { key: "zones.notice.cert_expired", days: 0 };
    if (left > WARN_DAYS * DAY_S) return null;
    return { key: "zones.notice.cert_ends", days: Math.max(1, Math.ceil(left / DAY_S)) };
}

export interface LineReason {
    kind: LineKind;
    ok: boolean;
    /** i18n key. */
    key: string;
    detail: string;
}

/** Of several addresses the one that says most. */
const TELLING: readonly LineOutcome[] = ["usable", "expired", "untrusted", "refused", "unreachable", "timeout"];

/** What is wrong with each way to a Zone, as a page that could not be opened says it. */
export function lineReasons(attempts: readonly LineAttempt[]): LineReason[] {
    const reasons: LineReason[] = [];
    for (const kind of ["local", "lan", "internet"] as const) {
        const tried = attempts.filter((attempt) => attempt.kind === kind);
        tried.sort((left, right) => TELLING.indexOf(left.outcome) - TELLING.indexOf(right.outcome));
        const told = tried[0];
        if (!told) continue;
        const ok = told.outcome === "usable";
        const detail = [told.address, told.detail].filter(Boolean).join(" ");
        reasons.push({ kind, ok, detail, key: ok ? "content.way.usable" : told.outcome === "expired" ? "content.way.expired" : reasonKey(kind, told.outcome) });
    }
    return reasons;
}

function reasonKey(kind: LineKind, outcome: LineOutcome): string {
    if (kind === "local") return outcome === "untrusted" ? "content.way.local_other" : "content.way.local_down";
    if (kind === "lan") return "content.way.lan_none";
    return outcome === "untrusted" ? "content.way.internet_untrusted" : "content.way.internet_none";
}
