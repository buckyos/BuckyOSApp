import { describe, expect, it } from "vitest";
import { sessionLabelKey, sessionNotice, sessionTone, signInName } from "./sessionView";
import type { SessionState, SessionStatus } from "./types";

const session = (state: SessionState, reason: string | null = null): SessionStatus => ({ state, reason, username: null, identity: null });
const zone = (state: SessionState, reason: string | null = null, signed_out = false) => ({ session: session(state, reason), signed_out });

describe("a Zone's session on screen", () => {
    it("says nothing when signed in", () => {
        expect(sessionNotice(zone("signed_in"))).toBeNull();
        expect(sessionTone(zone("signed_in"))).toBe("ok");
    });

    it("offers to sign in or to try again", () => {
        expect(sessionNotice(zone("need_password"))?.action).toBe("sign_in");
        expect(sessionNotice(zone("need_password", "no_password"))?.key).toBe("zones.notice.no_password");
        expect(sessionNotice(zone("signed_out"))?.action).toBe("sign_in");
        expect(sessionNotice(zone("offline"))?.action).toBe("retry");
        expect(sessionNotice(zone("offline", "clock"))?.key).toBe("zones.notice.clock");
        expect(sessionNotice(zone("signing_in"))?.action).toBeUndefined();
    });

    it("tells the user's own signing out from a password that is not there", () => {
        expect(sessionNotice(zone("signed_out", null, true))?.key).toBe("zones.notice.signed_out");
        expect(sessionLabelKey(zone("signed_out", null, true))).toBe("zones.state.signed_out");
        expect(sessionNotice(zone("signed_out"))?.key).toBe("zones.notice.need_password");
        expect(sessionLabelKey(zone("signed_out"))).toBe("zones.state.need_password");
        expect(sessionTone(zone("signed_out"))).toBe("warn");
    });

    it("names a wrong clock rather than a lost connection", () => {
        expect(sessionLabelKey(zone("offline"))).toBe("zones.state.offline");
        expect(sessionLabelKey(zone("offline", "clock"))).toBe("zones.state.clock");
    });

    it("fills in the account's own name only for its own Zone", () => {
        expect(signInName({ source: "owner", session: session("signed_out") }, "alice")).toBe("alice");
        expect(signInName({ source: "manual", session: session("signed_out") }, "alice")).toBe("");
        expect(signInName({ source: "manual", session: { ...session("need_password"), username: "guest" } }, "alice")).toBe("guest");
    });
});
