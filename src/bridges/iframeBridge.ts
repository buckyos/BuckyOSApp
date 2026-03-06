import React from "react";
import { listen } from "@tauri-apps/api/event";
import { useI18n } from "../i18n";
import { useDidContext } from "../features/did/DidContext";
import InputDialog from "../components/ui/InputDialog";
import { JsonSignPayload, signJsonWithActiveDid } from "../features/did/api";
import {
    cancelRecording,
    checkRecordingReadiness,
    exportRecordingFile,
    getPlaybackStatus,
    getRecordingFileInfo,
    getRecordingPermissions,
    getRecordingStatus,
    listRecordings,
    getRecordingUrl,
    pauseRecording,
    playRecording,
    readRecordingFile,
    requestRecordingPermissions,
    resumeRecording,
    markAudioInterruptionEnd,
    startRecording,
    markAudioInterruptionBegin,
    stopPlayback,
    stopRecording,
} from "../features/audio/api";
import { fetchSnStatus, getCachedSnStatus } from "../features/sn/snStatusManager";
import { createRoot, Root } from "react-dom/client";
import { BuckyErrorCodes } from "./buckyErrorCodes";
import { parseCommandError } from "../utils/commandError";
import { CommandErrorCodes } from "../constants/commandErrorCodes";

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

    const postEventToIframe = React.useCallback((eventName: string, payload: unknown) => {
        const iframeWindow = iframeRef.current?.contentWindow;
        if (!iframeWindow) return;
        iframeWindow.postMessage(
            {
                kind: "bucky-api-event",
                event: eventName,
                payload,
            },
            "*"
        );
    }, []);

    React.useEffect(() => {
        let mounted = true;
        const unlisteners: Array<() => void> = [];
        const eventNames = [
            "recording_state_changed",
            "recording_error",
            "playback_state_changed",
            "audio_interruption_begin",
            "audio_interruption_end",
        ];

        const setupListeners = async () => {
            for (const eventName of eventNames) {
                const unlisten = await listen<unknown>(eventName, (evt) => {
                    if (!mounted) return;
                    postEventToIframe(eventName, evt.payload);
                });
                if (!mounted) {
                    unlisten();
                } else {
                    unlisteners.push(unlisten);
                }
            }
        };

        void setupListeners().catch((error) => {
            console.warn("[BuckyIframe] failed to subscribe to audio events", error);
        });

        return () => {
            mounted = false;
            while (unlisteners.length) {
                unlisteners.pop()?.();
            }
        };
    }, [iframeRef, postEventToIframe]);

    const publicKey = React.useMemo(() => {
        const wallet = activeDid?.bucky_wallets?.[0];
        return wallet?.public_key ? wallet.public_key : null;
    }, [activeDid?.bucky_wallets, activeDid?.id]);

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
        startRecording: async (payload: {
            sample_rate?: number;
            channels?: 1 | 2;
            bit_rate?: number;
            format?: "m4a" | "wav";
            tag?: string;
        }) => {
            const data = await startRecording({
                sample_rate: payload?.sample_rate,
                channels: payload?.channels,
                bit_rate: payload?.bit_rate,
                format: payload?.format,
                tag: payload?.tag,
            });
            return { code: BuckyErrorCodes.Success, data };
        },
        pauseRecording: async (payload: { record_id?: string }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await pauseRecording(payload.record_id);
            return { code: BuckyErrorCodes.Success, data };
        },
        resumeRecording: async (payload: { record_id?: string }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await resumeRecording(payload.record_id);
            return { code: BuckyErrorCodes.Success, data };
        },
        stopRecording: async (payload: { record_id?: string }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await stopRecording(payload.record_id);
            return { code: BuckyErrorCodes.Success, data };
        },
        cancelRecording: async (payload: { record_id?: string }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await cancelRecording(payload.record_id);
            return { code: BuckyErrorCodes.Success, data };
        },
        getRecordingStatus: async () => {
            const data = await getRecordingStatus();
            return { code: BuckyErrorCodes.Success, data };
        },
        listRecordings: async () => {
            const data = await listRecordings();
            return { code: BuckyErrorCodes.Success, data };
        },
        getRecordingFileInfo: async (payload: { record_id?: string }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await getRecordingFileInfo(payload.record_id);
            return { code: BuckyErrorCodes.Success, data };
        },
        readRecordingFile: async (payload: { record_id?: string; offset?: number; length?: number }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await readRecordingFile(
                payload.record_id,
                payload.offset ?? 0,
                payload.length ?? 4096
            );
            return { code: BuckyErrorCodes.Success, data };
        },
        getRecordingUrl: async (payload: { record_id?: string }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await getRecordingUrl(payload.record_id);
            return { code: BuckyErrorCodes.Success, data };
        },
        exportRecordingFile: async (payload: { record_id?: string; target_path?: string }) => {
            if (!payload?.record_id || !payload?.target_path) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id and target_path required" };
            }
            const data = await exportRecordingFile(payload.record_id, payload.target_path);
            return { code: BuckyErrorCodes.Success, data };
        },
        playRecording: async (payload: { record_id?: string }) => {
            if (!payload?.record_id) {
                return { code: BuckyErrorCodes.NativeError, message: "record_id required" };
            }
            const data = await playRecording(payload.record_id);
            return { code: BuckyErrorCodes.Success, data };
        },
        stopPlayback: async () => {
            const data = await stopPlayback();
            return { code: BuckyErrorCodes.Success, data };
        },
        getPlaybackStatus: async () => {
            const data = await getPlaybackStatus();
            return { code: BuckyErrorCodes.Success, data };
        },
        getRecordingPermissions: async () => {
            const data = await getRecordingPermissions();
            return { code: BuckyErrorCodes.Success, data };
        },
        requestRecordingPermissions: async () => {
            const data = await requestRecordingPermissions();
            return { code: BuckyErrorCodes.Success, data };
        },
        checkRecordingReadiness: async () => {
            const data = await checkRecordingReadiness();
            return { code: BuckyErrorCodes.Success, data };
        },
        markAudioInterruptionBegin: async (payload: { reason?: string }) => {
            const data = await markAudioInterruptionBegin(payload?.reason ?? "test_interrupt");
            return { code: BuckyErrorCodes.Success, data };
        },
        markAudioInterruptionEnd: async () => {
            const data = await markAudioInterruptionEnd();
            return { code: BuckyErrorCodes.Success, data };
        },
    }), [publicKey, t, activeDid, signInProgress, passwordDialog.open]);

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
