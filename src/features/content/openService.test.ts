import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildCatalog } from "../apps/catalog";
import type { ZoneView } from "../zone/types";
import { OpenService, type OpenServiceOptions } from "./openService";
import { OpenError, type OpenViewRequest, type ViewInfo } from "./types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const registry = vi.hoisted(() => ({ handlers: {} as Record<string, unknown> }));
vi.mock("../zone/channel", () => ({
    zoneChannel: () => ({}),
    zoneClients: () => ({
        contentRegistry: () => ({
            registry: { schema_version: 1, handlers: registry.handlers },
            defaults: { schema_version: 1, defaults: {}, disabled: [] },
            refresh: async () => undefined,
        }),
    }),
}));

const zoneView = (did: string, host: string, patch: Partial<ZoneView> = {}): ZoneView => ({
    did,
    host,
    name: null,
    icon: null,
    accent: "#112233",
    source: "manual",
    notify: true,
    signed_out: false,
    session: { state: "signed_in", username: "bob", identity: { user_id: "bob", did, user_type: "user" }, reason: null },
    ...patch,
});
const bob = zoneView("did:bns:bob", "bob.example");
const carol = zoneView("did:bns:carol", "carol.example");
const system = {
    version: 1,
    apps: [
        { id: "messagehub", names: { en: "Message Hub" }, path: "/messagehub", window: { instance: "single" } },
        { id: "task-center", names: { en: "Tasks" }, path: "/taskcenter", window: { instance: "single" } },
        { id: "preview", names: { en: "Preview" }, path: "/app/preview", window: { instance: "multi" } },
    ],
};
const installed = [
    { app_id: "notes", app_instance_id: "notes@bob", runtime_type: "web", show_name: "Notes", web_hosts: ["notes"], enable: true, app_icon_url: null, window: { instance: "multi" } },
    { app_id: "wiki", app_instance_id: "wiki@bob", runtime_type: "web", show_name: "Wiki", web_hosts: ["wiki"], enable: true, app_icon_url: null, window: null },
];

let views: ViewInfo[];
let opened: OpenViewRequest[];
let options: OpenServiceOptions;

function service(patch: Partial<OpenServiceOptions> = {}) {
    views = [];
    opened = [];
    options = {
        zones: () => [bob, carol],
        formFactor: "desktop",
        locale: () => "en",
        views: async () => views,
        openView: vi.fn(async (view: OpenViewRequest) => {
            const url = new URL(view.url);
            opened.push(view);
            const info: ViewInfo = {
                id: view.id,
                account: "did:bns:me",
                zone: view.zone,
                app: view.app,
                appInstance: view.appInstance,
                windowPath: view.windowPath,
                path: `${url.pathname}${url.search}`,
                title: view.title,
                lastActive: views.length + 1,
                focused: true,
                minimized: false,
            };
            views.push(info);
            return info;
        }),
        focusView: vi.fn(async (id: string) => views.find((view) => view.id === id)!),
        sendOpen: vi.fn(async () => "refused" as const),
        setLaunch: vi.fn(),
        choose: vi.fn(async () => null),
        readCatalog: async (zone) => buildCatalog(zone, zone.did === bob.did ? (installed as any) : [], system, { formFactor: "desktop", isAdmin: false }),
        ...patch,
    };
    return new OpenService(options);
}

beforeEach(() => {
    registry.handlers = {};
});

