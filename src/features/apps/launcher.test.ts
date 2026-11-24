import { describe, expect, it, vi } from "vitest";
import type { AppCatalog, AppEntry } from "./catalog";

vi.mock("../content/clientRuntime", () => ({ clientRuntime: { open: {} } }));
const { launcherEntries } = await import("./useCatalog");

const entry = (id: string, names: Record<string, string>, launcher = true): AppEntry => ({
    id,
    instance: id,
    names,
    name: names.en ?? id,
    icon: null,
    home: "/",
    host: "a.example",
    kind: "system",
    window: {} as AppEntry["window"],
    launcher,
});
const catalog: AppCatalog = {
    zone: "did:bns:a",
    zoneHost: "a.example",
    entries: [entry("messagehub", { en: "Message Hub", "zh-CN": "消息中心" }), entry("preview", { en: "Preview" }, false), entry("files", { en: "Files", "zh-CN": "文件" })],
    systemApps: "listed",
    readAt: 0,
};

describe("the launcher", () => {
    it("leaves out what is not to be launched and keeps the order", () => {
        expect(launcherEntries(catalog, "en").map((app) => app.id)).toEqual(["messagehub", "files"]);
    });

    it("searches names in every language and ids", () => {
        expect(launcherEntries(catalog, "en", " HUB ").map((app) => app.id)).toEqual(["messagehub"]);
        expect(launcherEntries(catalog, "en", "文件").map((app) => app.id)).toEqual(["files"]);
        expect(launcherEntries(catalog, "en", "prev")).toEqual([]);
        expect(launcherEntries(catalog, "en", "nothing")).toEqual([]);
    });
});
