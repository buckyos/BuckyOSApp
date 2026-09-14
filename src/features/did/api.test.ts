import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { refreshOwnerDocument } from "./api";
import { buildOwnerDocument } from "./ownerDocument";
import type { DidInfo } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function identity(): DidInfo {
    return {
        id: "wallet-alice",
        nickname: "Alice",
        btc_addresses: [],
        eth_addresses: [],
        bucky_wallets: [],
        owner_document: buildOwnerDocument({
            normalizedName: "alice",
            displayName: "Alice",
            avatar: "dicebear:alice",
            ownerPublicJwk: { kty: "OKP", crv: "Ed25519", x: "TFCczaH036J93MRNk0bMMy5zpAha29uNOO7WgcWnrWo" },
            evmAddress: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
            now: 1_783_555_200,
        }),
    };
}

describe("OwnerDocument reads", () => {
    beforeEach(() => vi.mocked(invoke).mockReset());

    it("consults the TTL-aware native resolver on every read instead of reusing the wallet snapshot", async () => {
        const stale = identity();
        stale.owner_document!.binded_zone_list = ["did:web:home.example"];
        const unbound = { ...stale.owner_document!, iat: stale.owner_document!.iat + 1, binded_zone_list: [] };
        const updated = { ...stale, owner_document: unbound };
        vi.mocked(invoke)
            .mockResolvedValueOnce({ type: "json", value: unbound })
            .mockResolvedValueOnce(updated)
            .mockResolvedValueOnce({ type: "json", value: unbound })
            .mockResolvedValueOnce(updated);

        await expect(refreshOwnerDocument(stale)).resolves.toEqual(updated);
        await expect(refreshOwnerDocument(stale)).resolves.toEqual(updated);
        expect(invoke).toHaveBeenNthCalledWith(1, "resolve_did", { did: "did:bns:alice", docType: "owner" });
        expect(invoke).toHaveBeenNthCalledWith(3, "resolve_did", { did: "did:bns:alice", docType: "owner" });
        expect(invoke).toHaveBeenNthCalledWith(2, "update_owner_document", {
            didId: stale.id,
            ownerDocumentJson: JSON.stringify(unbound),
        });
        expect(stale.owner_document!.binded_zone_list).toEqual(["did:web:home.example"]);
    });

    it("does not publish or return the stale wallet document when resolution fails", async () => {
        vi.mocked(invoke).mockRejectedValueOnce(new Error("resolve_did_not_found"));
        await expect(refreshOwnerDocument(identity())).rejects.toThrow("resolve_did_not_found");
        expect(invoke).toHaveBeenCalledTimes(1);
    });

    it("rejects a resolved document for another identity before persisting it", async () => {
        vi.mocked(invoke).mockResolvedValueOnce({ type: "json", value: { id: "did:bns:bob" } });
        await expect(refreshOwnerDocument(identity())).rejects.toThrow("invalid_owner_document_identity");
        expect(invoke).toHaveBeenCalledTimes(1);
    });
});
