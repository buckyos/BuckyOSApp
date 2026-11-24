import { describe, expect, it, vi } from "vitest";

vi.mock("../zone/channel", () => ({ zoneChannel: vi.fn() }));
const { formatGb, formatRate, formatUptime, meterColor, metricsFailure, percent } = await import("./metrics");

describe("the status card", () => {
    it("tells an older Zone from a failure", () => {
        expect(metricsFailure(new Error("Unknown method: system.metrics"))).toBe("unsupported");
        expect(metricsFailure(new Error("HTTP 404"))).toBe("unsupported");
        expect(metricsFailure(Object.assign(new Error("x"), { code: "access_denied" }))).toBe("denied");
        expect(metricsFailure(new Error("No permission"))).toBe("denied");
        expect(metricsFailure(new TypeError("error sending request"))).toBe("failed");
    });

    it("shows whole percentages", () => {
        expect(percent(12.4)).toBe(12);
        expect(percent(180)).toBe(100);
        expect(percent(-3)).toBe(0);
        expect(percent("x")).toBe(0);
        expect(percent(undefined)).toBe(0);
    });

    it("writes sizes, rates and times in the locale", () => {
        expect(formatGb(15.62, "en")).toBe("15.6 GB");
        expect(formatGb(465.8, "en")).toBe("466 GB");
        expect(formatGb(1862, "en")).toBe("1.8 TB");
        expect(formatRate(0, "en")).toBe("0 B/s");
        expect(formatRate(1536, "en")).toBe("1.5 KB/s");
        expect(formatRate(5 * 1024 * 1024, "en")).toBe("5 MB/s");
        expect(formatUptime(3 * 86_400 + 5, "en")).toBe("3 days");
        expect(formatUptime(7200, "en")).toBe("2 hours");
        expect(formatUptime(30, "en")).toBe("0 minutes");
    });

    it("warns when something is nearly full", () => {
        expect(meterColor(50)).not.toBe(meterColor(90));
        expect(meterColor(90)).not.toBe(meterColor(97));
    });
});
