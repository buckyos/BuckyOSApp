// Opening apps, pages and content. Whatever asks — an icon, a notification, another app, a link —
// becomes one OpenAppRequest; the WebSDK's rules decide whether a window is made or found.
import { resolveOpenApp, type OpenAppRequest, type OpenAppWindow } from "buckyos/open-app";
import {
    contentDescriptor,
    contentRefString,
    emptyDefaults,
    expandOpenPath,
    resolveContentHandlers,
    systemOpenUrl,
    type ContentHints,
    type ContentOpenTarget,
    type HandlerPlan,
    type OpenRequest,
} from "buckyos/content";
import { activityPath, type ActivityEntry } from "@buckyos-desktop/activity/model.ts";
import { appName, appOfUrl, findApp, pagePath, pageUrl, readCatalog, type AppCatalog, type AppEntry } from "../apps/catalog";
import { zoneChannel, zoneClients } from "../zone/channel";
import { zoneTitle, type ZoneView } from "../zone/types";
import type { Alert } from "../notify/types";
import { readLink } from "./openUrl";
import { OpenError, type OpenViewRequest, type ViewInfo } from "./types";

const CATALOG_FRESH_MS = 60_000;

export interface HandlerChoice {
    zone: string;
    name: string;
    handlers: { key: string; label: string }[];
}

export interface OpenServiceOptions {
    zones: () => ZoneView[];
    formFactor: "desktop" | "mobile";
    locale: () => string;
    views: () => Promise<ViewInfo[]>;
    openView: (view: OpenViewRequest) => Promise<ViewInfo>;
    focusView: (id: string, url?: string) => Promise<ViewInfo>;
    /** Hands content to an app that is already running; false when it does not take it. */
    sendOpen: (viewId: string, request: OpenRequest) => Promise<"accepted" | "preview" | "refused">;
    /** The launch request a view about to open gets in its `frame.init`. */
    setLaunch: (viewId: string, request: OpenRequest) => void;
    /** Lets the user pick an app; null when they decided not to. */
    choose: (choice: HandlerChoice) => Promise<string | null>;
    /** A phone shows one Zone at a time: it goes to the Zone before something of it opens. */
    enterZone?: (zone: string) => Promise<boolean>;
    /** A window was made for the app (desktop: it gets the app's icon). */
    opened?: (view: ViewInfo, zone: ZoneView, entry: AppEntry) => void;
    readCatalog?: typeof readCatalog;
}

export class OpenService {
    private catalogs = new Map<string, { catalog?: AppCatalog; loading?: Promise<AppCatalog> }>();
    private listeners = new Set<() => void>();

    constructor(private options: OpenServiceOptions) {}

    private zone(did: string): ZoneView {
        const zone = this.options.zones().find((candidate) => candidate.did === did);
        if (!zone) throw new OpenError("zone_not_found", did);
        return zone;
    }

    /** Catalog changes, for `useSyncExternalStore`. */
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    cachedCatalog(zone: ZoneView): AppCatalog | undefined {
        return this.catalogs.get(this.catalogKey(zone))?.catalog;
    }

    private catalogKey(zone: ZoneView): string {
        return `${zone.did}|${zone.host}|${zone.session.identity?.user_id ?? ""}|${this.options.formFactor}`;
    }

    async catalog(zone: ZoneView, maxAge = CATALOG_FRESH_MS): Promise<AppCatalog> {
        const key = this.catalogKey(zone);
        const entry = this.catalogs.get(key) ?? {};
        this.catalogs.set(key, entry);
        if (entry.catalog && Date.now() - entry.catalog.readAt < maxAge) return entry.catalog;
        entry.loading ??= (this.options.readCatalog ?? readCatalog)(zone, zoneChannel(zone), {
            formFactor: this.options.formFactor,
            isAdmin: zone.session.identity?.user_type === "admin" || zone.session.identity?.user_type === "root",
        })
            .then((catalog) => {
                entry.catalog = catalog;
                this.listeners.forEach((listener) => listener());
                return catalog;
            })
            .finally(() => {
                entry.loading = undefined;
            });
        return entry.loading;
    }

    /** A catalog that knows `app`, read again once when the cached one does not. */
    private async lookup(zone: ZoneView, find: (catalog: AppCatalog) => AppEntry | undefined): Promise<AppEntry> {
        let catalog: AppCatalog;
        try {
            catalog = await this.catalog(zone);
            const found = find(catalog);
            if (found) return found;
            catalog = await this.catalog(zone, 0);
        } catch (error) {
            console.warn("[Open] reading the apps failed", zone.host, error);
            throw new OpenError(zone.session.state === "need_password" ? "need_login" : "unreachable", zone.did);
        }
        const found = find(catalog);
        if (!found) throw new OpenError("app_not_found", zone.did);
        return found;
    }

