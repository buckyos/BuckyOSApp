import React from "react";
import { useI18n } from "../i18n";
import { useDidContext } from "../features/did/DidContext";
import InputDialog from "../components/ui/InputDialog";
import { JsonSignPayload, signJsonWithActiveDid } from "../features/did/api";
import { fetchSnStatus, getCachedSnStatus } from "../features/sn/snStatusManager";
import { createRoot, Root } from "react-dom/client";
import { BuckyErrorCodes } from "./buckyErrorCodes";
import { parseCommandError } from "../utils/commandError";
import { CommandErrorCodes } from "../constants/commandErrorCodes";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type IframeActionHandler = (payload: any) => unknown | Promise<unknown>;

export interface UseIframeBridgeOptions {
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    handlers: Record<string, IframeActionHandler>;
    kind?: string;
}

export function useIframeBridge({ iframeRef, handlers, kind = "bucky-api" }: UseIframeBridgeOptions) {
    React.useEffect(() => {
        const listener = (event: MessageEvent) => {
            const iframeWindow = iframeRef.current?.contentWindow;
            if (!iframeWindow || event.source !== iframeWindow) return;
            const data = event.data;
            if (!data || typeof data !== "object") return;
            if (data.kind !== kind) return;
            const { action, id, payload } = data as { action?: string; id?: string; payload?: any };
            if (typeof action !== "string" || typeof id !== "string") return;
            const respond = (responsePayload: unknown) => {
                iframeWindow.postMessage({ kind: `${kind}-result`, id, payload: responsePayload }, "*");
            };
            const handlerFn = handlers[action];
            if (!handlerFn) {
                respond({ code: BuckyErrorCodes.UnknownAction, message: `Unknown action: ${action}` });
                return;
            }
            Promise.resolve(handlerFn(payload ?? {}))
                .then(respond)
                .catch((error) => {
                    const { message } = parseCommandError(error);
                    respond({ code: BuckyErrorCodes.NativeError, message });
                });
        };
        window.addEventListener("message", listener);
        return () => window.removeEventListener("message", listener);
    }, [iframeRef, handlers, kind]);
}

type SignState = {
    open: boolean;
    value: string;
    error: string;
    loading: boolean;
    payloadsToSign: JsonSignPayload[];
};

type RecordingStatus = "idle" | "recording" | "stopping" | "stopped";

type RecordingResult = {
    filePath: string;
    url: string;
    mimeType: string;
    durationMs: number;
    size: number;
    sampleRate?: number;
    channels?: number;
};

