import { describe, expect, it, vi } from "vitest";

vi.mock("../zone/channel", () => ({ zoneChannel: vi.fn() }));
const { CREATE_ACTIONS, createTargets } = await import("./actions");
const { buildCatalog } = await import("../apps/catalog");

const zone = { did: "did:bns:a", host: "a.example" };
const system = (ids: string[]) => ({ version: 1, apps: ids.map((id) => ({ id, names: { en: id }, path: `/app/${id}` })) });

describe("the plus menu", () => {
    it("has the four the owner named, each with one target", () => {
        expect(CREATE_ACTIONS.map(({ kind, app, path }) => [kind, app, path])).toEqual([
            ["message", "messagehub", undefined],
            ["post", "homestation", "/?new=post"],
            ["note", "aiworkspace", undefined],
            ["photo", "files", "/upload"],
        ]);
    });

    it("tells which of them the Zone has no app for", () => {
        const viewer = { formFactor: "mobile" as const, isAdmin: false };
        const catalog = buildCatalog(zone, [], system(["messagehub", "files"]), viewer);
        expect(createTargets(catalog).map(({ entry }) => entry?.id ?? null)).toEqual(["messagehub", null, null, "files"]);
        expect(createTargets(undefined).every(({ entry }) => entry === null)).toBe(true);
    });
});
