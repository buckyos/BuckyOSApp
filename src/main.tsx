import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./i18n";
import {
    checkRecordingReadiness,
    getRecordingFileInfo,
    getRecordingPermissions,
    getRecordingStatus,
    startRecording,
    stopRecording,
} from "./features/audio/api";

const smokeWindow = window as Window & { __BUCKY_AUDIO_SMOKE_STARTED__?: boolean };

function installBootstrapDiagnostics() {
    const panel = document.createElement("pre");
    panel.id = "bootstrap-diagnostics";
    panel.style.position = "fixed";
    panel.style.left = "8px";
    panel.style.right = "8px";
    panel.style.top = "8px";
    panel.style.zIndex = "2147483647";
    panel.style.padding = "10px 12px";
    panel.style.margin = "0";
    panel.style.borderRadius = "10px";
    panel.style.background = "rgba(15, 23, 42, 0.92)";
    panel.style.color = "#e2e8f0";
    panel.style.font = "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.pointerEvents = "none";
    panel.style.maxHeight = "45vh";
    panel.style.overflow = "hidden";

    const lines: string[] = [];
    const write = (message: string) => {
        lines.push(message);
        panel.textContent = lines.join("\n");
    };

    write(`[boot] href=${window.location.href}`);
    write(`[boot] ua=${window.navigator.userAgent}`);

    window.addEventListener("error", (event) => {
        write(`[error] ${event.message}`);
    });
    window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
        write(`[reject] ${reason}`);
    });

    document.addEventListener("DOMContentLoaded", () => write("[boot] domcontentloaded"), { once: true });
    document.body.appendChild(panel);

    return write;
}

const shouldShowBootstrapDiagnostics = import.meta.env.DEV
    && (window.location.hash.includes("bootstrap-debug") || window.location.search.includes("bootstrap-debug=1"));
const bootstrapLog = shouldShowBootstrapDiagnostics ? installBootstrapDiagnostics() : (() => undefined);
bootstrapLog("[boot] diagnostics installed");

if (window.location.hash.includes("/audio-smoke") && !smokeWindow.__BUCKY_AUDIO_SMOKE_STARTED__) {
    smokeWindow.__BUCKY_AUDIO_SMOKE_STARTED__ = true;
    bootstrapLog("[boot] audio smoke autorun start");
    void (async () => {
        try {
            await getRecordingPermissions();
            const readiness = await checkRecordingReadiness();
            if (!readiness.ready) {
                return;
            }

            const started = await startRecording({ sample_rate: 44100, channels: 1, format: "wav" });
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            await getRecordingStatus();
            await stopRecording(started.record_id);
            await getRecordingFileInfo(started.record_id);
            bootstrapLog("[boot] audio smoke autorun ok");
        } catch (error) {
            console.error("[audio-smoke] autorun failed", error);
            bootstrapLog(`[boot] audio smoke autorun failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    })();
}

bootstrapLog("[boot] creating react root");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <I18nProvider>
            <App />
        </I18nProvider>
    </React.StrictMode>,
);
bootstrapLog("[boot] react render invoked");