export function useBuckyIframeActions(options?: { iframeRef?: React.RefObject<HTMLIFrameElement | null> }) {
    const { t } = useI18n();
    const { activeDid } = useDidContext();
    const iframeRef = options?.iframeRef ?? React.useRef<HTMLIFrameElement | null>(null);
    const [passwordDialog, setPasswordDialog] = React.useState<SignState>({
        open: false,
        value: "",
        error: "",
        loading: false,
        payloadsToSign: [],
    });
    const [signInProgress, setSignInProgress] = React.useState(false);
    const resolverRef = React.useRef<((result: any) => void) | null>(null);
    const portalContainerRef = React.useRef<HTMLDivElement | null>(null);
    const portalRootRef = React.useRef<Root | null>(null);
    const recordingStatusRef = React.useRef<RecordingStatus>("idle");
    const recordingSessionRef = React.useRef<string | null>(null);
    const recordingStartedAtRef = React.useRef<number | null>(null);
    const recordingLastResultRef = React.useRef<RecordingResult | null>(null);

    const publicKey = React.useMemo(() => {
        const wallet = activeDid?.bucky_wallets?.[0];
        return wallet?.public_key ? wallet.public_key : null;
    }, [activeDid?.bucky_wallets, activeDid?.id]);

    const ensureRecordingPermission = React.useCallback(async () => {
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
        if (!isMobile) return true;
        if (!navigator.mediaDevices?.getUserMedia) return true;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((track) => track.stop());
            return true;
        } catch {
            return false;
        }
    }, []);

    const resolveMimeType = React.useCallback((filePath: string) => {
        if (filePath.endsWith(".m4a")) return "audio/mp4";
        if (filePath.endsWith(".wav")) return "audio/wav";
        if (filePath.endsWith(".aac")) return "audio/aac";
        return "application/octet-stream";
    }, []);

    const getRecordingStatus = React.useCallback(async (payload: { sessionId?: string }) => {
        const sessionId = payload?.sessionId;
        if (!sessionId || sessionId !== recordingSessionRef.current) {
            return { code: BuckyErrorCodes.NativeError, message: "Invalid recording session." };
        }
        try {
            const status = await invoke<{ state: "idle" | "recording" | "paused"; durationMs: number }>(
                "recording_status",
                { request: { sessionId } },
            );
            const startedAt = recordingStartedAtRef.current;
            const durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
            const last = recordingLastResultRef.current;
            const mappedStatus: RecordingStatus = status.state === "recording" || status.state === "paused"
                ? "recording"
                : last
                    ? "stopped"
                    : "idle";
            recordingStatusRef.current = mappedStatus;
            return {
                code: BuckyErrorCodes.Success,
                data: {
                    status: mappedStatus,
                    durationMs: status.durationMs ?? (mappedStatus === "stopped" ? last?.durationMs ?? durationMs : durationMs),
                    hasResult: Boolean(last),
                    mimeType: last?.mimeType,
                    size: last?.size,
                },
            };
        } catch (error) {
            const { message } = parseCommandError(error);
            return { code: BuckyErrorCodes.NativeError, message };
        }
    }, []);

    const startRecording = React.useCallback(async (payload: { maxDurationMs?: number }) => {
        if (recordingStatusRef.current === "recording" || recordingStatusRef.current === "stopping") {
            return { code: BuckyErrorCodes.Busy, message: "Recording already in progress." };
        }
        const hasPermission = await ensureRecordingPermission();
        if (!hasPermission) {
            return { code: BuckyErrorCodes.NativeError, message: "Microphone permission denied." };
        }
        try {
            const maxDurationMs = payload?.maxDurationMs && payload.maxDurationMs > 0
                ? payload.maxDurationMs
                : 0;
            const response = await invoke<{ sessionId: string; mimeType: string }>("recording_start", {
                request: { maxDurationMs },
            });
            recordingStatusRef.current = "recording";
            recordingSessionRef.current = response.sessionId;
            recordingStartedAtRef.current = Date.now();
            recordingLastResultRef.current = null;
            return {
                code: BuckyErrorCodes.Success,
                data: {
                    sessionId: response.sessionId,
                    mimeType: response.mimeType,
                },
            };
        } catch (error) {
            const { message } = parseCommandError(error);
            return { code: BuckyErrorCodes.NativeError, message };
        }
    }, [ensureRecordingPermission]);

    const stopRecording = React.useCallback(async (payload: { sessionId?: string }) => {
        const sessionId = payload?.sessionId;
        if (!sessionId || sessionId !== recordingSessionRef.current) {
            return { code: BuckyErrorCodes.NativeError, message: "Invalid recording session." };
        }
        try {
            recordingStatusRef.current = "stopping";
            const result = await invoke<{
                filePath: string;
                durationMs: number;
                fileSize: number;
                sampleRate?: number;
                channels?: number;
            }>("recording_stop", { request: { sessionId } });
            const url = convertFileSrc(result.filePath);
            const recordingResult: RecordingResult = {
                filePath: result.filePath,
                url,
                mimeType: resolveMimeType(result.filePath),
                durationMs: result.durationMs,
                size: result.fileSize,
                sampleRate: result.sampleRate,
                channels: result.channels,
            };
            recordingStatusRef.current = "stopped";
            recordingLastResultRef.current = recordingResult;
            return { code: BuckyErrorCodes.Success, data: recordingResult };
        } catch (error) {
            const { message } = parseCommandError(error);
            recordingStatusRef.current = "idle";
            return { code: BuckyErrorCodes.NativeError, message };
        }
    }, [resolveMimeType]);

    const cancelRecording = React.useCallback(async (payload: { sessionId?: string }) => {
        const sessionId = payload?.sessionId;
        if (!sessionId || sessionId !== recordingSessionRef.current) {
            return { code: BuckyErrorCodes.NativeError, message: "Invalid recording session." };
        }
        if (recordingStatusRef.current !== "recording") {
            recordingStatusRef.current = "idle";
            recordingLastResultRef.current = null;
            return { code: BuckyErrorCodes.Cancelled, message: "Recording cancelled." };
        }
        try {
            recordingStatusRef.current = "stopping";
            await invoke("recording_cancel", { request: { sessionId } });
            recordingStatusRef.current = "idle";
            recordingLastResultRef.current = null;
            return { code: BuckyErrorCodes.Cancelled, message: "Recording cancelled." };
        } catch (error) {
            const { message } = parseCommandError(error);
            recordingStatusRef.current = "idle";
            return { code: BuckyErrorCodes.NativeError, message };
        }
    }, []);

    const actionHandlers = React.useMemo(() => ({
        getPublicKey: () => {
            if (publicKey) {
                return { code: BuckyErrorCodes.Success, data: { key: publicKey } };
            }
            return { code: BuckyErrorCodes.NoKey, message: t("settings.embedded_webview_no_key") };
        },
        getCurrentUser: async () => {
            if (!activeDid) {
                return { code: BuckyErrorCodes.NoActiveDid, message: t("settings.embedded_webview_no_did") };
            }
            const wallet = activeDid.bucky_wallets?.[0];
            if (!wallet) {
                return { code: BuckyErrorCodes.NoKey, message: t("settings.embedded_webview_no_key") };
            }
            const did = wallet.did;
            const username = activeDid.nickname ?? "";
            const public_key = publicKey;
            let snUsername: string | null = null;
            const cached = await getCachedSnStatus(activeDid.id);
            if (cached && typeof cached.username === "string") {
                snUsername = cached.username;
            } else {
                try {
                    const jwk = JSON.stringify(wallet.public_key);
                    const record = await fetchSnStatus(activeDid.id, jwk);
                    snUsername = record.username ?? null;
                } catch (err) {
                    console.warn("[BuckyIframe] failed to fetch SN status", err);
                }
            }
            return {
                code: BuckyErrorCodes.Success,
                data: {
                    did,
                    username,
                    public_key,
                    sn_username: snUsername,
                },
            };
        },
        signJsonWithActiveDid: (payload: { payloads?: unknown[] }) => {
            const payloads = Array.isArray(payload?.payloads)
                ? payload.payloads.filter(
                    (item): item is JsonSignPayload =>
                        typeof item === "object" && item !== null && !Array.isArray(item)
                )
                : [];
            if (!payloads.length) {
                return { code: BuckyErrorCodes.NoMessage, message: t("settings.embedded_webview_sign_empty") };
            }
            if (!activeDid) {
                return { code: BuckyErrorCodes.NoActiveDid, message: t("settings.embedded_webview_no_did") };
            }
            if (signInProgress || passwordDialog.open) {
                return { code: BuckyErrorCodes.Busy, message: t("settings.embedded_webview_busy") };
            }
            return new Promise((resolve) => {
                setSignInProgress(true);
                setPasswordDialog({
                    open: true,
                    value: "",
                    error: "",
                    loading: false,
                    payloadsToSign: payloads,
                });
                resolverRef.current = (result) => {
                    resolverRef.current = null;
                    resolve(result);
                };
            });
        },
        startRecording,
        getRecordingStatus,
        stopRecording,
        cancelRecording,
    }), [publicKey, t, activeDid, signInProgress, passwordDialog.open, startRecording, getRecordingStatus, stopRecording, cancelRecording]);

    const closeDialog = React.useCallback(() => {
        setPasswordDialog((prev) => ({ ...prev, open: false, value: "", error: "", payloadsToSign: [] }));
        setSignInProgress(false);
    }, []);

    const handleConfirmPassword = React.useCallback(async () => {
        setPasswordDialog((prev) => ({ ...prev, loading: true, error: "" }));
        try {
            const signatures = await signJsonWithActiveDid(
                passwordDialog.value,
                passwordDialog.payloadsToSign
            );
            resolverRef.current?.({ code: BuckyErrorCodes.Success, data: { signatures } });
            resolverRef.current = null;
            closeDialog();
        } catch (err) {
            const { code, message } = parseCommandError(err);
            if (code === CommandErrorCodes.InvalidPassword || message?.includes("invalid_password")) {
                setPasswordDialog((prev) => ({ ...prev, loading: false, error: t("settings.embedded_webview_invalid_password") }));
                resolverRef.current?.({ code: BuckyErrorCodes.InvalidPassword, message });
            } else {
                setPasswordDialog((prev) => ({ ...prev, loading: false, error: t("settings.embedded_webview_unknown_error") }));
                resolverRef.current?.({ code: BuckyErrorCodes.NativeError, message });
            }
        }
    }, [passwordDialog.value, passwordDialog.payloadsToSign, closeDialog, t]);

    React.useEffect(() => {
        const container = document.createElement("div");
        portalContainerRef.current = container;
        document.body.appendChild(container);
        portalRootRef.current = createRoot(container);
        return () => {
            portalRootRef.current?.unmount();
            portalRootRef.current = null;
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
            portalContainerRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        const root = portalRootRef.current;
        if (!root) return;
        root.render(React.createElement(InputDialog, {
            open: passwordDialog.open,
            title: t("settings.embedded_webview_password_title"),
            message: t("settings.embedded_webview_password_message"),
            value: passwordDialog.value,
            onChange: (value: string) => setPasswordDialog((prev) => ({ ...prev, value })),
            inputType: "password",
            placeholder: t("settings.embedded_webview_password_placeholder"),
            confirmText: passwordDialog.loading ? t("settings.embedded_webview_signing") : t("settings.embedded_webview_confirm"),
            cancelText: t("common.actions.cancel"),
            onConfirm: handleConfirmPassword,
            onCancel: () => {
                if (passwordDialog.loading) return;
                resolverRef.current?.({ code: BuckyErrorCodes.Cancelled, message: t("common.actions.cancel") });
                resolverRef.current = null;
                closeDialog();
            },
            loading: passwordDialog.loading,
            error: passwordDialog.error,
        }));
    }, [passwordDialog, handleConfirmPassword, closeDialog, t]);

    return { iframeRef, defaultActionHandlers: actionHandlers };
}
