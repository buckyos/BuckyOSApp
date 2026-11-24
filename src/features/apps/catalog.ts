// The apps of one Zone for its signed-in user: what is installed (`apps.list`) plus the Zone's own
// system apps (`/system-apps.json`).
import { readAppWindowDeclaration, type AppWindowDeclaration } from "buckyos";
import { listApps, type AppSummary } from "@buckyos-desktop/controlPanel/apps.ts";
import type { ZoneChannel } from "@buckyos-desktop/channel.ts";
import { pickLocalized } from "@buckyos-desktop/presentation/model.ts";

export interface AppEntry {
    /** `OpenAppRequest.app`. */
    id: string;
    /** The window identity: an app instance id, or the system app's own id. */
    instance: string;
    names: Record<string, string>;
    name: string;
    /** An absolute https address; null when the app has none the client can show. */
    icon: string | null;
    /** The page opened without a path. */
    home: string;
    host: string;
    kind: "system" | "app";
    window: AppWindowDeclaration;
    launcher: boolean;
}

export interface AppCatalog {
    zone: string;
    zoneHost: string;
    entries: AppEntry[];
    /** Null when the Zone is too old to list its system apps. */
    systemApps: "listed" | "unavailable";
    readAt: number;
}

interface SystemAppEntry {
    id: string;
    names?: Record<string, string>;
    icon?: string;
    path: string;
    show_in_launcher?: boolean;
    audience?: "all" | "admin" | "agent_user";
    form_factors?: string[];
    window?: unknown;
}

export interface CatalogViewer {
    formFactor: "desktop" | "mobile";
    /** `user_type` of the session: administrators also see the apps meant for them. */
    isAdmin: boolean;
}

/** System apps with their own pages on Zones that do not list them yet (TODO R13). */
const FALLBACK_SYSTEM_APPS: SystemAppEntry[] = [
    { id: "messagehub", names: { en: "Message Hub" }, path: "/messagehub", window: { instance: "single" } },
    { id: "homestation", names: { en: "Home Station" }, path: "/homestation", window: { instance: "single" } },
    { id: "aiworkspace", names: { en: "AI Workspace" }, path: "/workspace", window: { instance: "multi" } },
    { id: "task-center", names: { en: "Task Center" }, path: "/taskcenter", window: { instance: "single" } },
];

