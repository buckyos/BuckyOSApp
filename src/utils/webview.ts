import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { primaryMonitor } from "@tauri-apps/api/window";

const buildAppUrl = (hashPath: string) => {
    const base = import.meta.env.DEV ? "http://localhost:1420" : "tauri://localhost";
    return `${base}/index.html#${hashPath}`;
};

const sanitizeLabel = (raw?: string) => {
    if (!raw) return undefined;
    const cleaned = raw
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+/g, "")
        .replace(/-+$/g, "");
    return cleaned || undefined;
};

const isMobileShell = () => /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);

const buildEmbeddedHash = (target: string, title: string, label: string) =>
    `#/web-container?embedded=1&label=${encodeURIComponent(label)}&src=${encodeURIComponent(
        target
    )}&title=${encodeURIComponent(title)}`;

export interface WebViewWindowOptions {
    width?: number;
    height?: number;
    center?: boolean;
}

export type WebViewOpenMode = "auto" | "inapp" | "window";

export type WebViewClosedCallback<T = unknown> = (userData: T) => void;

export interface OpenWebViewOptions<T = unknown> {
    title?: string;
    label?: string;
    mode?: WebViewOpenMode;
    windowOptions?: WebViewWindowOptions;
    userData?: T;
    onClosed?: WebViewClosedCallback<T>;
}

async function getSafeWindowOptions(options?: WebViewWindowOptions) {
    let screenWidth = window.screen?.width ?? 1920;
    let screenHeight = window.screen?.height ?? 1080;
    let scaleFactor = window.devicePixelRatio || 1;
    try {
        const monitor = await primaryMonitor();
        console.debug("[WebView] primary monitor", monitor);
        if (monitor) {
            screenWidth = monitor.size.width;
            screenHeight = monitor.size.height;
            scaleFactor = monitor.scaleFactor || scaleFactor;
        }
    } catch {
        // ignore, keep fallback screen info
    }
    const logicalWidth = Math.floor(screenWidth / scaleFactor);
    const logicalHeight = Math.floor(screenHeight / scaleFactor);
    const computedWidth = Math.floor(
        Math.min(logicalWidth, Math.max(logicalWidth * (2 / 3), 1024))
    );
    const computedHeight = Math.floor(
        Math.min(logicalHeight, Math.max(computedWidth * (2 / 3), 700))
    );
    return {
        width: options?.width ?? computedWidth,
        height: options?.height ?? computedHeight,
        center: options?.center ?? true,
    };
}

function normalizeTargetUrl(raw: string) {
    const target = raw.trim();
    if (!target) {
        throw new Error("invalid_webview_url");
    }
    if (target.startsWith("/")) {
        return target;
    }
    if (/^https?:\/\//i.test(target)) {
        return target;
    }
    if (/^tauri:\/\//i.test(target)) {
        return target;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        throw new Error("invalid_webview_url_protocol");
    }
    return `https://${target}`;
}

function resolveWebViewArgs<T>(
    titleOrOptions?: string | OpenWebViewOptions<T>,
    label?: string,
    windowOptions?: WebViewWindowOptions,
    userData?: T,
    onClosed?: WebViewClosedCallback<T>
): OpenWebViewOptions<T> {
    if (typeof titleOrOptions === "object" && titleOrOptions !== null) {
        return titleOrOptions;
    }
    return {
        title: titleOrOptions,
        label,
        windowOptions,
        userData,
        onClosed,
    };
}

export async function openWebView<T = unknown>(
    url: string,
    options?: OpenWebViewOptions<T>
): Promise<void>;
export async function openWebView<T = unknown>(
    url: string,
    title?: string,
    label?: string,
    windowOptions?: WebViewWindowOptions,
    userData?: T,
    onClosed?: WebViewClosedCallback<T>
): Promise<void>;
export async function openWebView<T = unknown>(
    url: string,
    titleOrOptions?: string | OpenWebViewOptions<T>,
    label?: string,
    windowOptions?: WebViewWindowOptions,
    userData?: T,
    onClosed?: WebViewClosedCallback<T>
) {
    const options = resolveWebViewArgs(titleOrOptions, label, windowOptions, userData, onClosed);
    const target = normalizeTargetUrl(url);
    let resolvedTitle = options.title?.trim();
    if (!resolvedTitle) {
        try {
            const parsed = new URL(target);
            resolvedTitle = parsed.hostname || target;
        } catch {
            const localName = target.split("/").filter(Boolean).pop();
            resolvedTitle = localName || target;
        }
    }
    let resolvedLabel = sanitizeLabel(options.label?.trim());
    if (!resolvedLabel) {
        resolvedLabel = `webview_${crypto.randomUUID()}`;
    }
    const requestedMode = options.mode ?? "auto";
    const mobileShell = isMobileShell();
    const openInApp = requestedMode === "inapp" || mobileShell;

    if (openInApp) {
        window.location.hash = buildEmbeddedHash(target, resolvedTitle, resolvedLabel);
        return;
    } else if (requestedMode === "window" || requestedMode === "auto") {
        const existing = await WebviewWindow.getByLabel(resolvedLabel);
        if (existing) {
            await existing.setFocus();
            return;
        }
    }
    const containerUrl = buildAppUrl(
        `/web-container?label=${encodeURIComponent(resolvedLabel)}&src=${encodeURIComponent(
            target
        )}&title=${encodeURIComponent(resolvedTitle)}`
    );
    const safeOptions = await getSafeWindowOptions(options.windowOptions);
    console.debug("[WebView] open url window", { label: resolvedLabel, containerUrl, title: resolvedTitle, windowOptions: safeOptions });
    const webviewWindow = new WebviewWindow(resolvedLabel, {
        url: containerUrl,
        title: resolvedTitle,
        width: safeOptions?.width,
        height: safeOptions?.height,
        center: safeOptions?.center,
    });
    if (options.onClosed) {
        await webviewWindow.once("tauri://destroyed", () => {
            options.onClosed?.(options.userData as T);
        });
    }
}
