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

export interface WebViewWindowOptions {
    width?: number;
    height?: number;
    center?: boolean;
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

export async function openWebView(url: string, title?: string, label?: string, windowOptions?: WebViewWindowOptions) {
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
        target = `https://${target}`;
    }
    let resolvedTitle = title?.trim();
    if (!resolvedTitle) {
        try {
            const parsed = new URL(target);
            resolvedTitle = parsed.hostname || target;
        } catch {
            resolvedTitle = target;
        }
    }
    let resolvedLabel = sanitizeLabel(label?.trim());
    if (!resolvedLabel) {
        resolvedLabel = `webview_${crypto.randomUUID()}`;
    } else {
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
    const safeOptions = await getSafeWindowOptions(windowOptions);
    console.debug("[WebView] open url window", { label: resolvedLabel, containerUrl, title: resolvedTitle, windowOptions: safeOptions });
    new WebviewWindow(resolvedLabel, {
        url: containerUrl,
        title: resolvedTitle,
        width: safeOptions?.width,
        height: safeOptions?.height,
        center: safeOptions?.center,
    });
}
