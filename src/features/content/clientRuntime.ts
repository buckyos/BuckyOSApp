// The parts of the client that live as long as the main window: the hosts of all content views,
// the open service, and the events from the Rust side. React only mounts it and draws what it
// asks for (`useClientRuntime`).
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { HeaderState } from "buckyos/app-frame";
import type { ActivityEntry } from "@buckyos-desktop/activity/model.ts";
import { isMobileShell } from "../../utils/platform";
import { zoneLocale } from "../apps/catalog";
import { getTheme } from "../../theme";
import * as notifyApi from "../notify/api";
import type { Alert } from "../notify/types";
import type { ZoneView } from "../zone/types";
import * as api from "./api";
import { tabOfView, type PhoneTab } from "./phoneTabs";
import { FrameHosts, type HostedView } from "./frameHosts";
import { OpenService, type HandlerChoice } from "./openService";
import { frontChanged } from "./mobileViews";
import { openErrorOf } from "./openFailure";
import { OpenError, type OpenFailure, type ViewInfo } from "./types";

export interface ChoicePrompt extends HandlerChoice {
    answer: (key: string | null) => void;
}

export interface RuntimeSnapshot {
    views: ViewInfo[];
    /** The phone's foreground view; null while the client's own pages are in front. */
    front: string | null;
    headers: Record<string, HeaderState>;
    /** Phone: the Zone being left; its views end and none is opened again. */
    leaving: string | null;
    choice: ChoicePrompt | null;
    /** A Zone the user has to sign in to before something can go on. */
    signIn: string | null;
    /** The last thing that could not be opened. */
    failure: { reason: OpenFailure; zone?: string; app?: string; detail?: string; at: number } | null;
    download: { name: string | null; path: string | null; success: boolean; at: number } | null;
}

const EMPTY: RuntimeSnapshot = { views: [], front: null, headers: {}, leaving: null, choice: null, signIn: null, failure: null, download: null };

export interface RuntimeHooks {
    /** Shows one of the main window's tabs. */
    showTab: (tab: "home" | "apps" | "activity" | "settings") => void;
    /** A view that a tab of the phone shows came to the front. */
    showTabView: (tab: PhoneTab, zone: string) => void;
    /** Asks whether something of another Zone may be opened. */
    confirmZone: (zone: string) => Promise<boolean>;
    /** Makes a Zone the current one; false when the user decided against it (phone). */
    enterZone: (zone: string) => Promise<boolean>;
}

/** On a phone a view is `shown` or `hidden` when the stage follows what this page shows. */
const FOCUS = new Set(["focused", "blurred", "shown", "hidden"]);

export class ClientRuntime {
    readonly formFactor: "desktop" | "mobile" = isMobileShell() ? "mobile" : "desktop";
    readonly frames: FrameHosts;
    readonly open: OpenService;
    private zones: ZoneView[] = [];
    private locale = "en";
    private hooks: RuntimeHooks | null = null;
    private snapshot = EMPTY;
    private listeners = new Set<() => void>();
    private stops: UnlistenFn[] = [];
    /** A tab's view being opened because its tab is on screen, not because the user went to it. */
    private quiet = new Set<string>();
    private closing = new Set<string>();
    private clicked = 0;
    private started = false;

    constructor() {
        this.frames = new FrameHosts({
            formFactor: this.formFactor,
            container: this.formFactor === "mobile" ? "mobile-app" : "desktop-app",
            emit: api.emitToView,
            look: () => ({ mode: getTheme(), locale: zoneLocale(this.locale) }),
            accent: (zone) => this.zones.find((candidate) => candidate.did === zone)?.accent ?? undefined,
            presentation: (viewId) => (this.tabOf(viewId) ? "tab" : "window"),
            onAppOpen: async (view, request) => {
                if (!(await this.mayOpen(view, request.zone))) return { ok: false, code: "denied" };
                try {
                    await this.open.open({ ...request, zone: request.zone ?? view.zone });
                    return { ok: true };
                } catch (error) {
                    const reason = error instanceof OpenError ? error.reason : "failed";
                    return { ok: false, code: reason === "app_not_found" || reason === "zone_not_found" ? "not_found" : "denied" };
                }
            },
            onContentOpen: (view, request, target, options) => {
                if (!this.isShown(view.id)) return;
                void this.run(this.open.openContent(view.zone, request, target, { ...options, from: view.appInstance }));
            },
            onTitle: (view, title) => void api.setViewTitle(view.id, title).catch(() => undefined),
            onRequestClose: (view) => void this.closeView(view.id),
            onHeader: (view, header) => this.patch({ headers: { ...this.snapshot.headers, [view.id]: header } }),
        });
        this.open = new OpenService({
            zones: () => this.zones,
            formFactor: this.formFactor,
            locale: () => this.locale,
            views: api.listViews,
            openView: (view) =>
                api.openView({ ...view, presentation: this.tabOf(view.id) ? "tab" : "window" }),
            focusView: api.focusView,
            sendOpen: (viewId, request) => this.frames.sendOpen(viewId, request),
            setLaunch: (viewId, request) => this.frames.setLaunch(viewId, request),
            choose: (choice) => this.choose(choice),
            ...(this.formFactor === "mobile"
                ? { enterZone: (zone: string) => this.hooks?.enterZone(zone) ?? Promise.resolve(true) }
                : {}),
        });
    }

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getSnapshot = () => this.snapshot;

