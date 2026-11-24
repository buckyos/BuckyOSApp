export interface ViewInfo {
    id: string;
    account: string;
    zone: string;
    app: string;
    appInstance: string;
    windowPath: string;
    path: string | null;
    title: string;
    lastActive: number;
    focused: boolean;
    minimized: boolean;
}

export interface OpenViewRequest {
    id: string;
    zone: string;
    app: string;
    appInstance: string;
    windowPath: string;
    url: string;
    title: string;
    window: Record<string, unknown>;
    zoneLabel?: string;
    accent?: string;
    presentation?: "window" | "tab";
}

/** `canceled`: the user decided against it, there is nothing to tell. */
export type OpenFailure = "zone_not_found" | "app_not_found" | "need_login" | "unreachable" | "unsupported" | "canceled" | "failed";

/** An open request that could not be carried out, for the page to tell the user. */
export class OpenError extends Error {
    constructor(
        readonly reason: OpenFailure,
        readonly zone?: string,
        readonly app?: string
    ) {
        super(reason);
    }
}
