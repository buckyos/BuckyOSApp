import { describe, expect, it } from "vitest";
import { sessionLabelKey, sessionNotice, sessionTone, signInName } from "./sessionView";
import type { SessionState, SessionStatus } from "./types";

const session = (state: SessionState, reason: string | null = null): SessionStatus => ({ state, reason, username: null, identity: null });

describe("a Zone's session on screen", () => {
    it("says nothing when signed in", () => {
        expect(sessionNotice(session("signed_in"))).toBeNull();
        expect(sessionTone(session("signed_in"))).toBe("ok");
    });

    it("offers to sign in or to try again", () => {
        expect(sessionNotice(session("need_password"))?.action).toBe("sign_in");
        expect(sessionNotice(session("need_password", "no_password"))?.key).toBe("zones.notice.no_password");
        expect(sessionNotice(session("signed_out"))?.action).toBe("sign_in");
        expect(sessionNotice(session("offline"))?.action).toBe("retry");
        expect(sessionNotice(session("offline", "clock"))?.key).toBe("zones.notice.clock");
        expect(sessionNotice(session("signing_in"))?.action).toBeUndefined();
    });

    it("names a wrong clock rather than a lost connection", () => {
        expect(sessionLabelKey(session("offline"))).toBe("zones.state.offline");
        expect(sessionLabelKey(session("offline", "clock"))).toBe("zones.state.clock");
    });

    it("fills in the account's own name only for its own Zone", () => {
        expect(signInName({ source: "owner", session: session("signed_out") }, "alice")).toBe("alice");
        expect(signInName({ source: "manual", session: session("signed_out") }, "alice")).toBe("");
        expect(signInName({ source: "manual", session: { ...session("need_password"), username: "guest" } }, "alice")).toBe("guest");
    });
});
