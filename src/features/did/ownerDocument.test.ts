import { describe, expect, it } from "vitest";
import {
    avatarDisplayUrl,
    buildOwnerDocument,
    parseAvatar,
    serializeOwnerDocumentForRegistration,
    validateOwnerDocumentForRegistration,
} from "./ownerDocument";

const OWNER_KEY = {
    kty: "OKP" as const,
    crv: "Ed25519" as const,
    x: "TFCczaH036J93MRNk0bMMy5zpAha29uNOO7WgcWnrWo",
};
const EVM_ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

describe("OwnerDocument registration shape", () => {
    it("uses the WebSDK schema and contains only public identity data", () => {
        const document = buildOwnerDocument({
            normalizedName: "alice0001",
            displayName: "Alice Zhang",
            avatar: "dicebear:alice-avatar-01",
            ownerPublicJwk: OWNER_KEY,
            evmAddress: EVM_ADDRESS,
            now: 1_783_555_200,
        });
        const json = serializeOwnerDocumentForRegistration(document, EVM_ADDRESS);
        const roundTrip = JSON.parse(json);

        expect(roundTrip).toMatchObject({
            id: "did:bns:alice0001",
            name: "alice0001",
            display_name: "Alice Zhang",
            avatar: "dicebear:alice-avatar-01",
            iat: 1_783_555_200,
            version_seq: 0,
            wallets: { main: { type: "eth", address: EVM_ADDRESS } },
            verificationMethod: [{ publicKeyJwk: OWNER_KEY }],
        });
        expect(json).not.toContain("email");
        expect(json).not.toContain("private_key");
        expect(json).not.toContain("mnemonic");
    });

    it("rejects asset-owner mismatch and sensitive fields", () => {
        const document = buildOwnerDocument({
            normalizedName: "alice0001",
            displayName: "Alice Zhang",
            avatar: "dicebear:alice",
            ownerPublicJwk: OWNER_KEY,
            evmAddress: EVM_ADDRESS,
        });
        expect(() =>
            validateOwnerDocumentForRegistration(
                document,
                "0x1111111111111111111111111111111111111111"
            )
        ).toThrow("asset_owner_mismatch");

        document.email = "alice@example.com";
        expect(() => validateOwnerDocumentForRegistration(document, EVM_ADDRESS)).toThrow(
            "owner_document_contains_sensitive_data"
        );
    });
});

describe("avatar format", () => {
    it("parses method values and falls back for unknown renderers", () => {
        expect(parseAvatar("dicebear:alice")).toEqual({ method: "dicebear", value: "alice" });
        expect(parseAvatar("future:opaque-value")).toEqual({ method: "future", value: "opaque-value" });
        expect(avatarDisplayUrl("future:opaque-value")).toBeNull();
        expect(avatarDisplayUrl("dicebear:alice")).toContain("seed=alice");
    });
});
