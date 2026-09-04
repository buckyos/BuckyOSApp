import { describe, expect, it, vi } from "vitest";
import type { OwnerDocument } from "./types";
import {
    buildOwnerRemoveBoundZoneClaims,
    canonicalOwnerDocumentHash,
    createOwnerUnbindRequestId,
    defaultBoundZoneDid,
    isLegacyOwnerZoneBinding,
    ownerAuthenticationKeyId,
    ownerBoundZoneDids,
    resolveOwnerUnbindTarget,
    waitForOwnerZoneUnbound,
} from "./ownerZoneBinding";

function owner(overrides: Partial<OwnerDocument> = {}): OwnerDocument {
    return {
        "@context": "https://www.w3.org/ns/did/v1",
        id: "did:bns:alice",
        verificationMethod: [{
            type: "Ed25519VerificationKey2020",
            id: "#main_key",
            controller: "did:bns:alice",
            publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: "x" },
        }],
        authentication: ["#main_key"],
        exp: 2,
        iat: 1,
        name: "alice",
        display_name: "Alice",
        avatar: "dicebear:alice",
        wallets: {},
        zone_binding_model_version: 2,
        binded_zone_list: ["did:web:home.example", "did:bns:alice"],
        ...overrides,
    };
}

describe("OwnerDocument zone unlink contract", () => {
    it("uses the first explicit zone, preserves order, and rejects future models", () => {
        const document = owner();
        expect(defaultBoundZoneDid(document)).toBe("did:web:home.example");
        expect(isLegacyOwnerZoneBinding(document)).toBe(false);
        expect(isLegacyOwnerZoneBinding(owner({ zone_binding_model_version: undefined }))).toBe(true);
        expect(ownerBoundZoneDids(document)).toEqual(["did:web:home.example", "did:bns:alice"]);
        expect(() => ownerBoundZoneDids(owner({ zone_binding_model_version: 3 }))).toThrow(
            "unsupported_zone_binding_model_version"
        );
    });

    it("infers a same-name target only for a confirmed legacy candidate", async () => {
        const legacyLookup = vi.fn().mockResolvedValue(true);
        await expect(resolveOwnerUnbindTarget(
            owner({ zone_binding_model_version: undefined, binded_zone_list: [] }),
            "did:bns:alice",
            legacyLookup
        )).resolves.toBe("did:bns:alice");
        expect(legacyLookup).toHaveBeenCalledOnce();

        const v2Lookup = vi.fn().mockResolvedValue(true);
        await expect(resolveOwnerUnbindTarget(
            owner({ zone_binding_model_version: 2, binded_zone_list: [] }),
            "did:bns:alice",
            v2Lookup
        )).resolves.toBeNull();
        expect(v2Lookup).not.toHaveBeenCalled();
    });

    it("honors an explicitly selected non-default zone and rejects a stale selection", async () => {
        const legacyLookup = vi.fn().mockResolvedValue(false);
        await expect(resolveOwnerUnbindTarget(
            owner(),
            "did:bns:alice",
            legacyLookup
        )).resolves.toBe("did:bns:alice");
        await expect(resolveOwnerUnbindTarget(
            owner(),
            "did:web:missing.example",
            legacyLookup
        )).rejects.toThrow("zone_binding_changed");
        expect(legacyLookup).not.toHaveBeenCalled();
    });

    it("matches the gateway canonical JSON SHA-256 fixture", async () => {
        const document = { z: 0, nested: { b: 2, a: 1 }, a: 1 } as unknown as OwnerDocument;
        await expect(canonicalOwnerDocumentHash(document)).resolves.toBe(
            "sha256:de6d5837bffbabc0142195f05912acbede00bea67f857e37633d8da8281bd9ba"
        );
        await expect(canonicalOwnerDocumentHash({ "2": 2, "10": 10 } as unknown as OwnerDocument)).resolves.toBe(
            "sha256:5355e5c9c48ddb40379a8a11e74e08cf4c2a364f10bf4b2324e32d5d20489385"
        );
        await expect(canonicalOwnerDocumentHash({
            numbers: [333333333.33333329, 1e30, 4.50, 2e-3, 1e-27],
        } as unknown as OwnerDocument)).resolves.toBe(
            "sha256:7c892d3452ad85ad65857a43e8dcac93b79475d2334fc3e85bac5c599142c158"
        );
        await expect(canonicalOwnerDocumentHash({
            small: 0.000001,
            large: 1e20,
        } as unknown as OwnerDocument)).resolves.toBe(
            "sha256:ce6cb4ba83bb705700ff9761d727f1f32126cbe558abb6ac4ecd2597234b628a"
        );
    });

    it("binds every compare-and-swap field into a five-minute owner JWT", async () => {
        const ownerHash = `sha256:${"a".repeat(64)}`;
        const requestId = await createOwnerUnbindRequestId("Alice", "did:web:home.example", ownerHash);
        await expect(createOwnerUnbindRequestId("alice", "did:web:home.example", ownerHash)).resolves.toBe(requestId);
        expect(requestId).toMatch(/^owner-unbind:[0-9a-f]{64}$/);
        expect(ownerAuthenticationKeyId(owner())).toBe("#main_key");
        expect(buildOwnerRemoveBoundZoneClaims({
            name: "Alice",
            zoneDid: "did:web:home.example",
            expectedOwnerHash: ownerHash,
            requestId,
            nowSeconds: 100,
        })).toEqual({
            sub: "did:bns:alice",
            aud: "sn-bns-proxy",
            operation: "owner.remove_bound_zone",
            name: "alice",
            zone_did: "did:web:home.example",
            expected_owner_hash: ownerHash,
            request_id: requestId,
            iat: 100,
            exp: 400,
        });
    });

    it("does not confirm until BNS returns the exact result hash without the target zone", async () => {
        const source = owner();
        const result = owner({ binded_zone_list: ["did:bns:alice"] });
        const resultHash = await canonicalOwnerDocumentHash(result);
        const resolveOwner = vi.fn()
            .mockResolvedValueOnce({ document: source, rawJson: "{}", version: 7 })
            .mockResolvedValueOnce({ document: result, rawJson: "{}", version: 8 });

        const confirmed = await waitForOwnerZoneUnbound(
            "alice",
            "did:web:home.example",
            resultHash,
            { resolveOwner, sleep: async () => undefined, now: () => 0 }
        );

        expect(resolveOwner).toHaveBeenCalledTimes(2);
        expect(confirmed.version).toBe(8);
    });

    it("times out while BNS still exposes the source owner document", async () => {
        const source = owner();
        const resolveOwner = vi.fn().mockResolvedValue({ document: source, rawJson: "{}", version: 7 });
        let elapsed = 0;

        await expect(waitForOwnerZoneUnbound(
            "alice",
            "did:web:home.example",
            `sha256:${"f".repeat(64)}`,
            {
                timeoutMs: 4,
                intervalMs: 2,
                resolveOwner,
                sleep: async (milliseconds) => { elapsed += milliseconds; },
                now: () => elapsed,
            }
        )).rejects.toThrow("sn_unbind_timeout");

        expect(resolveOwner).toHaveBeenCalledTimes(3);
    });
});
