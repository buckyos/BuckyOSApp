import { describe, expect, it } from "vitest";
import { buildOwnerDocument } from "../features/did/ownerDocument";
import {
    buildSnRegisterRequest,
    isLocallyValidEmail,
    snRegistrationErrorMessageKey,
} from "./sn_client";

describe("SN auth.register request", () => {
    it("contains the complete atomic registration contract", () => {
        const ownerDocument = buildOwnerDocument({
            normalizedName: "alice0001",
            displayName: "Alice Zhang",
            avatar: "dicebear:alice",
            ownerPublicJwk: {
                kty: "OKP",
                crv: "Ed25519",
                x: "TFCczaH036J93MRNk0bMMy5zpAha29uNOO7WgcWnrWo",
            },
            evmAddress: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
            now: 1_783_555_200,
        });
        const request = buildSnRegisterRequest({
            name: "alice0001",
            email: "alice@example.com",
            passwordHash: "hash",
            activeCode: " code ",
            requestId: "sn:register:alice0001",
            assetOwner: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
            ownerDocument,
        });

        expect(request).toEqual({
            name: "alice0001",
            email: "alice@example.com",
            pwd_hash: "hash",
            active_code: "code",
            request_id: "sn:register:alice0001",
            asset_owner: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
            owner_config: ownerDocument,
        });
        expect(request).not.toHaveProperty("initial_documents.owner");
        expect(request).not.toHaveProperty("public_key");
    });
});

describe("SN registration validation and errors", () => {
    it("rejects empty and malformed email locally", () => {
        expect(isLocallyValidEmail("")).toBe(false);
        expect(isLocallyValidEmail("not-an-email")).toBe(false);
        expect(isLocallyValidEmail(" alice@example.com ")).toBe(true);
    });

    it("maps email and BNS business errors to UI messages", () => {
        expect(snRegistrationErrorMessageKey("invalid_email")).toBe("sn.error.invalid_email");
        expect(snRegistrationErrorMessageKey("email_already_bound")).toBe(
            "sn.error.email_already_bound"
        );
        expect(snRegistrationErrorMessageKey("bns_write_failed")).toBe("sn.error.bns_write_failed");
    });
});
