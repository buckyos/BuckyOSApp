import { describe, expect, it } from "vitest";
import { ACTIVATION_AFTER_CLOSE_MS, ACTIVATION_LIMIT_MS, activatedZone, activationOver, type ActivationSession } from "./activation";

const session: ActivationSession = { startedAt: 1000, before: new Set(["did:bns:old"]), closedAt: null };
const zone = (did: string, source: "owner" | "manual" = "owner") => ({ did, source });

describe("after an activation page was opened", () => {
    it("finds the Zone that is new in the owner document", () => {
        expect(activatedZone(session, [zone("did:bns:old")])).toBeNull();
        expect(activatedZone(session, [zone("did:bns:old"), zone("did:bns:work", "manual")])).toBeNull();
        expect(activatedZone(session, [zone("did:bns:old"), zone("did:bns:new")])).toBe("did:bns:new");
    });

    it("keeps looking for a while after the page was closed", () => {
        expect(activationOver(session, 2000)).toBe(false);
        expect(activationOver(session, 1001 + ACTIVATION_LIMIT_MS)).toBe(true);
        expect(activationOver({ ...session, closedAt: 5000 }, 5000 + ACTIVATION_AFTER_CLOSE_MS)).toBe(false);
        expect(activationOver({ ...session, closedAt: 5000 }, 5001 + ACTIVATION_AFTER_CLOSE_MS)).toBe(true);
    });
});
