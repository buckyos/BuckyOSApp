import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

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

export async function openWebView(url: string, title?: string, label?: string) {
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
    console.debug("[WebView] open url window", { label: resolvedLabel, containerUrl, title: resolvedTitle });
    new WebviewWindow(resolvedLabel, { url: containerUrl, title: resolvedTitle });
}
