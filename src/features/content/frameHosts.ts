// The app-frame host side of every content view, with the WebSDK's AppFrameHost over the native
// bridge: a view's page posts with `BuckyApi.call("frame.post")`, the client answers with a
// `frame.message` event.
import {
    AppFrameHost,
    type AppFrameMessage,
    type AppOpenReply,
    type FrameInit,
    type HeaderState,
} from "buckyos/app-frame";
import type { ContentHints, ContentOpenTarget, OpenRequest } from "buckyos/content";
import type { AppOpenRequest } from "buckyos/open-app";

export interface HostedView {
    id: string;
    zone: string;
    app: string;
    appInstance: string;
}

export interface FrameLook {
    mode: "light" | "dark";
    locale: string;
}

export interface FrameHostsOptions {
    formFactor: "desktop" | "mobile";
    container: "desktop-app" | "mobile-app";
    emit: (viewId: string, event: string, payload: unknown) => Promise<void>;
    look: () => FrameLook;
    /** The Zone's accent color, when the account chose one. */
    accent: (zone: string) => string | undefined;
    presentation: (viewId: string) => "window" | "tab";
    onAppOpen: (view: HostedView, request: AppOpenRequest) => Promise<AppOpenReply>;
    onContentOpen: (
        view: HostedView,
        request: OpenRequest,
        target: ContentOpenTarget,
        options: { newWindow: boolean; hints: ContentHints }
    ) => void;
    onTitle: (view: HostedView, title: string, dirty: boolean) => void;
    onRequestClose: (view: HostedView) => void;
    onHeader?: (view: HostedView, header: HeaderState) => void;
}

interface Hosted {
    view: HostedView;
    host: AppFrameHost;
    deliver: (message: unknown) => void;
    focused: boolean;
}

/** An app that does not answer is taken to agree. */
const CLOSE_ANSWER_MS = 5000;

export class FrameHosts {
    private hosts = new Map<string, Hosted>();
    private launches = new Map<string, OpenRequest>();

    constructor(private options: FrameHostsOptions) {}

    private init(view: HostedView): Omit<FrameInit, "nonce"> {
        const look = this.options.look();
        const launch = this.launches.get(view.id);
        return {
            windowId: view.id,
            formFactor: this.options.formFactor,
            theme: { mode: look.mode, accent: this.options.accent(view.zone) },
            locale: look.locale,
            container: this.options.container,
            presentation: this.options.presentation(view.id),
            shellCapabilities: [
                "content.open",
                "app.open",
                "beforeClose",
                "back",
                ...(this.options.formFactor === "mobile" ? ["header"] : []),
            ],
            ...(launch ? { launch } : {}),
        };
    }

    open(view: HostedView): void {
        if (this.hosts.has(view.id)) return;
        let deliver: (message: unknown) => void = () => undefined;
        const host = new AppFrameHost({
            transport: {
                post: (message: AppFrameMessage) => {
                    void this.options.emit(view.id, "frame.message", message).catch((error) => {
                        console.info("[Frame] the view is gone", view.id, error);
                    });
                },
                onMessage: (callback: (message: unknown) => void) => {
                    deliver = callback;
                    return () => {
                        deliver = () => undefined;
                    };
                },
            },
            init: this.init(view),
            onAppOpen: (request) => this.options.onAppOpen(view, request),
            onContentOpen: (request, target, options) => this.options.onContentOpen(view, request, target, options),
            onTitle: (title, dirty) => this.options.onTitle(view, title, dirty),
            onRequestClose: () => this.options.onRequestClose(view),
            onHeader: (header) => this.options.onHeader?.(view, header),
        });
        this.hosts.set(view.id, { view, host, deliver: (message) => deliver(message), focused: false });
    }

    close(viewId: string): void {
        this.hosts.get(viewId)?.host.dispose();
        this.hosts.delete(viewId);
        this.launches.delete(viewId);
    }

    receive(viewId: string, message: unknown): void {
        const hosted = this.hosts.get(viewId);
        // The page may have been reloaded: it gets the look of now.
        hosted?.host.update(this.init(hosted.view));
        hosted?.deliver(message);
    }

    setFocused(viewId: string, focused: boolean): void {
        const hosted = this.hosts.get(viewId);
        if (!hosted) return;
        hosted.focused = focused;
        hosted.host.setFocused(focused);
    }

    /** Theme, accent or language changed. */
    lookChanged(): void {
        const look = this.options.look();
        for (const { view, host } of this.hosts.values()) {
            const init = this.init(view);
            host.update(init);
            host.send("frame.themeChanged", init.theme);
            host.send("frame.localeChanged", { locale: look.locale });
        }
    }

    setLaunch(viewId: string, request: OpenRequest): void {
        this.launches.set(viewId, request);
        const hosted = this.hosts.get(viewId);
        hosted?.host.update(this.init(hosted.view));
    }

    async sendOpen(viewId: string, request: OpenRequest): Promise<"accepted" | "preview" | "refused"> {
        const hosted = this.hosts.get(viewId);
        if (!hosted?.host.ready) return "refused";
        try {
            const answer = await hosted.host.open(request);
            if (answer.accepted) return "accepted";
            return answer.fallback === "preview" ? "preview" : "refused";
        } catch {
            return "refused";
        }
    }

    /** Whether the app agrees to close. `pending`: it is asking its user. */
    async mayClose(viewId: string, reason: "user" | "logout" | "shell" = "user"): Promise<boolean> {
        const hosted = this.hosts.get(viewId);
        if (!hosted?.host.ready) return true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const silent = new Promise<"allow">((resolve) => {
            timer = setTimeout(() => resolve("allow"), CLOSE_ANSWER_MS);
        });
        try {
            return (await Promise.race([hosted.host.beforeClose(reason), silent])) === "allow";
        } catch {
            return true;
        } finally {
            clearTimeout(timer);
        }
    }

    /** True when the app went back by itself. */
    async back(viewId: string): Promise<boolean> {
        const hosted = this.hosts.get(viewId);
        if (!hosted?.host.ready) return false;
        return hosted.host.back().catch(() => false);
    }

    header(viewId: string): HeaderState {
        return this.hosts.get(viewId)?.host.header ?? {};
    }

    headerEvent(viewId: string, event: { kind: "search" | "item" | "menu"; id?: string; value?: string }): void {
        this.hosts.get(viewId)?.host.headerEvent(event);
    }
}
