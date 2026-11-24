import { describe, expect, it, vi } from "vitest";
import { resolveOwnerZones, zoneHostOfDocument } from "./ownerZones";

vi.mock("../did/api", () => ({ resolveDid: vi.fn() }));
vi.mock("../did/zoneBindingStatus", () => ({ resolveZoneBindingSnapshot: vi.fn() }));

describe("the owner's Zones", () => {
    it("takes only a plain host of the document that is the Zone's own", () => {
        expect(zoneHostOfDocument({ id: "did:bns:a", hostname: "A.example." }, "did:bns:a")).toBe("a.example");
        expect(zoneHostOfDocument({ id: "did:bns:b", hostname: "a.example" }, "did:bns:a")).toBeNull();
        expect(zoneHostOfDocument({ id: "did:bns:a", hostname: "a.example/x" }, "did:bns:a")).toBeNull();
        expect(zoneHostOfDocument({ id: "did:bns:a", hostname: "user@a.example" }, "did:bns:a")).toBeNull();
        expect(zoneHostOfDocument(null, "did:bns:a")).toBeNull();
    });

    it("answers null rather than a shorter list when something could not be read", async () => {
        const bound = { isBound: true, zoneDids: ["did:bns:a", "did:bns:b"], legacy: false };
        expect(await resolveOwnerZones("did:bns:me", { snapshot: async () => null, host: async () => "x" })).toBeNull();
        expect(
            await resolveOwnerZones("did:bns:me", { snapshot: async () => ({ ...bound, zoneDids: [] }), host: async () => "x" })
        ).toBeNull();
        expect(
            await resolveOwnerZones("did:bns:me", {
                snapshot: async () => bound,
                host: async (did) => (did === "did:bns:b" ? Promise.reject(new Error("down")) : "a.example"),
            })
        ).toBeNull();
        expect(
            await resolveOwnerZones("did:bns:me", { snapshot: async () => bound, host: async (did) => `${did.slice(-1)}.example` })
        ).toEqual([
            { did: "did:bns:a", host: "a.example" },
            { did: "did:bns:b", host: "b.example" },
        ]);
        expect(
            await resolveOwnerZones("did:bns:me", { snapshot: async () => ({ isBound: false, zoneDids: [], legacy: false }), host: async () => "x" })
        ).toEqual([]);
    });
});
