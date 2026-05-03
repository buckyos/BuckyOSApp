export type ServiceStatus =
    | "running"
    | "stopped"
    | "error"
    | "starting"
    | "stopping"
    | "refreshing";

export type DeploymentForm = "single_desktop_service" | "cluster_client";

export interface TrayLabels {
    tooltip: string;
    title_running: string;
    title_stopped: string;
    title_error: string;
    title_starting: string;
    title_stopping: string;
    title_refreshing: string;
    status_running_single: string;
    status_running_cluster: string;
    status_stopped_single: string;
    status_stopped_cluster: string;
    status_error_single: string;
    status_error_cluster: string;
    status_starting: string;
    status_stopping: string;
    status_refreshing: string;
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
    deployment: DeploymentForm;
}

export type TrayActionId = "start" | "stop" | "restart" | "refresh";