    async open(request: OpenAppRequest): Promise<ViewInfo> {
        const zone = this.zone(request.zone);
        const entry = await this.lookup(zone, (catalog) => findApp(catalog, request.app, zone.session.identity?.user_id)).catch((error) => {
            throw error instanceof OpenError ? new OpenError(error.reason, zone.did, request.app) : error;
        });
        return this.openEntry(zone, entry, request);
    }

    /** `entry.host` may differ from the catalog's (a workspace's own origin). */
    private async openEntry(zone: ZoneView, entry: AppEntry, request: OpenAppRequest): Promise<ViewInfo> {
        if (this.options.enterZone && !(await this.options.enterZone(zone.did))) throw new OpenError("canceled", zone.did, entry.id);
        const windows: OpenAppWindow[] = (await this.options.views()).map((view) => ({
            id: view.id,
            zone: view.zone,
            appInstance: view.appInstance,
            windowPath: view.windowPath,
            path: view.path ? pagePath(entry, view.path) : undefined,
            lastActive: view.lastActive,
        }));
        const decision = resolveOpenApp(request, entry.instance, entry.window, windows);
        if (decision.action === "focus") {
            return this.options.focusView(decision.windowId, decision.navigate ? pageUrl(entry, decision.navigate) : undefined);
        }
        const several = this.options.zones().length > 1;
        const view = await this.options.openView({
            id: decision.windowId,
            zone: zone.did,
            app: entry.id,
            appInstance: entry.instance,
            windowPath: decision.windowPath,
            url: pageUrl(entry, decision.path),
            title: appName(entry, this.options.locale()),
            window: { ...entry.window },
            ...(several ? { zoneLabel: zoneTitle(zone) } : {}),
            ...(zone.accent ? { accent: zone.accent } : {}),
        });
        this.options.opened?.(view, zone, entry);
        return view;
    }

    async openLink(link: string): Promise<ViewInfo> {
        const meaning = readLink(link, this.options.zones());
        switch (meaning.kind) {
            case "app":
                return this.open(meaning.request);
            case "content":
                return this.openContent(meaning.zone, meaning.open.request, meaning.open.target, { hints: meaning.open.hints, from: meaning.open.from });
            case "page": {
                const zone = this.zone(meaning.zone);
                let path = "/";
                const entry = await this.lookup(zone, (catalog) => {
                    const found = appOfUrl(catalog, meaning.url);
                    if (found) path = found.path;
                    return found?.entry;
                });
                return this.openEntry(zone, entry, { zone: zone.did, app: entry.id, path });
            }
            case "unknown-zone":
                throw new OpenError("zone_not_found");
            default:
                throw new OpenError("unsupported");
        }
    }

    /** A page of a Zone by address or by path on its root. */
    private openPage(zone: ZoneView, link: string): Promise<ViewInfo> {
        const url = new URL(link, `https://${zone.host}/`);
        const host = url.hostname.toLowerCase();
        const own = url.protocol === "https:" && (host === zone.host || host.endsWith(`.${zone.host}`));
        if (!own) throw new OpenError("unsupported", zone.did);
        return this.openLink(url.href);
    }

    openActivity(zone: ZoneView, entry: ActivityEntry): Promise<ViewInfo> {
        const link = entry.kind === "notify" ? entry.item.link : undefined;
        return this.openPreferred(zone, link, activityPath(entry));
    }

    /** Null: the alert is about several things, the Activity page shows them. */
    async openAlert(alert: Alert): Promise<ViewInfo | null> {
        const zone = this.zone(alert.zone);
        const target = alert.target;
        switch (target.kind) {
            case "notify":
                return this.openPreferred(zone, target.link ?? undefined, `/messagehub?notify=${encodeURIComponent(target.notify_id)}`);
            case "message": {
                const params = new URLSearchParams();
                if (target.entity_id) params.set("entityId", target.entity_id);
                params.set("sessionId", target.session_id);
                return this.openPage(zone, `/messagehub?${params.toString()}`);
            }
            case "task":
                return this.openPage(zone, `/taskcenter?taskid=${encodeURIComponent(target.task_id)}`);
            default:
                return null;
        }
    }

