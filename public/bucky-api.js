(function () {
    if (window.BuckyApi) {
        return;
    }

    let runtimeDetected = false;
    const RUNTIME_HANDSHAKE_KIND = "bucky-runtime-handshake";
    const RUNTIME_HANDSHAKE_RESULT = "bucky-runtime-handshake-result";
    function updateRuntimeFlag(value) {
        runtimeDetected = !!value;
        window.__BuckyOSRuntime = runtimeDetected;
    }
    updateRuntimeFlag(false);

    const pending = new Map();
    let counter = 0;
    const DEFAULT_TIMEOUT = 10_000;
    const NO_TIMEOUT_ACTIONS = new Set(["signWithActiveDid"]);

    function buildId() {
        return `bucky_${Date.now()}_${counter++}`;
    }

    function cleanup(id) {
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
    }

    function callNative(action, payload) {
        return new Promise((resolve, reject) => {
            const id = buildId();
            const timeout = NO_TIMEOUT_ACTIONS.has(action) ? null : DEFAULT_TIMEOUT;
            const timer = timeout
                ? window.setTimeout(() => {
                    cleanup(id);
                    reject(new Error(`BuckyApi request timed out: ${action}`));
                }, timeout)
                : null;
            pending.set(id, { resolve, reject, timer });
            window.parent?.postMessage({ kind: "bucky-api", id, action, payload }, "*");
        });
    }

    window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data) return;
        if (data.kind === RUNTIME_HANDSHAKE_RESULT) {
            updateRuntimeFlag(!!data.runtime);
            return;
        }
        if (data.kind !== "bucky-api-result") return;
        const entry = pending.get(data.id);
        if (!entry) return;
        cleanup(data.id);
        entry.resolve(data.payload);
    });

    try {
        window.parent?.postMessage({ kind: RUNTIME_HANDSHAKE_KIND }, "*");
    } catch (_) {
        // ignore
    }

    window.BuckyApi = {
        getPublicKey() {
            return callNative("getPublicKey", {});
        },
        signWithActiveDid(message) {
            return callNative("signWithActiveDid", { message });
        },
        isBuckyOSRuntime() {
            return runtimeDetected;
        },
    };
})();
