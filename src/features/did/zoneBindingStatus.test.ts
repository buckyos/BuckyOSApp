import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDid } from "./api";
import {
    getLastZoneBindingStatus,
    resolveZoneBindingStatus,
    setLastZoneBindingStatus,
} from "./zoneBindingStatus";

vi.mock("./api", () => ({
    resolveDid: vi.fn(),
}));

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
    },
});

describe("zoneBindingStatus", () => {
    const currentUserDid = "did:bns:alice";

    beforeEach(() => {
        vi.mocked(resolveDid).mockReset();
        setLastZoneBindingStatus(currentUserDid, false);
    });

    it("records a successfully resolved zone document as bound", async () => {
        vi.mocked(resolveDid).mockResolvedValue({ type: "jwt", jwt: "zone.jwt" });

        await expect(resolveZoneBindingStatus(currentUserDid)).resolves.toBe(true);
        expect(resolveDid).toHaveBeenCalledWith(currentUserDid, "zone");
        expect(getLastZoneBindingStatus(currentUserDid)).toBe(true);
    });

    it("records a confirmed missing zone document as not bound", async () => {
        vi.mocked(resolveDid).mockRejectedValue({ code: 1001, message: "zone not found" });

        await expect(resolveZoneBindingStatus(currentUserDid)).resolves.toBe(false);
        expect(getLastZoneBindingStatus(currentUserDid)).toBe(false);
    });

    it("uses the last result when resolution fails without a not-found response", async () => {
        setLastZoneBindingStatus(currentUserDid, true);
        vi.mocked(resolveDid).mockRejectedValue({ code: 1999, message: "network unavailable" });

        await expect(resolveZoneBindingStatus(currentUserDid)).resolves.toBe(true);
        expect(getLastZoneBindingStatus(currentUserDid)).toBe(true);
    });
});

