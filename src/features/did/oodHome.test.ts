import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDid } from "./api";
import { resolveOodHomeUrl } from "./oodHome";

vi.mock("./api", () => ({ resolveDid: vi.fn() }));

describe("OOD home resolution", () => {
    const zoneDid = "did:bns:second-zone";
    beforeEach(() => { vi.mocked(resolveDid).mockReset(); });

    it("uses the selected zone's published access hostname", async () => {
        vi.mocked(resolveDid).mockResolvedValue({
            type: "json", value: { id: zoneDid, hostname: "second-zone.web3.example.com" },
        });
        await expect(resolveOodHomeUrl(zoneDid)).resolves.toBe("https://second-zone.web3.example.com/");
        expect(resolveDid).toHaveBeenCalledWith(zoneDid, "zone");
    });

    it("accepts a JWT-encoded zone document from the native resolver", async () => {
        const payload = btoa(JSON.stringify({ id: zoneDid, hostname: "home.example.com" }));
        vi.mocked(resolveDid).mockResolvedValue({ type: "jwt", jwt: `e30.${payload}.signature` });
        await expect(resolveOodHomeUrl(zoneDid)).resolves.toBe("https://home.example.com/");
    });

    it.each(["", "https://home.example.com", "home.example.com/active", "user@home.example.com", "home.example.com?next=evil", "home.example.com\\evil", "home example.com"])(
        "rejects malformed access hostname %j", async (hostname) => {
            vi.mocked(resolveDid).mockResolvedValue({ type: "json", value: { id: zoneDid, hostname } });
            await expect(resolveOodHomeUrl(zoneDid)).rejects.toThrow();
        },
    );

    it("rejects a document for a different zone", async () => {
        vi.mocked(resolveDid).mockResolvedValue({
            type: "json", value: { id: "did:bns:other-zone", hostname: "other.example.com" },
        });
        await expect(resolveOodHomeUrl(zoneDid)).rejects.toThrow("invalid_zone_home");
    });

    it("preserves resolution failures instead of guessing the owner's hostname", async () => {
        vi.mocked(resolveDid).mockRejectedValue(new Error("offline"));
        await expect(resolveOodHomeUrl(zoneDid)).rejects.toThrow("offline");
    });
});