function absolute(value: unknown, base: string): string | null {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
        const url = new URL(value, base);
        return url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

function isPath(value: unknown): value is string {
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

function systemEntry(app: SystemAppEntry, zoneHost: string): AppEntry | null {
    if (typeof app.id !== "string" || !app.id || !isPath(app.path)) return null;
    const names = app.names && typeof app.names === "object" ? app.names : {};
    return {
        id: app.id,
        instance: app.id,
        names,
        name: names.en ?? Object.values(names)[0] ?? app.id,
        icon: absolute(app.icon, `https://${zoneHost}/`),
        home: app.path,
        host: zoneHost,
        kind: "system",
        window: readAppWindowDeclaration(app.window),
        launcher: app.show_in_launcher !== false,
    };
}

function installedEntry(app: AppSummary, zoneHost: string): AppEntry | null {
    const label = app.web_hosts?.[0]?.trim().toLowerCase();
    // Without a web page there is nothing a window could show; an Agent opens from its own entries.
    if (!label || app.runtime_type === "agent" || app.enable === false) return null;
    const host = `${label}.${zoneHost}`;
    const names: Record<string, string> = {};
    const title = app.presentation?.title;
    if (title) Object.assign(names, title);
    const fallback = app.show_name?.trim() || app.name?.trim() || app.app_id;
    return {
        id: app.app_id,
        instance: app.app_instance_id,
        names,
        name: fallback,
        icon: absolute(app.app_icon_url, `https://${host}/`),
        home: "/",
        host,
        kind: "app",
        window: readAppWindowDeclaration(app.window),
        launcher: true,
    };
}

export function buildCatalog(
    zone: { did: string; host: string },
    installed: AppSummary[],
    system: unknown,
    viewer: CatalogViewer,
    readAt = Date.now()
): AppCatalog {
    const listed =
        system && typeof system === "object" && Array.isArray((system as { apps?: unknown }).apps)
            ? ((system as { apps: SystemAppEntry[] }).apps)
            : null;
    const entries: AppEntry[] = [];
    const taken = new Set<string>();
    for (const app of listed ?? FALLBACK_SYSTEM_APPS) {
        if (!app || typeof app !== "object") continue;
        if (app.audience === "admin" && !viewer.isAdmin) continue;
        if (Array.isArray(app.form_factors) && !app.form_factors.includes(viewer.formFactor)) continue;
        const entry = systemEntry(app, zone.host);
        if (!entry || taken.has(entry.id)) continue;
        taken.add(entry.id);
        entries.push(entry);
    }
    for (const app of installed) {
        const entry = installedEntry(app, zone.host);
        if (!entry || taken.has(entry.instance)) continue;
        taken.add(entry.instance);
        entries.push(entry);
    }
    return { zone: zone.did, zoneHost: zone.host, entries, systemApps: listed ? "listed" : "unavailable", readAt };
}

export async function readCatalog(
    zone: { did: string; host: string },
    channel: ZoneChannel,
    viewer: CatalogViewer
): Promise<AppCatalog> {
    const [installed, system] = await Promise.all([
        listApps(channel).then((list) => list.apps),
        channel
            .fetch("/system-apps.json")
            .then((response) => {
                const json = response.headers.get("content-type")?.includes("json");
                // An older Zone answers every unknown path with the Desktop page.
                return response.ok && json ? (response.json() as Promise<unknown>) : null;
            })
            .catch(() => null),
    ]);
    return buildCatalog(zone, installed, system, viewer);
}

/** The client says `zh` for what Zones call `zh-CN`. */
export function zoneLocale(locale: string): string {
    return locale === "zh" ? "zh-CN" : locale;
}

export function appName(entry: AppEntry, locale: string): string {
    return pickLocalized(entry.names, zoneLocale(locale)) || pickLocalized(entry.names, locale) || entry.name;
}

/** `messagehub`, an app id, or an app instance id. An instance of the user's own comes first. */
export function findApp(catalog: AppCatalog, app: string, userId?: string | null): AppEntry | undefined {
    const exact = catalog.entries.find((entry) => entry.instance === app);
    if (exact) return exact;
    const matches = catalog.entries.filter((entry) => entry.id === app);
    return matches.find((entry) => userId && entry.instance.endsWith(`@${userId}`)) ?? matches[0];
}

/**
 * `OpenAppRequest.path` as an address. An installed app's path starts at its own origin; a system
 * app's is appended to the address of the app (`/?taskid=1` of `/taskcenter` is
 * `/taskcenter?taskid=1`), as the Shell does.
 */
export function pageUrl(entry: AppEntry, path?: string): string {
    const origin = `https://${entry.host}`;
    const home = `${origin}${entry.home}`;
    if (!path || path === "/" || !isPath(path)) return home;
    const full = entry.kind !== "system" ? path : /^\/[?#]/.test(path) ? `${entry.home}${path.slice(1)}` : `${entry.home}${path}`;
    const url = new URL(full, `${origin}/`);
    // A path can never leave the app's own origin.
    return url.origin === origin ? url.href : home;
}

/** The inverse: the page a window shows, as `OpenAppRequest.path`. */
export function pagePath(entry: AppEntry, path: string): string {
    if (entry.kind !== "system" || !path.startsWith(entry.home)) return path;
    const rest = path.slice(entry.home.length);
    const name = rest.split(/[?#]/, 1)[0].replace(/\/+$/, "");
    const tail = rest.slice(rest.split(/[?#]/, 1)[0].length);
    return `${name || "/"}${tail}`;
}

function underPath(path: string, base: string): boolean {
    return path === base || path.startsWith(base.endsWith("/") ? base : `${base}/`);
}

/** Which app a page address of this Zone belongs to. */
export function appOfUrl(catalog: AppCatalog, url: URL): { entry: AppEntry; path: string } | undefined {
    const path = `${url.pathname}${url.search}${url.hash}`;
    const host = url.host.toLowerCase();
    if (host !== catalog.zoneHost) {
        const entry = catalog.entries.find((candidate) => candidate.kind === "app" && candidate.host === host);
        if (entry) return { entry, path };
        if (host.endsWith(`.${catalog.zoneHost}`) && host.startsWith("aiws-")) {
            const workspace = catalog.entries.find((candidate) => candidate.id === "aiworkspace");
            // A workspace lives on an origin of its own, under the same app.
            if (workspace) return { entry: { ...workspace, host, home: "/", kind: "app" }, path };
        }
        return undefined;
    }
    const owners = catalog.entries
        .filter((entry) => entry.kind === "system" && underPath(url.pathname, entry.home))
        .sort((left, right) => right.home.length - left.home.length);
    return owners[0] ? { entry: owners[0], path: pagePath(owners[0], path) } : undefined;
}
