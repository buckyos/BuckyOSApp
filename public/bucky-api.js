(function () {
    if (window.BuckyApi) {
        return;
    }

    const pending = new Map();
    const eventListeners = new Map();
    let counter = 0;
    const DEFAULT_TIMEOUT = 10_000;
    const NO_TIMEOUT_ACTIONS = new Set(["signJsonWithActiveDid"]);
    const directInvoke = typeof window.__TAURI_INTERNALS__?.invoke === "function"
        ? window.__TAURI_INTERNALS__.invoke
        : null;

    const DIRECT_COMMANDS = {
        startRecording: { command: "start_recording", buildArgs: (payload) => ({ options: payload || {} }) },
        pauseRecording: { command: "pause_recording", buildArgs: (payload) => ({ recordId: payload?.record_id || "" }) },
        resumeRecording: { command: "resume_recording", buildArgs: (payload) => ({ recordId: payload?.record_id || "" }) },
        stopRecording: { command: "stop_recording", buildArgs: (payload) => ({ recordId: payload?.record_id || "" }) },
        cancelRecording: { command: "cancel_recording", buildArgs: (payload) => ({ recordId: payload?.record_id || "" }) },
        getRecordingStatus: { command: "get_recording_status", buildArgs: () => ({}) },
        listRecordings: { command: "list_recordings", buildArgs: () => ({}) },
        getRecordingFileInfo: { command: "get_recording_file_info", buildArgs: (payload) => ({ recordId: payload?.record_id || "" }) },
        readRecordingFile: { command: "read_recording_file", buildArgs: (payload) => ({ recordId: payload?.record_id || "", offset: payload?.offset || 0, length: payload?.length || 0 }) },
        getRecordingUrl: { command: "get_recording_url", buildArgs: (payload) => ({ recordId: payload?.record_id || "" }) },
        exportRecordingFile: { command: "export_recording_file", buildArgs: (payload) => ({ recordId: payload?.record_id || "", targetPath: payload?.target_path || "" }) },
        playRecording: { command: "play_recording", buildArgs: (payload) => ({ recordId: payload?.record_id || "" }) },
        stopPlayback: { command: "stop_playback", buildArgs: () => ({}) },
        getPlaybackStatus: { command: "get_playback_status", buildArgs: () => ({}) },
        getRecordingPermissions: { command: "get_recording_permissions", buildArgs: () => ({}) },
        requestRecordingPermissions: { command: "request_recording_permissions", buildArgs: () => ({}) },
        checkRecordingReadiness: { command: "check_recording_readiness", buildArgs: () => ({}) },
        markAudioInterruptionBegin: { command: "mark_audio_interruption_begin", buildArgs: (payload) => ({ reason: payload?.reason || "test" }) },
        markAudioInterruptionEnd: { command: "mark_audio_interruption_end", buildArgs: () => ({}) },
    };

    function buildId() {
        return `bucky_${Date.now()}_${counter++}`;
    }

    function cleanup(id) {
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
    }

    function callDirect(action, payload) {
        const entry = DIRECT_COMMANDS[action];
        if (!entry || !directInvoke) {
            return Promise.reject(new Error(`BuckyApi bridge unavailable: ${action}`));
        }
        return directInvoke(entry.command, entry.buildArgs(payload));
    }

    function callNative(action, payload) {
        if ((!window.parent || window.parent === window) && directInvoke) {
            return callDirect(action, payload);
        }
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

    window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data || typeof data !== "object") return;
        if (data.kind !== "bucky-api-event") return;

        const { event: eventName, payload } = data;
        const listeners = eventListeners.get(eventName);
        if (!listeners || listeners.length === 0) return;

        listeners.forEach((listener) => {
            try {
                listener(payload);
            } catch (err) {
                console.warn("BuckyApi event listener error", err);
            }
        });
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
        listRecordings() {
            return callNative("listRecordings", {});
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
        markAudioInterruptionEnd() {
            return callNative("markAudioInterruptionEnd", {});
        },
        onEvent(eventName, handler) {
            if (typeof eventName !== "string" || typeof handler !== "function") {
                return () => {};
            }
            const list = eventListeners.get(eventName) || [];
            list.push(handler);
            eventListeners.set(eventName, list);
            return () => {
                const updated = eventListeners.get(eventName) || [];
                const next = updated.filter((item) => item !== handler);
                if (next.length > 0) {
                    eventListeners.set(eventName, next);
                    return;
                }
                eventListeners.delete(eventName);
            };
        },
    };
})();