    private patch(next: Partial<RuntimeSnapshot>) {
        this.snapshot = { ...this.snapshot, ...next };
        this.listeners.forEach((listener) => listener());
    }

    setHooks(hooks: RuntimeHooks | null) {
        this.hooks = hooks;
    }

    setZones(zones: ZoneView[]) {
        const accents = (list: ZoneView[]) => list.map((zone) => `${zone.did}=${zone.accent ?? ""}`).join(" ");
        const changed = accents(this.zones) !== accents(zones);
        this.zones = zones;
        if (changed) this.frames.lookChanged();
    }

    setLocale(locale: string) {
        if (this.locale === locale) return;
        this.locale = locale;
        this.frames.lookChanged();
    }

    themeChanged() {
        this.frames.lookChanged();
    }

    /** The tab of the phone's own navigation that shows a view. */
    private tabOf(viewId: string): PhoneTab | null {
        return this.formFactor === "mobile" ? tabOfView(viewId) : null;
    }

    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        const on = async <T>(event: string, handle: (payload: T) => void) => {
            this.stops.push(await listen<T>(event, ({ payload }) => handle(payload)));
        };
        await on<{ kind: string; view: ViewInfo }>(api.VIEW_EVENT, ({ kind, view }) => this.onView(kind, view));
        await on<{ view: string; message: unknown }>(api.FRAME_EVENT, ({ view, message }) => this.frames.receive(view, message));
        await on<{ view: string }>(api.CLOSE_REQUEST_EVENT, ({ view }) => {
            void api.closingView(view).catch(() => undefined);
            void this.closeView(view);
        });
        await on<{ url: string; from: string | null; zone: string | null }>(api.OPEN_URL_EVENT, ({ url, from }) => {
            // A page that is not looked at opens nothing.
            if (from && !this.isShown(from)) return;
            void this.openLink(url);
        });
        await on<{ zone: string }>(api.SIGN_IN_EVENT, ({ zone }) => this.patch({ signIn: zone }));
        await on<{ name: string | null; path: string | null; success: boolean }>(api.DOWNLOAD_EVENT, (download) =>
            this.patch({ download: { ...download, at: Date.now() } })
        );
        await on<Alert>(notifyApi.ACTIVATE_EVENT, (alert) => void this.openAlert(alert));
        await on<string>("buckyos://tray-show", () => this.hooks?.showTab("activity"));
        await on<null>("app://quit-request", () => void this.quit());
        const views = await api.listViews().catch(() => []);
        for (const view of views) this.onView("opened", view);
        await invoke("deeplink_ready").catch(() => undefined);
    }

    private onView(kind: string, view: ViewInfo) {
        const others = this.snapshot.views.filter((known) => known.id !== view.id);
        if (kind === "closed") {
            this.frames.close(view.id);
            this.closing.delete(view.id);
            const headers = { ...this.snapshot.headers };
            delete headers[view.id];
            this.patch({ views: others, headers, front: this.snapshot.front === view.id ? null : this.snapshot.front });
            return;
        }
        const hosted: HostedView = { id: view.id, zone: view.zone, app: view.app, appInstance: view.appInstance };
        this.frames.open(hosted);
        if (FOCUS.has(kind)) this.frames.setFocused(view.id, kind === "focused" || kind === "shown");
        let front = this.snapshot.front;
        if (this.formFactor === "mobile") {
            const tab = this.tabOf(view.id);
            if (kind === "focused") {
                const quiet = tab !== null && this.quiet.delete(view.id);
                // A tab's view that opened behind the app in front goes back behind it.
                frontChanged(view.id, quiet && front !== null);
                if (!tab) front = view.id;
                else if (!quiet) front = null;
                if (tab && !quiet) this.hooks?.showTabView(tab, view.zone);
            }
        }
        this.patch({ views: [...others, view], front });
    }

    /** The view a tab on screen shows, opened when there is none. The tab stays where it is. */
    async openTab(zone: string, tab: PhoneTab, viewId: string): Promise<ViewInfo | null> {
        this.quiet.add(viewId);
        try {
            return await this.run(this.open.open({ zone, app: tab }));
        } finally {
            // The event of the new view may still be on its way.
            setTimeout(() => this.quiet.delete(viewId), 1000);
        }
    }

    setLeaving(zone: string | null) {
        if (this.snapshot.leaving !== zone) this.patch({ leaving: zone });
    }

    /** Phone: the client's own pages come to the front; the app stays open. */
    minimize() {
        if (this.snapshot.front) this.patch({ front: null });
    }

    /** Phone: an open app to the front again. */
    focusView(viewId: string) {
        return this.run(api.focusView(viewId));
    }

    askZone(zone: string): Promise<boolean> {
        return this.hooks?.confirmZone(zone) ?? Promise.resolve(false);
    }

    private isShown(viewId: string): boolean {
        const view = this.snapshot.views.find((known) => known.id === viewId);
        return this.formFactor === "desktop" ? Boolean(view) : Boolean(view?.focused);
    }

    /** An app asks for another one. Another Zone is the user's to decide, not an app's. */
    private async mayOpen(view: HostedView, zone: string | undefined): Promise<boolean> {
        if (!this.isShown(view.id)) return false;
        if (!zone || zone === view.zone) return true;
        const target = this.zones.find((candidate) => candidate.did === zone);
        const focused = this.snapshot.views.some((known) => known.id === view.id && known.focused);
        if (!target || !focused) return false;
        return this.askZone(zone);
    }

    /** Reports a failure to the page instead of losing it. */
    private async run<T>(work: Promise<T>): Promise<T | null> {
        try {
            return await work;
        } catch (error) {
            const failure = openErrorOf(error);
            if (failure.reason === "canceled") return null;
            console.warn("[Open] failed", error);
            this.patch({
                failure: { reason: failure.reason, zone: failure.zone, app: failure.app, detail: failure.detail, at: Date.now() },
                ...(failure.reason === "need_login" && failure.zone ? { signIn: failure.zone } : {}),
            });
            return null;
        }
    }

    openApp(zone: string, app: string, path?: string) {
        return this.run(this.open.open({ zone, app, ...(path ? { path } : {}) }));
    }

    openLink(link: string) {
        return this.run(this.open.openLink(link));
    }

    openActivity(zone: ZoneView, entry: ActivityEntry) {
        return this.run(this.open.openActivity(zone, entry));
    }

    async openAlert(alert: Alert) {
        if (alert.target.kind === "activity") {
            this.hooks?.showTab("activity");
            return;
        }
        // The user clicked it: going to its Zone is what they asked for.
        this.clicked += 1;
        try {
            await this.run(this.open.openAlert(alert));
        } finally {
            this.clicked -= 1;
        }
    }

    /** Whether what is being opened was asked for in the client itself. */
    get askedByUser(): boolean {
        return this.clicked > 0;
    }

    dismissFailure() {
        this.patch({ failure: null });
    }

    dismissDownload() {
        this.patch({ download: null });
    }

    askSignIn(zone: string | null) {
        this.patch({ signIn: zone });
    }

    private choose(choice: HandlerChoice): Promise<string | null> {
        return new Promise((resolve) => {
            this.snapshot.choice?.answer(null);
            this.patch({
                choice: {
                    ...choice,
                    answer: (key) => {
                        this.patch({ choice: null });
                        resolve(key);
                    },
                },
            });
        });
    }

    /** Asks the app, then closes. False when it stays open. */
    async closeView(viewId: string, reason: "user" | "logout" | "shell" = "user"): Promise<boolean> {
        if (this.closing.has(viewId)) return false;
        this.closing.add(viewId);
        try {
            if (!(await this.frames.mayClose(viewId, reason))) return false;
            await api.closeView(viewId);
            return true;
        } finally {
            this.closing.delete(viewId);
        }
    }

    /** Asks every view of a Zone (or of all) in turn; false as soon as one stays open. */
    async closeAll(zone?: string, reason: "user" | "logout" | "shell" = "shell"): Promise<boolean> {
        const views = this.snapshot.views.filter((view) => !zone || view.zone === zone);
        for (const view of views) {
            if (!(await this.frames.mayClose(view.id, reason))) {
                await api.focusView(view.id).catch(() => undefined);
                return false;
            }
        }
        for (const view of views) await api.closeView(view.id).catch(() => undefined);
        return true;
    }

    private async quit() {
        await invoke("quit_started").catch(() => undefined);
        if (await this.closeAll()) await invoke("quit_confirmed");
    }
}

export const clientRuntime = new ClientRuntime();
