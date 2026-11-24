import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const { activationUrl, candidateIps, deviceAddress, mergeDevices, probeThisDevice, scanTargets } = await import("./scan");
type DeviceRecord = import("./scan").DeviceRecord;

const device = (ip: string, extra: Partial<DeviceRecord> = {}): DeviceRecord => ({ ip, hostname: "ood1", device_type: "ood", active_url: "/index.html", ...extra });

describe("finding devices", () => {
    it("leaves out loopback and, when there is another, container networks", () => {
        expect(candidateIps(["127.0.0.1", "172.17.0.1", "192.168.1.8", "fe80::1"])).toEqual(["192.168.1.8"]);
        expect(candidateIps(["172.17.0.1"])).toEqual(["172.17.0.1"]);
        expect(candidateIps([])).toEqual([]);
    });

    it("scans each network once, this device's own addresses first", () => {
        const targets = scanTargets(["192.168.1.8", "192.168.1.9", "10.0.0.2"]);
        expect(targets.slice(0, 3)).toEqual(["192.168.1.8", "192.168.1.9", "10.0.0.2"]);
        expect(targets).toHaveLength(508);
        expect(new Set(targets).size).toBe(508);
        expect(targets).toContain("192.168.1.254");
        expect(targets).not.toContain("192.168.1.255");
    });

    it("puts this device first and keeps its loopback address", () => {
        const own = new Set(["192.168.1.8"]);
        const local = device("127.0.0.1", { isSelf: true });
        let devices = mergeDevices([], [local], own);
        devices = mergeDevices(devices, [device("192.168.1.20", { hostname: "box" }), device("192.168.1.8")], own);
        expect(devices.map((found) => [found.ip, found.isSelf])).toEqual([
            ["127.0.0.1", true],
            ["192.168.1.20", false],
        ]);
        // Found on the network before the loopback answered.
        devices = mergeDevices(mergeDevices([], [device("192.168.1.20", { hostname: "box" }), device("192.168.1.8")], own), [local], own);
        expect(devices.map((found) => found.ip)).toEqual(["127.0.0.1", "192.168.1.20"]);
    });

    it("asks the loopback address for this device", async () => {
        invoke.mockResolvedValueOnce([device("127.0.0.1")]);
        expect((await probeThisDevice())?.isSelf).toBe(true);
        expect(invoke).toHaveBeenCalledWith("scan_device_batch", { ips: ["127.0.0.1"] });
        invoke.mockResolvedValueOnce([{ ip: "127.0.0.1", active_url: " " }]);
        expect(await probeThisDevice()).toBeNull();
        invoke.mockRejectedValueOnce(new Error("no network"));
        expect(await probeThisDevice()).toBeNull();
    });

    it("builds the activation address", () => {
        expect(activationUrl(device("127.0.0.1", { display_ip: "192.168.1.8" }), "zh")).toBe("http://127.0.0.1:3182/index.html?lang=zh");
        expect(activationUrl(device("10.0.0.2", { display_ip: "192.168.1.20", active_url: "a?x=1" }), "en")).toBe("http://192.168.1.20:3182/a?x=1&lang=en");
        expect(activationUrl(device("10.0.0.2", { active_url: "http://box.local:8080/#go" }), "en")).toBe("http://box.local:8080/?lang=en#go");
        expect(activationUrl(device("10.0.0.2", { active_url: "" }), "en")).toBeNull();
    });

    it("does not show a loopback address", () => {
        expect(deviceAddress(device("127.0.0.1"))).toBe("");
        expect(deviceAddress(device("127.0.0.1", { display_ip: "192.168.1.8" }))).toBe("192.168.1.8");
        expect(deviceAddress(device("10.0.0.2"))).toBe("10.0.0.2");
    });
});
