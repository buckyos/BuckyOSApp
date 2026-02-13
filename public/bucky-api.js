(function () {
    if (window.BuckyApi) {
        return;
    }

    const pending = new Map();
    let counter = 0;
    const DEFAULT_TIMEOUT = 10_000;
    const NO_TIMEOUT_ACTIONS = new Set(["signJsonWithActiveDid"]);

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
            if (!window.parent || window.parent === window) {
                reject(new Error(`BuckyApi bridge unavailable: ${action}`));
                return;
            }
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
        if (data.kind !== "bucky-api-result") return;
        const entry = pending.get(data.id);
        if (!entry) return;
        cleanup(data.id);
        entry.resolve(data.payload);
    });

    window.BuckyApi = {
        getPublicKey() {
            return callNative("getPublicKey", {});
        },
        getCurrentUser() {
            return callNative("getCurrentUser", {});
        },
        signJsonWithActiveDid(payloads) {
            return callNative("signJsonWithActiveDid", { payloads });
        },
        startRecording(options) {
            return callNative("startRecording", options || {});
        },
        pauseRecording(record_id) {
            return callNative("pauseRecording", { record_id });
        },
        resumeRecording(record_id) {
            return callNative("resumeRecording", { record_id });
        },
        stopRecording(record_id) {
            return callNative("stopRecording", { record_id });
        },
        cancelRecording(record_id) {
            return callNative("cancelRecording", { record_id });
        },
        getRecordingStatus() {
            return callNative("getRecordingStatus", {});
        },
        getRecordingFileInfo(record_id) {
            return callNative("getRecordingFileInfo", { record_id });
        },
        readRecordingFile(record_id, offset, length) {
            return callNative("readRecordingFile", { record_id, offset, length });
        },
        getRecordingUrl(record_id) {
            return callNative("getRecordingUrl", { record_id });
        },
        exportRecordingFile(record_id, target_path) {
            return callNative("exportRecordingFile", { record_id, target_path });
        },
        playRecording(record_id) {
            return callNative("playRecording", { record_id });
        },
        stopPlayback() {
            return callNative("stopPlayback", {});
        },
        getPlaybackStatus() {
            return callNative("getPlaybackStatus", {});
        },
        getRecordingPermissions() {
            return callNative("getRecordingPermissions", {});
        },
        requestRecordingPermissions() {
            return callNative("requestRecordingPermissions", {});
        },
        checkRecordingReadiness() {
            return callNative("checkRecordingReadiness", {});
        },
        markAudioInterruptionBegin(reason) {
            return callNative("markAudioInterruptionBegin", { reason });
        },
    };
})();
