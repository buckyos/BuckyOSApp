import { beforeEach, describe, expect, it, vi } from "vitest";
import { bnsDocumentExists, resolveBnsOwnerDocument } from "../../services/bns_client";
import {
    getLastZoneBindingStatus,
    resolveZoneBindingSnapshot,
    resolveZoneBindingStatus,
    setLastZoneBindingStatus,
} from "./zoneBindingStatus";

vi.mock("../../services/bns_client", () => ({
    bnsDocumentExists: vi.fn(),
    resolveBnsOwnerDocument: vi.fn(),
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
        vi.mocked(resolveBnsOwnerDocument).mockReset();
        vi.mocked(bnsDocumentExists).mockReset();
        setLastZoneBindingStatus(currentUserDid, false);
    });

    it("records an OwnerDocument with an explicit bound zone as bound", async () => {
        vi.mocked(resolveBnsOwnerDocument).mockResolvedValue({
            document: { binded_zone_list: [currentUserDid], zone_binding_model_version: 2 } as never,
            rawJson: "{}",
            version: 1,
        });

        await expect(resolveZoneBindingStatus(currentUserDid)).resolves.toBe(true);
        expect(resolveBnsOwnerDocument).toHaveBeenCalledWith("alice");
        expect(getLastZoneBindingStatus(currentUserDid)).toBe(true);
        await expect(resolveZoneBindingSnapshot(currentUserDid)).resolves.toMatchObject({
            isBound: true,
            zoneDids: [currentUserDid],
            legacy: false,
        });
    });

    it("records an explicit v2 unbound OwnerDocument as not bound", async () => {
        vi.mocked(resolveBnsOwnerDocument).mockResolvedValue({
            document: { binded_zone_list: [], zone_binding_model_version: 2 } as never,
            rawJson: "{}",
            version: 2,
        });

        await expect(resolveZoneBindingStatus(currentUserDid)).resolves.toBe(false);
        expect(getLastZoneBindingStatus(currentUserDid)).toBe(false);
        expect(bnsDocumentExists).not.toHaveBeenCalled();
    });

    it("recognizes only a legacy same-name ZoneDocument as an implicit binding candidate", async () => {
        vi.mocked(resolveBnsOwnerDocument).mockResolvedValue({
            document: { id: currentUserDid, binded_zone_list: [] } as never,
            rawJson: "{}",
            version: 1,
        });
        vi.mocked(bnsDocumentExists).mockResolvedValue(true);

        await expect(resolveZoneBindingStatus(currentUserDid)).resolves.toBe(true);
        expect(bnsDocumentExists).toHaveBeenCalledWith("alice", "zone");
    });

    it("uses the last result when resolution fails without a not-found response", async () => {
        setLastZoneBindingStatus(currentUserDid, true);
        vi.mocked(resolveBnsOwnerDocument).mockRejectedValue(new Error("network unavailable"));

        await expect(resolveZoneBindingStatus(currentUserDid)).resolves.toBe(true);
        expect(getLastZoneBindingStatus(currentUserDid)).toBe(true);
    });
});

