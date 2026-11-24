// window.BuckyApi: the native bridge of the BuckyOS client (doc/BuckyApi.md).
//
// Three ways to the client, chosen by where this document runs:
//  - a content view on the desktop: the top document of a native window, through Tauri's IPC;
//  - a content view on a phone: the top document of a native WebView, through `__buckyPort`;
//  - the test page: a frame inside a local page of the client, through that page.
// Any other document gets no bridge.
(function () {
    if (window.BuckyApi) return;

    const env = window.__BUCKY_ENV__ || null;
    const isTop = window.top === window;
    const ipc = isTop && env && window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.invoke : null;
    const port = isTop && env && window.__buckyPort ? window.__buckyPort : null;
    // Only a local page of the client answers; a frame inside some other page has no one to ask.
    const LOCAL_PAGE = /^(tauri:\/\/localhost|https?:\/\/tauri\.localhost|http:\/\/[^/]+:1420)$/;
    const framed = !isTop && !env && LOCAL_PAGE.test(window.location.ancestorOrigins?.[0] ?? "");
    if (!ipc && !port && !framed) return;

    const FRAME_TIMEOUT = 10_000;
    // The user is asked something; there is no telling how long that takes.
    const NO_TIMEOUT_ACTIONS = new Set(["signJsonWithActiveDid"]);
    const pending = new Map();
    let counter = 0;

    function nextId() {
        return `bucky_${Date.now()}_${counter++}`;
    }

    function bridgeError(failure) {
        const code = typeof failure?.code === "string" ? failure.code : "failed";
        const error = new Error(typeof failure?.message === "string" ? failure.message : String(failure ?? code));
        error.code = code;
        return error;
    }

    // ---- content views ----

    const ipcInvoke = ipc;
    const portPost = port ? port.postMessage.bind(port) : null;

    function callNative(name, payload) {
        if (ipcInvoke) {
            return ipcInvoke("bucky_api_call", { name, payload: payload ?? null }).catch((failure) => {
                throw bridgeError(failure);
            });
        }
        return new Promise((resolve, reject) => {
            const id = nextId();
            pending.set(id, { resolve, reject });
            portPost(JSON.stringify({ id, name, payload: payload ?? null }));
        });
    }

    if (port) {
        port.onmessage = (event) => {
            let reply;
            try {
                reply = JSON.parse(event.data);
            } catch {
                return;
            }
            const entry = pending.get(reply?.id);
            if (!entry) return;
            pending.delete(reply.id);
            if (reply.ok) entry.resolve(reply.data);
            else entry.reject(bridgeError(reply.error));
        };
    }

    const listeners = new Map();

    function on(event, handler) {
        const handlers = listeners.get(event) ?? new Set();
        handlers.add(handler);
        listeners.set(event, handlers);
        return () => handlers.delete(handler);
    }

    // Called by the client, which evaluates it in this document.
    Object.defineProperty(window, "__buckyEmit", {
        value(event, payload) {
            for (const handler of [...(listeners.get(event) ?? [])]) {
                try {
                    handler(payload);
                } catch (error) {
                    console.error("[BuckyApi] handler failed", event, error);
                }
            }
        },
    });

    // ---- the test page ----

    function callFrameHost(action, payload) {
        return new Promise((resolve, reject) => {
            const id = nextId();
            const timer = NO_TIMEOUT_ACTIONS.has(action)
                ? null
                : window.setTimeout(() => {
                    pending.delete(id);
                    reject(new Error(`BuckyApi request timed out: ${action}`));
                }, FRAME_TIMEOUT);
            pending.set(id, { resolve, timer });
            window.parent.postMessage({ kind: "bucky-api", id, action, payload }, "*");
        });
    }

    if (framed) {
        window.addEventListener("message", (event) => {
            if (event.source !== window.parent || event.data?.kind !== "bucky-api-result") return;
            const entry = pending.get(event.data.id);
            if (!entry) return;
            pending.delete(event.data.id);
            clearTimeout(entry.timer);
            entry.resolve(event.data.payload);
        });
    }

    const action = framed
        ? callFrameHost
        // The five wallet methods answer { code, data, message } rather than throwing.
        : (name, payload) => callNative(name, payload).catch((error) => ({ code: 2, message: error.message }));

    const api = {
        getPublicKey() {
            return action("getPublicKey", {});
        },
        getCurrentUser() {
            return action("getCurrentUser", {});
        },
        openExternalUrl(url) {
            return action("openExternalUrl", { url });
        },
        resolve_did(did, docType = null) {
            return action("resolve_did", { did, docType });
        },
        signJsonWithActiveDid(payloads) {
            return action("signJsonWithActiveDid", { payloads });
        },
    };
    if (!framed) {
        api.env = Object.freeze({ ...env, capabilities: Object.freeze([...(env.capabilities ?? [])]) });
        api.call = callNative;
        api.on = on;
    }
    window.BuckyApi = api;

    // ---- which Zone this window belongs to ----

    if (!framed && env.accent && env.container === "desktop-app") {
        const draw = () => {
            if (!document.documentElement) return;
            const host = document.createElement("bucky-zone-mark");
            const root = host.attachShadow({ mode: "closed" });
            const line = document.createElement("div");
            line.style.cssText = `position:fixed;inset:0 0 auto 0;height:2px;background:${env.accent};z-index:2147483647;pointer-events:none`;
            root.append(line);
            document.documentElement.append(host);
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw, { once: true });
        else draw();
    }
})();