    /** An app's own page for the matter, when it is one of this Zone's; else the system's. */
    private async openPreferred(zone: ZoneView, link: string | undefined, fallback: string): Promise<ViewInfo> {
        if (link) {
            try {
                return await this.openPage(zone, link);
            } catch (error) {
                console.info("[Open] the notification's own page is not one to open", link, error);
            }
        }
        return this.openPage(zone, fallback);
    }

    private async handlers(zone: ZoneView, source: OpenRequest["source"], hints: ContentHints): Promise<{ plans: HandlerPlan[]; catalog: AppCatalog }> {
        const catalog = await this.catalog(zone);
        const userId = zone.session.identity?.user_id;
        const registry = userId ? zoneClients(zone, zone.session.identity).contentRegistry(userId) : null;
        await registry?.refresh().catch((error) => console.warn("[Open] content handlers", error));
        const plans = resolveContentHandlers(
            registry?.registry ?? { schema_version: 1, handlers: {} },
            registry?.defaults ?? emptyDefaults(),
            contentDescriptor(source, hints),
            "open",
            {},
            catalog.entries.map((entry) => entry.instance)
        );
        return { plans, catalog };
    }

    /** Opens content with the app that handles it (TODO §3.2 `content.open`). */
    async openContent(
        zoneDid: string,
        request: Omit<OpenRequest, "requestId">,
        target: ContentOpenTarget,
        options: { newWindow?: boolean; hints?: ContentHints; from?: string } = {}
    ): Promise<ViewInfo> {
        const zone = this.zone(zoneDid);
        const hints = options.hints ?? {};
        const preview = () => this.openPreview(zone, request, hints, options.newWindow === true);
        if (target === "preview") return preview();
        const { plans, catalog } = await this.handlers(zone, request.source, hints);
        const from = options.from?.split("@")[0];
        const candidates = plans.filter((plan) => !from || plan.appInstanceId?.split("@")[0] !== from);
        let plan = candidates[0];
        if (target === "chooser") {
            const label = (candidate: HandlerPlan) => {
                const entry = candidate.appInstanceId ? findApp(catalog, candidate.appInstanceId) : findApp(catalog, "preview");
                return entry ? appName(entry, this.options.locale()) : candidate.handlerRef;
            };
            const key = await this.options.choose({
                zone: zone.did,
                name: hints.name ?? contentRefString(request.source),
                handlers: candidates.map((candidate) => ({ key: candidate.handlerKey, label: label(candidate) })),
            });
            if (key === null) throw new OpenError("canceled", zone.did);
            plan = candidates.find((candidate) => candidate.handlerKey === key) ?? plan;
        }
        const entry = plan?.appInstanceId ? findApp(catalog, plan.appInstanceId) : undefined;
        if (!plan || plan.binding.entry.type !== "web" || !entry) return preview();
        const open: OpenRequest = {
            ...request,
            requestId: crypto.randomUUID(),
            mode: request.mode ?? (plan.binding.modes?.includes("edit") ? "edit" : "view"),
        };
        const fresh = entry.window.instance === "multi" && (plan.binding.window !== "reuse" || options.newWindow === true);
        if (!fresh) {
            const running = (await this.options.views())
                .filter((view) => view.zone === zone.did && view.appInstance === entry.instance)
                .sort((left, right) => right.lastActive - left.lastActive);
            for (const view of running) {
                const answer = await this.options.sendOpen(view.id, open);
                if (answer === "accepted") return this.options.focusView(view.id);
                if (answer === "preview") return preview();
            }
        }
        const view = await this.openEntry(zone, entry, {
            zone: zone.did,
            app: entry.id,
            path: expandOpenPath(plan.binding.entry.path, open, plan.binding.modes),
            ...(fresh ? { mode: "new" as const } : {}),
        });
        this.options.setLaunch(view.id, open);
        return view;
    }

    private async openPreview(zone: ZoneView, request: Omit<OpenRequest, "requestId">, hints: ContentHints, newWindow: boolean): Promise<ViewInfo> {
        const entry = await this.lookup(zone, (catalog) => findApp(catalog, "preview"));
        const url = new URL(systemOpenUrl(`https://${zone.host}/`, { request, target: "preview", hints }));
        // The Preview app's own address takes what the Zone's entry takes, without saying where to open.
        url.searchParams.delete("intent");
        return this.openEntry(zone, entry, {
            zone: zone.did,
            app: entry.id,
            path: `/${url.search}`,
            ...(newWindow ? { mode: "new" as const } : {}),
        });
    }
}
