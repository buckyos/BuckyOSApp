import { describe, expect, it } from "vitest";
import { formatAppOpenUrl } from "buckyos/open-app";
import { readLink, zoneOfHost } from "./openUrl";

const zones = [
    { did: "did:web:example.org", host: "example.org" },
    { did: "did:web:team.example.org", host: "team.example.org" },
];

describe("links", () => {
    it("belong to the Zone with the longest matching host", () => {
        expect(zoneOfHost(zones, "notes.team.example.org")?.did).toBe("did:web:team.example.org");
        expect(zoneOfHost(zones, "notes.example.org")?.did).toBe("did:web:example.org");
        expect(zoneOfHost(zones, "evilexample.org")).toBeUndefined();
    });

    it("to a page of a listed Zone stay a page", () => {
        expect(readLink("https://notes.example.org/a?b=1", zones)).toMatchObject({ kind: "page", zone: "did:web:example.org" });
        expect(readLink("https://evil.org/", zones)).toEqual({ kind: "unknown-zone" });
        expect(readLink("http://example.org/", zones)).toEqual({ kind: "unsupported" });
        expect(readLink("not a link", zones)).toEqual({ kind: "unsupported" });
    });

    it("to a Zone's own entries become requests", () => {
        expect(readLink("https://example.org/?open-app=files&path=%2Fapp%2Ffiles%2Fx", zones)).toEqual({
            kind: "app",
            request: { zone: "did:web:example.org", app: "files", path: "/app/files/x" },
        });
        expect(readLink("https://example.org/?open=cyfs%3A%2F%2F%2Fa.txt", zones)).toMatchObject({ kind: "content", zone: "did:web:example.org" });
        expect(readLink("https://example.org/", zones)).toMatchObject({ kind: "page" });
    });

    it("of the buckyos scheme open apps of listed Zones and nothing else", () => {
        const link = formatAppOpenUrl({ zoneHost: "team.example.org", app: "messagehub", path: "/messagehub?notify=1" });
        expect(readLink(link, zones)).toEqual({
            kind: "app",
            request: { zone: "did:web:team.example.org", app: "messagehub", path: "/messagehub?notify=1" },
        });
        expect(readLink(formatAppOpenUrl({ zoneHost: "other.org", app: "x" }), zones)).toEqual({ kind: "unknown-zone" });
        expect(readLink("buckyos://sign.payload?v=1&request_url=https%3A%2F%2Fa.b", zones)).toEqual({ kind: "unsupported" });
    });
});
