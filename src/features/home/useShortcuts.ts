import React from "react";
import { zoneChannel } from "../zone/channel";
import { createRetry } from "../zone/retry";
import type { ZoneView } from "../zone/types";
import { DEFAULT_SHORTCUTS, loadShortcuts, saveShortcuts } from "./shortcuts";

interface Known {
    list: string[];
    /** Changed here and not stored yet. */
    unsaved: boolean;
    /** The Zone has said what is stored; until then nothing may replace it. */
    read: boolean;
}

const known = new Map<string, Known>();

export interface ShortcutsState {
    shortcuts: string[] | null;
    /** The last change did not reach the Zone. */
    unsaved: boolean;
    /** Not before the stored list is known: a change would replace it. */
    editable: boolean;
    change: (next: string[]) => void;
}

/** The Home shortcuts of the account in one Zone. A change shows at once and is stored behind it. */
export function useShortcuts(zone: ZoneView): ShortcutsState {
    const userId = zone.session.identity?.user_id ?? "";
    const key = `${zone.did}|${userId}`;
    const ready = zone.session.state === "signed_in";
    const [, changed] = React.useReducer((count: number) => count + 1, 0);
    const target = React.useRef({ did: zone.did, host: zone.host });
    target.current = { did: zone.did, host: zone.host };
    const alive = React.useRef(true);

    React.useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const put = React.useCallback((forKey: string, value: Known) => {
        known.set(forKey, value);
        if (alive.current) changed();
    }, []);

    React.useEffect(() => {
        if (!ready) return;
        let stopped = false;
        const load = () => {
            loadShortcuts(zoneChannel(target.current))
                .then((stored) => {
                    retry.succeeded();
                    if (!stopped && !known.get(key)?.unsaved) put(key, { list: stored ?? DEFAULT_SHORTCUTS, unsaved: false, read: true });
                })
                .catch((error) => {
                    console.warn("[Home] reading the shortcuts failed", target.current.host, error);
                    if (stopped) return;
                    if (!known.has(key)) put(key, { list: DEFAULT_SHORTCUTS, unsaved: false, read: false });
                    retry.failed();
                });
        };
        const retry = createRetry(load);
        load();
        return () => {
            stopped = true;
            retry.stop();
        };
    }, [key, ready, put]);

    const queue = React.useRef<Promise<void>>(Promise.resolve());
    const change = React.useCallback(
        (next: string[]) => {
            if (!known.get(key)?.read) return;
            const channel = zoneChannel(target.current);
            put(key, { list: next, unsaved: false, read: true });
            queue.current = queue.current.then(async () => {
                // Only the last one counts.
                if (known.get(key)?.list !== next) return;
                try {
                    await saveShortcuts(channel, next);
                } catch (error) {
                    console.warn("[Home] storing the shortcuts failed", error);
                    if (known.get(key)?.list === next) put(key, { list: next, unsaved: true, read: true });
                }
            });
        },
        [key, put]
    );

    const value = known.get(key);
    return { shortcuts: value?.list ?? null, unsaved: value?.unsaved ?? false, editable: value?.read ?? false, change };
}
