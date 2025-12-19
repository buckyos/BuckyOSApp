import React from "react";
import { useI18n } from "../i18n";
import { useDidContext } from "../features/did/DidContext";
import InputDialog from "../components/ui/InputDialog";
import { signWithActiveDid } from "../features/did/api";
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
    messagesToSign: string[];
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
        messagesToSign: [],
    });
    const [signInProgress, setSignInProgress] = React.useState(false);
    const resolverRef = React.useRef<((result: any) => void) | null>(null);
    const portalContainerRef = React.useRef<HTMLDivElement | null>(null);
    const portalRootRef = React.useRef<Root | null>(null);

    const publicKey = React.useMemo(() => {
        const wallet = activeDid?.bucky_wallets?.[0];
        return wallet?.public_key ? JSON.stringify(wallet.public_key) : "";
    }, [activeDid?.bucky_wallets, activeDid?.id]);

    const actionHandlers = React.useMemo(() => ({
        getPublicKey: () => {
            if (publicKey) {
                return { code: BuckyErrorCodes.Success, data: { key: publicKey } };
            }
            return { code: BuckyErrorCodes.NoKey, message: t("settings.embedded_webview_no_key") };
        },
        signWithActiveDid: (payload: { messages?: string[] }) => {
            const messages = Array.isArray(payload?.messages)
                ? payload.messages.filter(
                    (item): item is string => typeof item === "string" && item.trim().length > 0
                )
                : [];
            if (!messages.length) {
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
                    messagesToSign: messages,
                });
                resolverRef.current = (result) => {
                    resolverRef.current = null;
                    resolve(result);
                };
            });
        },
    }), [publicKey, t, activeDid, signInProgress, passwordDialog.open]);

    const closeDialog = React.useCallback(() => {
        setPasswordDialog((prev) => ({ ...prev, open: false, value: "", error: "", messagesToSign: [] }));
        setSignInProgress(false);
    }, []);

    const handleConfirmPassword = React.useCallback(async () => {
        setPasswordDialog((prev) => ({ ...prev, loading: true, error: "" }));
        try {
            const signatures = await signWithActiveDid(
                passwordDialog.value,
                passwordDialog.messagesToSign
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
    }, [passwordDialog.value, passwordDialog.messagesToSign, closeDialog, t]);

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
