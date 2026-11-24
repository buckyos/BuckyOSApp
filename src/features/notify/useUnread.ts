import React from "react";
import { listen } from "@tauri-apps/api/event";
import { watchSummary } from "@buckyos-desktop/activity/summary.ts";
import { zoneChannel } from "../zone/channel";
import type { ZoneView } from "../zone/types";
import { CHANGED_EVENT, STATUS_EVENT, notifyStatus } from "./api";
import type { ZoneNotifyStatus } from "./types";

const POLL_MS = 60_000;

let statuses: ZoneNotifyStatus[] = [];
let started = false;
const listeners = new Set<() => void>();

function put(next: ZoneNotifyStatus[]) {
    statuses = next;
    listeners.forEach((listener) => listener());
}

function start() {
    if (started) return;
    started = true;
    void listen<ZoneNotifyStatus[]>(STATUS_EVENT, ({ payload }) => put(payload))
        .then(() => notifyStatus())
        .then(put)
        .catch((error) => console.warn("[Notify] no status", error));
}

/** The notification connections, as the Rust side last reported them. */
export function useNotifyStatuses(): ZoneNotifyStatus[] {
    return React.useSyncExternalStore(
        React.useCallback((listener: () => void) => {
            start();
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }, []),
        () => statuses
    );
}

export function unreadOf(summary: ZoneCounts): number {
    return summary.open + summary.unread;
}

export interface ZoneCounts {
    /** Notifications that are not handled. */
    open: number;
    /** Unread messages. */
    unread: number;
}

const NONE: ZoneCounts = { open: 0, unread: 0 };

/**
 * What waits in a Zone. From its notification connection; with notifications off for it, asked of
 * the Zone itself now and then.
 */
export function useCounts(zone: ZoneView | null): ZoneCounts {
    const status = useNotifyStatuses().find((candidate) => candidate.zone === zone?.did);
    const [polled, setPolled] = React.useState<{ zone: string; counts: ZoneCounts } | null>(null);
    const did = zone?.did;
    const host = zone?.host;
    const poll = Boolean(zone && !status && zone.session.state === "signed_in");

    React.useEffect(() => {
        if (!poll || !did || !host) return;
        const watch = watchSummary(zoneChannel({ did, host }), () => {
            const summary = watch.current();
            if (summary) setPolled({ zone: did, counts: { open: summary.notify.open, unread: summary.messages.unread } });
        });
        watch.kick();
        const timer = window.setInterval(() => {
            if (document.visibilityState === "visible") watch.kick();
        }, POLL_MS);
        const changed = listen<{ zone: string }>(CHANGED_EVENT, ({ payload }) => {
            if (payload.zone === did) watch.kick();
        });
        return () => {
            watch.stop();
            window.clearInterval(timer);
            void changed.then((stop) => stop());
        };
    }, [poll, did, host]);

    if (status) return status.summary;
    return polled && polled.zone === did ? polled.counts : NONE;
}

export function useUnread(zone: ZoneView | null): number {
    return unreadOf(useCounts(zone));
}
