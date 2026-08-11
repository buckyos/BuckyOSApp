export type ServiceStatus =
    | "running"
    | "stopped"
    | "error"
    | "not_activated"
    | "starting"
    | "stopping"
    | "refreshing";

/**
 * How node_daemon is being run on this device. Mirrors
 * `node_control::NodeHostControlModel` collapsed to the user-facing
 * distinction the doc cares about: dev-spawned vs installed.
 */
export type DeploymentMode = "dev" | "installed" | "unknown";

export interface TrayLabels {
    tooltip: string;
    title_running: string;
    title_stopped: string;
    title_error: string;
    title_not_activated: string;
    title_starting: string;
    title_stopping: string;
    title_refreshing: string;
    status_running: string;
    status_stopped: string;
    status_error: string;
    status_not_activated: string;
    status_starting: string;
    status_stopping: string;
    status_refreshing: string;
    deployment_dev: string;
    deployment_installed: string;
    deployment_unknown: string;
    submenu_actions: string;
    action_start: string;
    action_stop: string;
    action_restart: string;
    action_refresh: string;
    action_open_app: string;
    action_quit: string;
}

export interface TrayStateSnapshot {
    enabled: boolean;
    status: ServiceStatus;
    deployment: DeploymentMode;
}

export type TrayActionId = "start" | "stop" | "restart" | "refresh";
