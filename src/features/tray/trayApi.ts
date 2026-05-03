import { invoke } from "@tauri-apps/api/core";
import type {
    DeploymentForm,
    ServiceStatus,
    TrayLabels,
    TrayStateSnapshot,
} from "./types";

export const TRAY_ACTION_EVENT = "buckyos://tray-action";
export const TRAY_STATE_EVENT = "buckyos://tray-state";

export function setTrayEnabled(enabled: boolean): Promise<TrayStateSnapshot> {
    return invoke<TrayStateSnapshot>("tray_set_enabled", { enabled });
}

export function setTrayLabels(labels: TrayLabels): Promise<void> {
    return invoke<void>("tray_set_labels", { labels });
}

export function setTrayStatus(
    status: ServiceStatus,
    deployment?: DeploymentForm,
): Promise<TrayStateSnapshot> {
    return invoke<TrayStateSnapshot>("tray_set_status", { status, deployment: deployment ?? null });
}

export function getTrayState(): Promise<TrayStateSnapshot> {
    return invoke<TrayStateSnapshot>("tray_get_state");
}

export function startLocalService(): Promise<TrayStateSnapshot> {
    return invoke<TrayStateSnapshot>("tray_start_service");
}

export function stopLocalService(): Promise<TrayStateSnapshot> {
    return invoke<TrayStateSnapshot>("tray_stop_service");
}

export function restartLocalService(): Promise<TrayStateSnapshot> {
    return invoke<TrayStateSnapshot>("tray_restart_service");
}

export function refreshLocalServiceStatus(): Promise<TrayStateSnapshot> {
    return invoke<TrayStateSnapshot>("tray_refresh_status");
}
