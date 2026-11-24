// The phone's content views are native WebViews below this page (`content/mobile`): this page says
// where they show, whose the touches are, and what the back button does.
import { onBackButtonPress } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type { ViewInfo } from "./types";

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type ViewStatus = "loading" | "ready" | "password" | "network" | "denied" | "error";

/** What `content_*` and `content://view` tell about a view on a phone. */
export interface MobileView extends ViewInfo {
    presentation: "window" | "tab";
    /** Anything but `ready` is for this page to show in the view's place. */
    status: ViewStatus;
    detail: string;
    /** It lost its WebView to save memory and loads again when it comes to the front. */
    discarded: boolean;
}

export interface NativeLabels {
    serviceTitle: string;
    serviceConnected: string;
    serviceWaiting: string;
    serviceSignIn: string;
    channelService: string;
    channelSilent: string;
    channelSound: string;
    channelUrgent: string;
    channelDownloads: string;
    channelPlayback: string;
    channelRecording: string;
    playing: string;
    play: string;
    pause: string;
    previous: string;
    next: string;
    stop: string;
    /** With `{app}`. */
    recording: string;
    signTitle: string;
    /** With `{app}` and `{zone}`. */
    signAsk: string;
    /** With `{zone}`: the host of a device being activated. */
    signDevice: string;
    /** With `{app}`: the identity that signs. */
    signIdentity: string;
    signPassword: string;
    signWrong: string;
    confirm: string;
    cancel: string;
    allow: string;
    deny: string;
    /** With `{app}`. */
    micAsk: string;
}

export interface NativeStatus {
    batteryUnrestricted: boolean;
    serviceRunning: boolean;
    multiProfile: boolean;
    webview: string;
}

export interface AudioStatus {
    /** Views whose sound goes on in the background. */
    playing: string[];
    recording: { view: string; zone: string; app: string } | null;
}

export const AUDIO_STATUS_EVENT = "audio://status";

export const listMobileViews = () => invoke<MobileView[]>("content_list");
/** One page back in the view's own history; false when there is none. */
export const viewBack = (id: string) => invoke<boolean>("content_back", { id });
export const retryView = (id: string) => invoke<void>("content_retry", { id });
export const toBackground = () => invoke<void>("app_to_background");
export const setNativeLabels = (labels: NativeLabels) => invoke<void>("native_set_labels", { labels });
export const nativeStatus = () => invoke<NativeStatus>("native_status");
export const openSystemSettings = (page: "battery" | "notifications" | "app") => invoke<void>("native_open_settings", { page });
export const audioStatus = () => invoke<AudioStatus>("audio_status");

type Measured = Pick<Element, "getBoundingClientRect">;

const round = (value: number) => Math.round(value * 2) / 2;

function rectOf(element: Measured): Rect {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

// ---- where ----

let told: { view: string | null; rect?: Rect; background?: string } | null = null;

async function layout(next: { view: string | null; rect?: Rect; background?: string }): Promise<void> {
    if (same(told, next)) return;
    told = next;
    // Styles make this page transparent where the view shows (`[data-content-view]`).
    globalThis.document?.documentElement.toggleAttribute("data-content-view", next.view !== null);
    try {
        await invoke("content_layout", { layout: next });
    } catch (error) {
        // The view is gone; the next layout must not be taken for this one.
        if (told === next) told = null;
        throw error;
    }
}

/** A view came to the front without this page laying it out (it was opened or focused). `back`: what
 * the stage shows comes to the front again. */
export function frontChanged(view: string, back = false): void {
    if (told && told.view !== view) told = null;
    if (back) ViewStage.restore();
}

/** Shows a view in front, at a place of this page (CSS px). */
export const layoutView = (view: string, rect: Rect, background?: string) =>
    layout({ view, rect, ...(background ? { background } : {}) });

/** Shows this page alone. */
export const hideViews = () => layout({ view: null });

/** Keeps a view over an element of this page while it is mounted. */
export class ViewStage {
    private static current: ViewStage | null = null;
    private element: Element | null = null;
    private view: string | null = null;
    private observer: ResizeObserver | null = null;

    constructor(private readonly background: () => string | undefined = () => undefined) {}

    mount(element: Element, view: string): void {
        this.element = element;
        this.view = view;
        ViewStage.current = this;
        this.observer?.disconnect();
        this.observer = new ResizeObserver(this.update);
        this.observer.observe(element);
        window.addEventListener("resize", this.update);
        window.addEventListener("android-window-insets-change", this.update);
        this.update();
    }

    update = (): void => {
        if (ViewStage.current !== this || !this.element || !this.view) return;
        const rect = rectOf(this.element);
        if (rect.width <= 0 || rect.height <= 0) return;
        void layoutView(this.view, rect, this.background()).catch((error) => console.warn("[Views] layout", error));
    };

    static restore(): void {
        ViewStage.current?.update();
    }

    /** The view goes out of sight unless another stage took over. */
    unmount(): void {
        this.observer?.disconnect();
        this.observer = null;
        window.removeEventListener("resize", this.update);
        window.removeEventListener("android-window-insets-change", this.update);
        this.element = null;
        this.view = null;
        if (ViewStage.current !== this) return;
        ViewStage.current = null;
        void hideViews().catch(() => undefined);
    }
}

// ---- whose the touches are ----

/** What this page draws over a view. */
export class Overlays {
    private modals = 0;
    private elements = new Set<Measured>();
    private told = "";

    /** Something over everything (a dialog, a menu, the app switcher); call the result to end it. */
    open(): () => void {
        let open = true;
        this.modals += 1;
        this.update();
        return () => {
            if (!open) return;
            open = false;
            this.modals -= 1;
            this.update();
        };
    }

    /** A part of the view's place that stays this page's (a floating header, a toast). */
    block(element: Measured): () => void {
        this.elements.add(element);
        this.update();
        return () => {
            if (this.elements.delete(element)) this.update();
        };
    }

    /** After blocks moved. */
    update(): void {
        const overlay = { modal: this.modals > 0, blocks: [...this.elements].map(rectOf) };
        const text = JSON.stringify(overlay);
        if (text === this.told) return;
        this.told = text;
        void invoke("content_overlay", { overlay }).catch((error) => console.warn("[Views] overlay", error));
    }
}

export const overlays = new Overlays();

// ---- back ----

export type BackHandler = () => boolean | Promise<boolean>;

/** The system's back button: the handler added last that takes it, else the fallback. */
export class BackStack {
    private handlers: BackHandler[] = [];
    private busy = false;

    /** `handler` answers whether it did something. */
    push(handler: BackHandler): () => void {
        this.handlers.push(handler);
        return () => {
            const at = this.handlers.lastIndexOf(handler);
            if (at >= 0) this.handlers.splice(at, 1);
        };
    }

    /** False while an earlier press is still being answered. */
    async back(fallback: () => unknown): Promise<boolean> {
        if (this.busy) return false;
        this.busy = true;
        try {
            for (const handler of [...this.handlers].reverse()) {
                if (await handler()) return true;
            }
            await fallback();
            return true;
        } finally {
            this.busy = false;
        }
    }

    /** From here on the button is this page's; `fallback` is what happens at the root. */
    async start(fallback: () => unknown = toBackground): Promise<() => void> {
        const listener = await onBackButtonPress(() => void this.back(fallback));
        return () => void listener.unregister();
    }
}

export const backStack = new BackStack();
