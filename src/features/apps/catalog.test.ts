import { describe, expect, it } from "vitest";
import type { AppSummary } from "@buckyos-desktop/controlPanel/apps.ts";
import { appName, appOfUrl, buildCatalog, findApp, pagePath, pageUrl } from "./catalog";

const zone = { did: "did:bns:bob", host: "bob.example" };
const summary = (patch: Partial<Record<keyof AppSummary, unknown>>) =>
    ({
        app_id: "notes.example",
        app_instance_id: "notes.example@bob",
        runtime_type: "web",
        show_name: "Notes",
        web_hosts: ["notes"],
        enable: true,
        app_icon_url: "/icon.png",
        window: null,
        ...patch,
    }) as unknown as AppSummary;
const system = {
    version: 1,
    apps: [
        { id: "messagehub", names: { en: "Message Hub", zh: "消息" }, icon: "/system-apps/messagehub.svg", path: "/messagehub", window: { instance: "single" } },
        { id: "files", names: { en: "Files" }, path: "/app/files", window: { instance: "multi" } },
        { id: "users-agents", names: { en: "Users" }, path: "/app/users-agents", audience: "admin" },
        { id: "wide", names: { en: "Wide" }, path: "/app/wide", form_factors: ["desktop"] },
        { id: "evil", path: "//evil.example/x" },
    ],
};
const viewer = { formFactor: "desktop" as const, isAdmin: false };

describe("the app catalog of a Zone", () => {
    const catalog = buildCatalog(
        zone,
        [
            summary({}),
            summary({ app_instance_id: "notes.example@alice", web_hosts: ["notes-alice"] }),
            summary({ app_id: "svc", app_instance_id: "svc@bob", web_hosts: [] }),
            summary({ app_id: "agent", app_instance_id: "agent@bob", runtime_type: "agent" }),
        ],
        system,
        viewer
    );

    it("joins the system apps and what is installed", () => {
        expect(catalog.entries.map((entry) => entry.instance)).toEqual([
            "messagehub",
            "files",
            "wide",
            "notes.example@bob",
            "notes.example@alice",
        ]);
        expect(buildCatalog(zone, [], system, { formFactor: "mobile", isAdmin: true }).entries.map((entry) => entry.id)).toEqual([
            "messagehub",
            "files",
            "users-agents",
        ]);
    });

    it("still offers the pages an older Zone has", () => {
        const old = buildCatalog(zone, [], null, viewer);
        expect(old.systemApps).toBe("unavailable");
        expect(old.entries.map((entry) => entry.home)).toEqual(["/messagehub", "/homestation", "/workspace", "/taskcenter"]);
    });

    it("reads window declarations and images", () => {
        expect(findApp(catalog, "messagehub")?.window.instance).toBe("single");
        expect(findApp(catalog, "files")?.window.instance).toBe("multi");
        expect(findApp(catalog, "messagehub")?.icon).toBe("https://bob.example/system-apps/messagehub.svg");
        expect(findApp(catalog, "notes.example")?.icon).toBe("https://notes.bob.example/icon.png");
    });

    it("prefers the user's own instance", () => {
        expect(findApp(catalog, "notes.example", "alice")?.instance).toBe("notes.example@alice");
        expect(findApp(catalog, "notes.example@bob", "alice")?.instance).toBe("notes.example@bob");
        expect(findApp(catalog, "nope")).toBeUndefined();
    });

    it("keeps a page on the app's own origin", () => {
        const notes = findApp(catalog, "notes.example")!;
        expect(pageUrl(notes)).toBe("https://notes.bob.example/");
        expect(pageUrl(notes, "/a?b=1#c")).toBe("https://notes.bob.example/a?b=1#c");
        expect(pageUrl(notes, "//evil.example/")).toBe("https://notes.bob.example/");
        expect(pageUrl(notes, "https://evil.example/")).toBe("https://notes.bob.example/");
        const files = findApp(catalog, "files")!;
        expect(pageUrl(files)).toBe("https://bob.example/app/files");
        expect(pageUrl(files, "/recent?x=1")).toBe("https://bob.example/app/files/recent?x=1");
        expect(pageUrl(files, "/?path=%2Fa")).toBe("https://bob.example/app/files?path=%2Fa");
        expect(pageUrl(files, "/@evil.example/")).toBe("https://bob.example/app/files/@evil.example/");
    });

    it("reads a system page back as a path inside the app", () => {
        const files = findApp(catalog, "files")!;
        for (const path of ["/recent?x=1", "/?path=%2Fa", "/#top"]) {
            expect(pagePath(files, pageUrl(files, path).slice("https://bob.example".length))).toBe(path);
        }
        expect(pagePath(files, "/app/files")).toBe("/");
        expect(pagePath(findApp(catalog, "notes.example")!, "/a?b=1")).toBe("/a?b=1");
    });

    it("finds the app of a page", () => {
        expect(appOfUrl(catalog, new URL("https://notes-alice.bob.example/x?y=1"))).toMatchObject({ entry: { instance: "notes.example@alice" }, path: "/x?y=1" });
        expect(appOfUrl(catalog, new URL("https://bob.example/app/files/a"))).toMatchObject({ entry: { id: "files" }, path: "/a" });
        expect(appOfUrl(catalog, new URL("https://bob.example/messagehub?notify=1"))).toMatchObject({ entry: { id: "messagehub" }, path: "/?notify=1" });
        expect(appOfUrl(catalog, new URL("https://bob.example/messagehubs"))).toBeUndefined();
        expect(appOfUrl(catalog, new URL("https://unknown.bob.example/"))).toBeUndefined();
    });

    it("names an app in the viewer's language", () => {
        expect(appName(findApp(catalog, "messagehub")!, "zh")).toBe("消息");
        expect(appName(findApp(catalog, "files")!, "ja")).toBe("Files");
        const listed = buildCatalog(zone, [], { version: 1, apps: [{ id: "settings", names: { en: "Settings", "zh-CN": "设置", "zh-TW": "設定" }, path: "/app/settings" }] }, viewer);
        expect(appName(findApp(listed, "settings")!, "zh")).toBe("设置");
        expect(appName(findApp(listed, "settings")!, "zh-TW")).toBe("設定");
    });
});
