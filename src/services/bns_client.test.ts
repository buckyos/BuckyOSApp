import { describe, expect, it } from "vitest";
import { buildOwnerDocument } from "../features/did/ownerDocument";
import type { RegistrationMaterial } from "../features/did/types";
import {
    findBnsIdentitiesForMaterialWithClient,
    queryAllNamesByAddressWithClient,
    resolveBnsOwnerDocumentWithClient,
    type BnsReadClient,
} from "./bns_client";

const EVM_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const OWNER_X = "TFCczaH036J93MRNk0bMMy5zpAha29uNOO7WgcWnrWo";
const material: RegistrationMaterial = {
    normalized_name: "imported",
    owner_did: "did:bns:imported",
    owner_public_jwk: { kty: "OKP", crv: "Ed25519", x: OWNER_X },
    owner_derivation: { index: 0, derivation_path: "m/9777'/0'/0'" },
    evm_address: EVM_ADDRESS,
    evm_derivation: { index: 0, derivation_path: "m/44'/60'/0'/0/0" },
};

function ownerBytes(name: string, x = OWNER_X): number[] {
    const document = buildOwnerDocument({
        normalizedName: name,
        displayName: name === "alice0001" ? "Alice" : "Bob",
        avatar: `dicebear:${name}`,
        ownerPublicJwk: { kty: "OKP", crv: "Ed25519", x },
        evmAddress: EVM_ADDRESS,
        now: 1_783_555_200,
    });
    return Array.from(new TextEncoder().encode(JSON.stringify(document)));
}

function clientFor(names: string[]): BnsReadClient {
    return {
        async queryNamesByAddress(_address, cursor) {
            if (names.length <= 1) return { names, next_cursor: null };
            if (cursor === null || cursor === undefined) {
                return { names: [names[0]], next_cursor: names[0] };
            }
            return { names: names.slice(1), next_cursor: null };
        },
        async resolveDocument(name) {
            return {
                document_state: {
                    document: {
                        storage_type: "inline",
                        inline_document: ownerBytes(
                            name,
                            name === "wrong0001" ? "QTDEn2PegzU07spmHCZaX-3vaDdX22U8kgBkK_IMTuE" : OWNER_X
                        ),
                    },
                },
            };
        },
    };
}

describe("BNS address recovery", () => {
    it("returns the exact inline OwnerDocument and projection version", async () => {
        const client = clientFor(["alice0001"]);
        const originalResolve = client.resolveDocument;
        client.resolveDocument = async (name, docType) => {
            const resolved = await originalResolve(name, docType);
            return { document_state: { ...resolved.document_state, version: 7 } };
        };

        const resolved = await resolveBnsOwnerDocumentWithClient(client, "Alice0001");

        expect(resolved.document.id).toBe("did:bns:alice0001");
        expect(resolved.version).toBe(7);
    });

    it("follows cursor pagination without taking only the first name", async () => {
        const client = clientFor(["alice0001", "bob00001"]);
        await expect(queryAllNamesByAddressWithClient(client, EVM_ADDRESS)).resolves.toEqual([
            "alice0001",
            "bob00001",
        ]);
    });

    it("supports zero, one, and multiple verified identities", async () => {
        await expect(findBnsIdentitiesForMaterialWithClient(clientFor([]), material)).resolves.toEqual([]);
        await expect(
            findBnsIdentitiesForMaterialWithClient(clientFor(["alice0001"]), material)
        ).resolves.toHaveLength(1);
        await expect(
            findBnsIdentitiesForMaterialWithClient(clientFor(["alice0001", "bob00001"]), material)
        ).resolves.toHaveLength(2);
    });

    it("rejects an OwnerDocument whose owner key does not match", async () => {
        await expect(
            findBnsIdentitiesForMaterialWithClient(clientFor(["wrong0001"]), material)
        ).resolves.toEqual([]);
    });
});
