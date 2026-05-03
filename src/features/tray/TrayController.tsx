import React from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useI18n } from "../../i18n";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import {
    TRAY_ACTION_EVENT,
    TRAY_STATE_EVENT,
    getTrayState,
    refreshLocalServiceStatus,
    restartLocalService,
    setTrayEnabled,
    setTrayLabels,
    startLocalService,
    stopLocalService,
} from "./trayApi";
import {
    isTrayCapable,
    useTrayEnabledPreference,
} from "./trayConfig";
import type {
    DeploymentForm,
    TrayActionId,
    TrayLabels,
    TrayStateSnapshot,
} from "./types";

const ACTION_RUNNERS: Record<TrayActionId, () => Promise<TrayStateSnapshot>> = {
    start: startLocalService,
    stop: stopLocalService,
    restart: restartLocalService,
    refresh: refreshLocalServiceStatus,
};

function buildLabels(t: (key: string, params?: Record<string, string | number | boolean>) => string): TrayLabels {
    return {
        tooltip: t("tray.tooltip"),
        title_running: t("tray.title.running"),
        title_stopped: t("tray.title.stopped"),
        title_error: t("tray.title.error"),
        title_starting: t("tray.title.starting"),
        title_stopping: t("tray.title.stopping"),
        title_refreshing: t("tray.title.refreshing"),
        status_running_single: t("tray.status.running_single"),
        status_running_cluster: t("tray.status.running_cluster"),
        status_stopped_single: t("tray.status.stopped_single"),
        status_stopped_cluster: t("tray.status.stopped_cluster"),
        status_error_single: t("tray.status.error_single"),
        status_error_cluster: t("tray.status.error_cluster"),
        status_starting: t("tray.status.starting"),
        status_stopping: t("tray.status.stopping"),
        status_refreshing: t("tray.status.refreshing"),
        submenu_actions: t("tray.menu.actions"),
        action_start: t("tray.menu.start"),
        action_stop: t("tray.menu.stop"),
        action_restart: t("tray.menu.restart"),
        action_refresh: t("tray.menu.refresh"),
        action_open_app: t("tray.menu.open_app"),
        action_quit: t("tray.menu.quit"),
    };
}

interface PendingPrompt {
    action: TrayActionId;
    title: string;
    message: string;
    confirmText: string;
    danger: boolean;
}

const TrayController: React.FC = () => {
    const { t, locale } = useI18n();
    const [enabled] = useTrayEnabledPreference();
    const [snapshot, setSnapshot] = React.useState<TrayStateSnapshot | null>(null);
    const [prompt, setPrompt] = React.useState<PendingPrompt | null>(null);
    const [busy, setBusy] = React.useState(false);
    const snapshotRef = React.useRef<TrayStateSnapshot | null>(null);

    React.useEffect(() => {
        snapshotRef.current = snapshot;
    }, [snapshot]);

    // Mirror Rust-side state into React so the confirm dialog can pick
    // the right "single Desktop Service" vs "cluster client" copy.
    React.useEffect(() => {
        if (!isTrayCapable()) return;
        let unlistenFn: UnlistenFn | undefined;
        let cancelled = false;
        (async () => {
            try {
                const initial = await getTrayState();
                if (!cancelled) setSnapshot(initial);
            } catch (err) {
                console.warn("[tray] get_state failed", err);
            }
            unlistenFn = await listen<TrayStateSnapshot>(TRAY_STATE_EVENT, (event) => {
                setSnapshot(event.payload);
            });
        })();
        return () => {
            cancelled = true;
            if (unlistenFn) unlistenFn();
        };
    }, []);

    // Push translated labels and the enabled flag to Rust.
    React.useEffect(() => {
        if (!isTrayCapable()) return;
        let cancelled = false;
        (async () => {
            try {
                await setTrayLabels(buildLabels(t));
                if (cancelled) return;
                const next = await setTrayEnabled(enabled);
                if (!cancelled) setSnapshot(next);
            } catch (err) {
                console.warn("[tray] sync failed", err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled, locale, t]);

    // Listen for action requests coming from the tray menu.
    React.useEffect(() => {
        if (!isTrayCapable()) return;
        let unlistenFn: UnlistenFn | undefined;
        (async () => {
            unlistenFn = await listen<TrayActionId | string>(TRAY_ACTION_EVENT, (event) => {
                const action = event.payload as TrayActionId;
                if (!ACTION_RUNNERS[action]) return;
                const current = snapshotRef.current;
                const deployment: DeploymentForm = current?.deployment ?? "single_desktop_service";
                setPrompt(buildPrompt(action, deployment, t));
            });
        })();
        return () => {
            if (unlistenFn) unlistenFn();
        };
    }, [t]);

    const handleConfirm = async () => {
        if (!prompt) return;
        setBusy(true);
        try {
            await ACTION_RUNNERS[prompt.action]();
        } catch (err) {
            console.error("[tray] action failed", prompt.action, err);
        } finally {
            setBusy(false);
            setPrompt(null);
        }
    };

    if (!isTrayCapable()) return null;

    return (
        <ConfirmDialog
            open={!!prompt}
            title={prompt?.title ?? ""}
            message={prompt?.message}
            confirmText={busy ? t("tray.confirm.loading") : prompt?.confirmText ?? t("common.actions.next")}
            cancelText={t("common.actions.cancel")}
            confirmVariant={prompt?.danger ? "danger" : "primary"}
            onCancel={() => {
                if (busy) return;
                setPrompt(null);
            }}
            onConfirm={handleConfirm}
        />
    );
};

function buildPrompt(
    action: TrayActionId,
    deployment: DeploymentForm,
    t: (key: string, params?: Record<string, string | number | boolean>) => string,
): PendingPrompt {
    const isSingle = deployment === "single_desktop_service";
    switch (action) {
        case "start":
            return {
                action,
                title: t("tray.confirm.start_title"),
                message: isSingle
                    ? t("tray.confirm.start_message_single")
                    : t("tray.confirm.start_message_cluster"),
                confirmText: t("tray.confirm.start_continue"),
                danger: false,
            };
        case "stop":
            return {
                action,
                title: t("tray.confirm.stop_title"),
                message: isSingle
                    ? t("tray.confirm.stop_message_single")
                    : t("tray.confirm.stop_message_cluster"),
                confirmText: t("tray.confirm.stop_continue"),
                danger: true,
            };
        case "restart":
            return {
                action,
                title: t("tray.confirm.restart_title"),
                message: isSingle
                    ? t("tray.confirm.restart_message_single")
                    : t("tray.confirm.restart_message_cluster"),
                confirmText: t("tray.confirm.restart_continue"),
                danger: true,
            };
        case "refresh":
            return {
                action,
                title: t("tray.confirm.refresh_title"),
                message: t("tray.confirm.refresh_message"),
                confirmText: t("tray.confirm.refresh_continue"),
                danger: false,
            };
    }
}

export default TrayController;
