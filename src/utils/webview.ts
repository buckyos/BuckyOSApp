import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const buildAppUrl = (hashPath: string) => {
    const base = import.meta.env.DEV ? "http://localhost:1420" : "tauri://localhost";
    return `${base}/index.html#${hashPath}`;
};

export async function openWebView(url: string) {
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
        target = `https://${target}`;
    }
    const label = `webview_${crypto.randomUUID()}`;
    const containerUrl = buildAppUrl(
        `/web-container?label=${encodeURIComponent(label)}&src=${encodeURIComponent(target)}`
    );
    console.debug("[WebView] open url window", { label, containerUrl });
    new WebviewWindow(label, { url: containerUrl });
}