describe("opening", () => {
    it("makes one window for a single-window app and goes to pages in it", async () => {
        const open = service();
        await open.open({ zone: bob.did, app: "messagehub" });
        await open.open({ zone: bob.did, app: "messagehub", path: "/?notify=1" });
        await open.open({ zone: bob.did, app: "messagehub" });
        expect(opened).toHaveLength(1);
        expect(opened[0]).toMatchObject({ url: "https://bob.example/messagehub", zoneLabel: "bob.example", accent: "#112233", title: "Message Hub" });
        expect(options.focusView).toHaveBeenNthCalledWith(1, views[0].id, "https://bob.example/messagehub?notify=1");
        expect(options.focusView).toHaveBeenNthCalledWith(2, views[0].id, undefined);
    });

    it("keeps Zones apart", async () => {
        const open = service();
        await open.open({ zone: bob.did, app: "messagehub" });
        await open.open({ zone: carol.did, app: "messagehub" });
        expect(opened.map((view) => view.url)).toEqual(["https://bob.example/messagehub", "https://carol.example/messagehub"]);
        expect(new Set(opened.map((view) => view.id)).size).toBe(2);
    });

    it("reuses windows of a multi-window app by their path", async () => {
        const open = service();
        await open.open({ zone: bob.did, app: "notes", window: "a" });
        await open.open({ zone: bob.did, app: "notes", window: "b" });
        await open.open({ zone: bob.did, app: "notes", window: "a" });
        await open.open({ zone: bob.did, app: "notes", mode: "new" });
        expect(opened.map((view) => view.windowPath)).toEqual(["a", "b", ""]);
    });

    it("says why it cannot", async () => {
        const open = service();
        await expect(open.open({ zone: "did:bns:nobody", app: "x" })).rejects.toMatchObject({ reason: "zone_not_found" });
        await expect(open.open({ zone: bob.did, app: "nope" })).rejects.toMatchObject({ reason: "app_not_found", app: "nope" });
        const offline = service({ readCatalog: async () => Promise.reject(new Error("down")) });
        await expect(offline.open({ zone: bob.did, app: "notes" })).rejects.toBeInstanceOf(OpenError);
        await expect(offline.open({ zone: bob.did, app: "notes" })).rejects.toMatchObject({ reason: "unreachable" });
    });

    it("finds the app of a link", async () => {
        const open = service();
        await open.openLink("https://notes.bob.example/a?b=1");
        await open.openLink("https://bob.example/taskcenter?taskid=7");
        await open.openLink("buckyos://app.open?v=1&zone=carol.example&app=messagehub&path=%2F%3Fnotify%3D2");
        expect(opened.map((view) => view.url)).toEqual([
            "https://notes.bob.example/a?b=1",
            "https://bob.example/taskcenter?taskid=7",
            "https://carol.example/messagehub?notify=2",
        ]);
        await expect(open.openLink("https://evil.example/")).rejects.toMatchObject({ reason: "zone_not_found" });
        await expect(open.openLink("buckyos://sign.payload?v=1")).rejects.toMatchObject({ reason: "unsupported" });
    });

    it("takes a notification to the app's own page, else to its card", async () => {
        const open = service();
        const alert = (target: any) => ({ tag: "t", account: "did:bns:me", zone: bob.did, zoneLabel: "", title: "", body: "", level: "sound" as const, target, atMs: 0 });
        await open.openAlert(alert({ kind: "notify", notify_id: "nt-1", link: "https://wiki.bob.example/page" }));
        await open.openAlert(alert({ kind: "notify", notify_id: "nt-2", link: "https://evil.example/" }));
        await open.openAlert(alert({ kind: "notify", notify_id: "nt-3", link: null }));
        await open.openAlert(alert({ kind: "message", session_id: "dm:1", entity_id: "did:bns:x" }));
        await open.openAlert(alert({ kind: "task", task_id: "t1" }));
        expect(await open.openAlert(alert({ kind: "activity" }))).toBeNull();
        expect(opened.map((view) => view.url)).toEqual([
            "https://wiki.bob.example/page",
            "https://bob.example/messagehub?notify=nt-2",
            "https://bob.example/taskcenter?taskid=t1",
        ]);
        expect(options.focusView).toHaveBeenCalledWith(expect.any(String), "https://bob.example/messagehub?notify=nt-3");
        expect(options.focusView).toHaveBeenCalledWith(expect.any(String), "https://bob.example/messagehub?entityId=did%3Abns%3Ax&sessionId=dm%3A1");
    });

    it("asks a phone to enter the Zone first", async () => {
        const enterZone = vi.fn(async () => false);
        const open = service({ formFactor: "mobile", enterZone });
        await expect(open.open({ zone: carol.did, app: "messagehub" })).rejects.toMatchObject({ reason: "canceled" });
        expect(enterZone).toHaveBeenCalledWith(carol.did);
        expect(opened).toHaveLength(0);
    });
});

describe("opening content", () => {
    const source = { kind: "cyfs-path" as const, path: "cyfs:///home/bob/a.txt" };
    const handler = (window: "reuse" | "new") => ({
        provider: "app",
        app_instance_id: "notes@bob",
        handler_id: "edit",
        handler_version: 1,
        selectors: [{ mime: "text/*" }],
        intents: { open: { entry: { type: "web", path: "/edit?src={source}" }, modes: ["edit"], window, priority: 50 } },
        enabled: true,
    });

    it("goes to the app that handles it", async () => {
        registry.handlers = { "notes@bob#edit": handler("reuse") };
        const open = service();
        const view = await open.openContent(bob.did, { source }, "default");
        expect(opened[0].url).toMatch(/^https:\/\/notes\.bob\.example\/edit\?src=cyfs%3A%2F%2F%2Fhome%2Fbob%2Fa\.txt&requestId=/);
        expect(options.setLaunch).toHaveBeenCalledWith(view.id, expect.objectContaining({ source, mode: "edit" }));
    });

    it("hands it to a running app first", async () => {
        registry.handlers = { "notes@bob#edit": handler("reuse") };
        const open = service({ sendOpen: vi.fn(async () => "accepted" as const) });
        await open.open({ zone: bob.did, app: "notes" });
        await open.openContent(bob.did, { source }, "default");
        expect(opened).toHaveLength(1);
        expect(options.focusView).toHaveBeenCalledWith(views[0].id);
    });

    it("falls back to Preview, and never gives it back to the app that asked", async () => {
        registry.handlers = { "notes@bob#edit": handler("new") };
        const open = service();
        await open.openContent(bob.did, { source }, "default", { from: "notes@bob", hints: { name: "a.txt" } });
        await open.openContent(bob.did, { source }, "preview", { newWindow: true });
        expect(opened.map((view) => view.app)).toEqual(["preview", "preview"]);
        expect(opened[0].url).toBe("https://bob.example/app/preview?open=cyfs%3A%2F%2F%2Fhome%2Fbob%2Fa.txt&name=a.txt");
    });

    it("lets the user choose", async () => {
        registry.handlers = { "notes@bob#edit": handler("new") };
        const choose = vi.fn(async () => "notes@bob#edit");
        const open = service({ choose });
        await open.openContent(bob.did, { source }, "chooser");
        expect(choose).toHaveBeenCalledWith(expect.objectContaining({ handlers: expect.arrayContaining([{ key: "notes@bob#edit", label: "Notes" }]) }));
        expect(opened[0].app).toBe("notes");
        const canceled = service({ choose: async () => null });
        await expect(canceled.openContent(bob.did, { source }, "chooser")).rejects.toBeInstanceOf(OpenError);
    });
});
