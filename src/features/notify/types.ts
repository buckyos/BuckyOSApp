export type AlertLevel = "silent" | "sound" | "urgent";

export type AlertTarget =
    | { kind: "notify"; notify_id: string; link: string | null }
    | { kind: "message"; session_id: string; entity_id: string | null }
    | { kind: "task"; task_id: string }
    | { kind: "activity" };

/** A system notification the client showed, as the Rust side keeps it. */
export interface Alert {
    tag: string;
    account: string;
    zone: string;
    zoneLabel: string;
    title: string;
    body: string;
    level: AlertLevel;
    target: AlertTarget;
    atMs: number;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "need_login";

export interface ZoneNotifyStatus {
    zone: string;
    state: ConnectionState;
    summary: { open: number; todo: number; agent: number; app: number; unread: number };
    urgent: boolean;
}
