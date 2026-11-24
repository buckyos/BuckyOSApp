import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
const { normalizeRemoteAddress, resolveActiveUrl } = await import("./remoteDevice");

describe("a device by its address", () => {
    it("takes a host and an optional port", () => {
        expect(normalizeRemoteAddress("http://", " example.com ")).toMatchObject({ ok: true, baseUrl: "http://example.com:3182" });
        expect(normalizeRemoteAddress("https://", "192.168.1.10:8443")).toMatchObject({ ok: true, baseUrl: "https://192.168.1.10:8443", port: 8443 });
    });

    it("says what is wrong", () => {
        const key = (address: string) => {
            const result = normalizeRemoteAddress("http://", address);
            return result.ok ? null : result.errorKey;
        };
        expect(key("")).toBe("ood.remote_url_error_required");
        expect(key("http://example.com")).toBe("ood.remote_url_error_scheme_in_input");
        expect(key("example.com/device")).toBe("ood.remote_url_error_root_only");
        expect(key("a:b")).toBe("ood.remote_url_error_invalid");
        expect(key("-bad-.com")).toBe("ood.remote_url_error_invalid_host");
        expect(key("example.com:70000")).toBe("ood.remote_url_error_invalid_port");
    });

    it("opens only web addresses", () => {
        expect(resolveActiveUrl("http://a:3182", "index.html")).toBe("http://a:3182/index.html");
        expect(resolveActiveUrl("http://a:3182", "https://b/x")).toBe("https://b/x");
        expect(resolveActiveUrl("http://a:3182", "javascript:alert(1)")).toBe("");
    });
});
