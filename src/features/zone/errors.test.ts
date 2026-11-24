import { describe, expect, it } from "vitest";
import { failureOfReason, zoneFailureOf } from "./errors";

const error = (code: number, message: string) => ({ code, message });

describe("why a Zone could not be used", () => {
    it("tells the kinds of a failed command apart", () => {
        expect(zoneFailureOf(error(1402, "dns error"))).toBe("unreachable");
        expect(zoneFailureOf(error(1404, "invalid_zone_address"))).toBe("address");
        expect(zoneFailureOf(error(1404, "HTTP 404"))).toBe("not_zone");
        expect(zoneFailureOf(error(1404, "zone_host_mismatch"))).toBe("not_zone");
        expect(zoneFailureOf(error(1403, "password: RPC error: Invalid password"))).toBe("password");
        expect(zoneFailureOf(error(1403, "password: user info not found"))).toBe("password");
        expect(zoneFailureOf(error(1403, "no_password: access denied"))).toBe("no_password");
        expect(zoneFailureOf(error(1403, "clock: Invalid nonce"))).toBe("clock");
        expect(zoneFailureOf(error(1403, "access denied"))).toBe("denied");
        expect(zoneFailureOf(error(1403, "something new"))).toBe("failed");
        expect(zoneFailureOf(error(1401, "zone_need_password"))).toBe("password");
        expect(zoneFailureOf(new Error("boom"))).toBe("failed");
        expect(zoneFailureOf(error(1999, "did_not_found"))).toBe("address");
    });

    it("takes a session's own reason", () => {
        expect(failureOfReason("clock")).toBe("clock");
        expect(failureOfReason("no_password")).toBe("no_password");
        expect(failureOfReason(null)).toBeNull();
        expect(failureOfReason("other")).toBeNull();
    });
});
