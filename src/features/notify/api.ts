import { invoke } from "@tauri-apps/api/core";
import type { Alert, ZoneNotifyStatus } from "./types";

export const STATUS_EVENT = "notify://status";
/** Something changed in a Zone: `{ zone, source: "all" | "message" | "task" }`. */
export const CHANGED_EVENT = "notify://changed";
export const ACTIVATE_EVENT = "notify://activate";

export interface NotifyLabels {
    newMessage: string;
    /** With `{count}`. */
    many: string;
    taskDone: string;
    taskFailed: string;
}

export const notifyStatus = () => invoke<ZoneNotifyStatus[]>("notify_status");
export const recentAlerts = () => invoke<Alert[]>("notify_recent");
export const setNotifyLabels = (labels: NotifyLabels) => invoke<void>("notify_set_labels", { labels });
export const notifySettings = () => invoke<{ enabled: boolean }>("notify_settings");
/** Turning on asks the system for permission; false when it was refused. */
export const setNotifyEnabled = (enabled: boolean) => invoke<boolean>("notify_set_enabled", { enabled });
/** Null where the system does not say, or was not asked yet. */
export const notifyPermission = () => invoke<boolean | null>("notify_permission");
/** A page read or dismissed something: the counts change now rather than at the next poll. */
export const refreshNotify = () => invoke<void>("notify_refresh");
export const activateAlert = (alert: Alert) => invoke<void>("notify_activate", { alert });
export const showAlert = (alert: Alert) => invoke<void>("notify_show", { alert });
