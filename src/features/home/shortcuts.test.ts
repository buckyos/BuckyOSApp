import { describe, expect, it } from "vitest";
import { addShortcut, loadShortcuts, moveShortcut, nearestIndex, pinnedFirst, readShortcuts, removeShortcut, saveShortcuts, shortcutEntries } from "./shortcuts";
import { findApp, type AppCatalog, type AppEntry } from "../apps/catalog";
import type { ZoneChannel } from "@buckyos-desktop/channel.ts";

const entry = (id: string, instance = id): AppEntry => ({
    id,
    instance,
    names: {},
    name: id,
    icon: null,
    home: "/",
    host: "a.example",
    kind: "app",
    window: {} as AppEntry["window"],
    launcher: true,
});
const catalog: AppCatalog = { zone: "did:bns:a", zoneHost: "a.example", entries: [entry("files"), entry("notes", "notes@me"), entry("notes", "notes@you")], systemApps: "listed", readAt: 0 };

describe("Home shortcuts", () => {
    it("reads a list and drops what is not an id", () => {
        expect(readShortcuts({ shortcuts: ["a", "", 3, "b", "a"] })).toEqual(["a", "b"]);
        expect(readShortcuts({ shortcuts: [] })).toEqual([]);
        expect(readShortcuts({})).toBeNull();
        expect(readShortcuts(null)).toBeNull();
    });

    it("adds, removes and moves", () => {
        expect(addShortcut(["a"], "b")).toEqual(["a", "b"]);
        expect(addShortcut(["a", "b"], "a")).toEqual(["a", "b"]);
        expect(removeShortcut(["a", "b"], "a")).toEqual(["b"]);
        expect(moveShortcut(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
        expect(moveShortcut(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
        expect(moveShortcut(["a", "b"], "a", "x")).toEqual(["a", "b"]);
        // "gone" is not an app of the Zone right now; it stays between its neighbours.
        expect(moveShortcut(["a", "gone", "b", "c"], "c", "a")).toEqual(["c", "a", "gone", "b"]);
    });

    it("shows the apps the Zone has, once each", () => {
        const find = (list: AppCatalog, id: string) => findApp(list, id, "me");
        expect(shortcutEntries(catalog, ["notes", "gone", "files", "notes@me"], find).map((app) => app.instance)).toEqual(["notes@me", "files"]);
    });

    it("puts pinned apps in front of a launcher's list", () => {
        const [files, mine, yours] = catalog.entries;
        expect(pinnedFirst([files, mine, yours], [yours, files]).map((app) => app.instance)).toEqual(["notes@you", "files", "notes@me"]);
        // A search left one of them out.
        expect(pinnedFirst([mine], [files, mine]).map((app) => app.instance)).toEqual(["notes@me"]);
    });

    it("finds the tile a drag is over", () => {
        const boxes = [0, 80, 160].map((left) => ({ left, top: 0, width: 80, height: 80 }));
        expect(nearestIndex({ x: 170, y: 90 }, boxes)).toBe(2);
        expect(nearestIndex({ x: 10, y: 10 }, boxes)).toBe(0);
        expect(nearestIndex({ x: 0, y: 0 }, [])).toBe(-1);
    });

    it("keeps the list in the account's desktop state", async () => {
        const requests: unknown[] = [];
        const channel: ZoneChannel = {
            rpc: () => Promise.reject(new Error("unused")),
            fetch: async (_path, init) => {
                const body = JSON.parse(String(init?.body));
                requests.push(body);
                return new Response(JSON.stringify({ ok: true, data: { value: { shortcuts: ["files"] }, exists: true } }));
            },
        };
        expect(await loadShortcuts(channel)).toEqual(["files"]);
        await saveShortcuts(channel, ["files", "notes"]);
        expect(requests).toEqual([
            { action: "state.get", session_id: "default", state_key: "client_home" },
            { action: "state.set", session_id: "default", state_key: "client_home", json_path: "shortcuts", value: ["files", "notes"] },
        ]);
    });
});
