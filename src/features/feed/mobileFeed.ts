// What the phone's feed tab shows: Home Station or everything that happened. The choice is part of
// the account's appearance in each Zone (`mobileFeed`), the same on every phone.
import React from "react";
import { DEFAULT_MOBILE_FEED, APPEARANCE_STATE_KEY, mobileFeeds, type MobileFeed } from "@buckyos-desktop/appearance/model.ts";
import { readDesktopState, writeDesktopState } from "@buckyos-desktop/controlPanel/desktopState.ts";
import { zoneChannel } from "../zone/channel";
import { createRetry } from "../zone/retry";
import type { ZoneView } from "../zone/types";

export function readFeed(raw: unknown): MobileFeed | null {
    const value = raw && typeof raw === "object" ? (raw as { mobileFeed?: unknown }).mobileFeed : raw;
    return mobileFeeds.includes(value as MobileFeed) ? (value as MobileFeed) : null;
}

interface Feed {
    /** What is on screen; may differ from the choice until the tab is chosen again. */
    shown: MobileFeed;
    chosen: MobileFeed;
    /** Chosen here and not stored yet. */
    unsaved: boolean;
}

const storageKey = (key: string) => `buckyos.feed.${key}`;
const feeds = new Map<string, Feed>();
const listeners = new Set<() => void>();

function feedOf(key: string): Feed {
    let feed = feeds.get(key);
    if (!feed) {
        let cached: MobileFeed | null = null;
        try {
            cached = readFeed(localStorage.getItem(storageKey(key)));
        } catch {
            // The Zone says it soon.
        }
        const chosen = cached ?? DEFAULT_MOBILE_FEED;
        feed = { shown: chosen, chosen, unsaved: false };
        feeds.set(key, feed);
    }
    return feed;
}

function put(key: string, feed: Feed) {
    feeds.set(key, feed);
    try {
        localStorage.setItem(storageKey(key), feed.chosen);
    } catch {
        // Until the window closes.
    }
    listeners.forEach((listener) => listener());
}

const keyOf = (zone: Pick<ZoneView, "did" | "session">) => `${zone.did}|${zone.session.identity?.user_id ?? ""}`;

/** Something else asked for one of the two (an icon, a notification): shown now, not chosen. */
export function showFeed(zone: Pick<ZoneView, "did" | "session">, mode: MobileFeed) {
    const key = keyOf(zone);
    const feed = feedOf(key);
    if (feed.shown !== mode) put(key, { ...feed, shown: mode });
}

/** Back to what the user chose, when the tab is entered from the navigation. */
export function resetFeed(zone: Pick<ZoneView, "did" | "session">) {
    showFeed(zone, feedOf(keyOf(zone)).chosen);
}

export function useMobileFeed(zone: ZoneView | null): { mode: MobileFeed; choose: (mode: MobileFeed) => void } {
    const key = zone ? keyOf(zone) : "";
    const ready = zone?.session.state === "signed_in";
    const mode = React.useSyncExternalStore(
        React.useCallback((listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        }, []),
        () => (key ? feedOf(key).shown : DEFAULT_MOBILE_FEED)
    );
    const target = React.useRef(zone);
    target.current = zone;

    React.useEffect(() => {
        const current = target.current;
        if (!ready || !current) return;
        let stopped = false;
        const load = () => {
            readDesktopState<unknown>(zoneChannel(current), APPEARANCE_STATE_KEY)
                .then(({ value }) => {
                    retry.succeeded();
                    const stored = readFeed(value) ?? DEFAULT_MOBILE_FEED;
                    const feed = feedOf(key);
                    if (stopped || feed.unsaved || stored === feed.chosen) return;
                    put(key, { shown: feed.shown === feed.chosen ? stored : feed.shown, chosen: stored, unsaved: false });
                })
                .catch((error) => {
                    console.info("[Feed] no appearance state", current.host, error);
                    if (!stopped) retry.failed();
                });
        };
        const retry = createRetry(load);
        load();
        return () => {
            stopped = true;
            retry.stop();
        };
    }, [key, ready]);

    const choose = React.useCallback(
        (next: MobileFeed) => {
            const current = target.current;
            if (!current) return;
            put(key, { shown: next, chosen: next, unsaved: true });
            writeDesktopState(zoneChannel(current), APPEARANCE_STATE_KEY, next, "mobileFeed")
                .then(() => {
                    const feed = feedOf(key);
                    if (feed.chosen === next) feeds.set(key, { ...feed, unsaved: false });
                })
                .catch((error) => console.warn("[Feed] storing the choice failed", current.host, error));
        },
        [key]
    );
    return { mode, choose };
}
