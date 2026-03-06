import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  checkRecordingReadiness,
  getRecordingFileInfo,
  getRecordingPermissions,
  getRecordingStatus,
  startRecording,
  stopRecording,
} from "../features/audio/api";

type LogEntry = {
  id: number;
  title: string;
  payload: unknown;
};

export default function AudioSmokePage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [recordId, setRecordId] = useState("");

  const appendLog = (title: string, payload: unknown) => {
    setEntries((current) => [
      ...current,
      { id: current.length + 1, title, payload },
    ]);
  };

  const environment = useMemo(
    () => ({
      href: window.location.href,
      userAgent: window.navigator.userAgent,
      tauriInvokeAvailable: Boolean(
        (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke
      ),
      startedAt: new Date().toISOString(),
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      appendLog("environment", environment);

      try {
        const permissions = await getRecordingPermissions();
        if (cancelled) return;
        appendLog("getRecordingPermissions", permissions);

        const readiness = await checkRecordingReadiness();
        if (cancelled) return;
        appendLog("checkRecordingReadiness", readiness);

        if (!readiness.ready) {
          appendLog("record-smoke:stopped", { reason: "not_ready" });
          return;
        }

        const started = await startRecording({ sample_rate: 44100, channels: 1, format: "caf" });
        if (cancelled) return;
        setRecordId(started.record_id);
        appendLog("startRecording", started);

        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        if (cancelled) return;

        const status = await getRecordingStatus();
        if (cancelled) return;
        appendLog("getRecordingStatus", status);

        const stopped = await stopRecording(started.record_id);
        if (cancelled) return;
        appendLog("stopRecording", stopped);

        const fileInfo = await getRecordingFileInfo(started.record_id);
        if (cancelled) return;
        appendLog("getRecordingFileInfo", fileInfo);
      } catch (error) {
        appendLog("record-smoke:error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [environment]);

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "20px 16px 40px",
        background: "linear-gradient(180deg, #f6f7fb 0%, #edf2f7 100%)",
        color: "#0f172a",
        fontFamily: '"SF Pro Display", "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: 16 }}>
        <section
          style={{
            background: "rgba(255,255,255,0.92)",
            border: "1px solid #d7deea",
            borderRadius: 20,
            padding: 18,
            boxShadow: "0 18px 48px rgba(15, 23, 42, 0.08)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b", textTransform: "uppercase" }}>
            Audio Smoke
          </div>
          <button
            onClick={() => navigate(-1)}
            style={{
              marginTop: 10,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
            }}
          >
            Back
          </button>
          <h1 style={{ margin: "8px 0 6px", fontSize: 28, lineHeight: 1.1 }}>iOS Recording Check</h1>
          <p style={{ margin: 0, color: "#475569", fontSize: 15, lineHeight: 1.5 }}>
            This page auto-runs `permission -&gt; readiness -&gt; start -&gt; status -&gt; stop -&gt; file info` and keeps every step visible for screenshots.
          </p>
          <div style={{ marginTop: 12, fontSize: 13, color: "#334155" }}>
            Current Record ID: <strong>{recordId || "pending"}</strong>
          </div>
        </section>

        {entries.map((entry) => (
          <section
            key={entry.id}
            style={{
              background: "rgba(255,255,255,0.96)",
              border: "1px solid #d7deea",
              borderRadius: 18,
              padding: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", marginBottom: 8 }}>
              {entry.id}. {entry.title}
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
                lineHeight: 1.5,
                color: "#0f172a",
              }}
            >
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </section>
        ))}
      </div>
    </main>
  );
}
