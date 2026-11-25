import { describe, expect, it } from "vitest";
import { certificateNotice, lineLabelKey, lineReasons, zoneStateKeys } from "./lineView";
import type { LineAttempt, LineStatus } from "./types";

const status = (patch: Partial<LineStatus>): { line: LineStatus } => ({
    line: { line: { kind: "local" }, waiting: false, unreachable: false, attempts: [], cert_expires_at: null, ...patch },
});
const attempt = (kind: LineAttempt["kind"], outcome: LineAttempt["outcome"], address?: string): LineAttempt => ({ kind, outcome, address, detail: "" });

describe("the way to a Zone", () => {
    it("is named, or why there is none", () => {
        expect(lineLabelKey({ line: null })).toBeNull();
        expect(lineLabelKey(status({ line: null }))).toBeNull();
        expect(lineLabelKey(status({}))).toBe("zones.line.local");
        expect(lineLabelKey(status({ waiting: true }))).toBe("zones.line.local_down");
        expect(lineLabelKey(status({ line: { kind: "lan", address: "192.168.1.8" } }))).toBe("zones.line.lan");
        expect(lineLabelKey(status({ line: { kind: "internet" } }))).toBe("zones.line.internet");
        expect(lineLabelKey(status({ line: { kind: "internet" }, unreachable: true }))).toBe("zones.line.none");
    });

    it("goes with the state of the session", () => {
        const session = (state: "signed_in" | "offline") => ({ session: { state, username: null, identity: null, reason: null }, signed_out: false });
        expect(zoneStateKeys({ ...session("signed_in"), ...status({}) })).toEqual(["zones.state.signed_in", "zones.line.local"]);
        expect(zoneStateKeys({ ...session("signed_in"), ...status({ waiting: true }) })).toEqual(["zones.line.local_down"]);
        expect(zoneStateKeys({ ...session("offline"), ...status({ unreachable: true, line: { kind: "internet" } }) })).toEqual(["zones.state.offline"]);
        expect(zoneStateKeys({ ...session("signed_in"), line: null })).toEqual(["zones.state.signed_in"]);
    });

    it("warns of a certificate that ends soon", () => {
        const now = 1_800_000_000_000;
        const ends = (days: number) => certificateNotice(status({ cert_expires_at: now / 1000 + days * 86_400 }), now);
        expect(certificateNotice(status({}), now)).toBeNull();
        expect(ends(8)).toBeNull();
        expect(ends(6.5)).toEqual({ key: "zones.notice.cert_ends", days: 7 });
        expect(ends(0.2)).toEqual({ key: "zones.notice.cert_ends", days: 1 });
        expect(ends(-1)).toEqual({ key: "zones.notice.cert_expired", days: 0 });
    });

    it("says what is wrong with each one", () => {
        const reasons = lineReasons([
            attempt("local", "refused"),
            attempt("lan", "timeout", "192.168.1.8"),
            attempt("lan", "expired", "192.168.1.9"),
            attempt("internet", "unreachable"),
        ]);
        expect(reasons.map(({ kind, ok, key, detail }) => [kind, ok, key, detail])).toEqual([
            ["local", false, "content.way.local_down", ""],
            ["lan", false, "content.way.expired", "192.168.1.9"],
            ["internet", false, "content.way.internet_none", ""],
        ]);
        expect(lineReasons([attempt("internet", "usable")])).toEqual([{ kind: "internet", ok: true, key: "content.way.usable", detail: "" }]);
        expect(lineReasons([attempt("local", "untrusted"), attempt("internet", "untrusted")]).map((reason) => reason.key)).toEqual([
            "content.way.local_other",
            "content.way.internet_untrusted",
        ]);
    });
});
