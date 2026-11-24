// What a link means to the client: a page of a listed Zone, a Zone's "open this app" / "open this
// content" entry, or `buckyos://app.open`. Everything else is not the client's.
import { parseAppOpenUrl, parseSystemOpenApp, type OpenAppRequest } from "buckyos/open-app";
import { parseSystemOpen, type SystemOpenRequest } from "buckyos/content";

export interface ListedZone {
    did: string;
    host: string;
}

export type LinkMeaning =
    | { kind: "page"; zone: string; url: URL }
    | { kind: "app"; request: OpenAppRequest }
    | { kind: "content"; zone: string; open: SystemOpenRequest }
    | { kind: "unknown-zone" }
    | { kind: "unsupported" };

/** The longest matching Zone host wins. */
export function zoneOfHost<Z extends ListedZone>(zones: readonly Z[], host: string): Z | undefined {
    const name = host.toLowerCase();
    return zones
        .filter((zone) => name === zone.host || name.endsWith(`.${zone.host}`))
        .sort((left, right) => right.host.length - left.host.length)[0];
}

export function readLink(link: string, zones: readonly ListedZone[]): LinkMeaning {
    if (/^buckyos:/i.test(link)) {
        const open = parseAppOpenUrl(link);
        if (!open) return { kind: "unsupported" };
        const zone = zones.find((candidate) => candidate.host === open.zoneHost.toLowerCase());
        if (!zone) return { kind: "unknown-zone" };
        return {
            kind: "app",
            request: {
                zone: zone.did,
                app: open.app,
                ...(open.path !== undefined ? { path: open.path } : {}),
                ...(open.window !== undefined ? { window: open.window } : {}),
            },
        };
    }
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return { kind: "unsupported" };
    }
    if (url.protocol !== "https:") return { kind: "unsupported" };
    const zone = zoneOfHost(zones, url.host);
    if (!zone) return { kind: "unknown-zone" };
    if (url.host.toLowerCase() === zone.host && url.pathname === "/") {
        const app = parseSystemOpenApp(url.searchParams);
        if (app) return { kind: "app", request: { ...app, zone: zone.did } };
        const open = parseSystemOpen(url.searchParams);
        if (open) return { kind: "content", zone: zone.did, open };
    }
    return { kind: "page", zone: zone.did, url };
}
