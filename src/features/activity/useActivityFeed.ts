import React from "react";
import { listen } from "@tauri-apps/api/event";
import { ActivityFeed, type ActivitySnapshot } from "@buckyos-desktop/activity/feed.ts";
import { readDismissedTasks, type DismissedTasks } from "@buckyos-desktop/activity/model.ts";
import type { ProjectionLabels } from "@buckyos-desktop/messagehub/projection.ts";
import { useI18n } from "../../i18n";
import { CHANGED_EVENT } from "../notify/api";
import { zoneChannel } from "../zone/channel";
import { createRetry, pageEnvironment } from "../zone/retry";
import type { ZoneView } from "../zone/types";
import { changedSources } from "./view";

type Translate = (key: string, params?: Record<string, string | number | boolean>) => string;

function projectionLabels(t: Translate): ProjectionLabels {
    return {
        direct: t("activity.message.direct"),
        groupMain: t("activity.message.group_main"),
        untitled: t("activity.message.untitled"),
        unassigned: t("activity.message.unassigned"),
        unassignedDescription: "",
        you: t("activity.message.you"),
        previewImage: t("activity.message.image"),
        previewAttachment: t("activity.message.attachment"),
        previewVoice: t("activity.message.voice"),
        previewUnavailable: t("activity.message.unavailable"),
        systemNotify: t("activity.message.system"),
        notifyCategories: {
            todo: t("activity.label.notify_todo"),
            agent: t("activity.label.notify_agent"),
            app: t("activity.label.notify_app"),
        },
    };
}

/** Finished tasks taken off the list, on this device, per Zone and user. */
function dismissedStore(key: string) {
    const storageKey = `buckyos.activity.dismissed.${key}`;
    let kept: DismissedTasks | null = null;
    return {
        read(): DismissedTasks {
            if (kept) return kept;
            try {
                kept = readDismissedTasks(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
            } catch {
                kept = {};
            }
            return kept;
        },
        write(dismissed: DismissedTasks) {
            kept = dismissed;
            try {
                localStorage.setItem(storageKey, JSON.stringify(dismissed));
            } catch {
                // Until the window closes.
            }
        },
    };
}

let translate: Translate = (key) => key;
const feeds = new Map<string, ActivityFeed>();

function feedOf(zone: ZoneView, userId: string): ActivityFeed {
    const key = `${zone.did}|${zone.host}|${userId}`;
    let feed = feeds.get(key);
    if (!feed) {
        feed = new ActivityFeed({
            channel: zoneChannel(zone),
            userId,
            labels: () => projectionLabels(translate),
            dismissed: dismissedStore(`${zone.did}|${userId}`),
            active: () => document.visibilityState === "visible",
        });
        feeds.set(key, feed);
    }
    return feed;
}

const noSubscription = () => () => undefined;

/** The Activity of one Zone, kept current while the page is up. Null until the Zone is signed in to. */
export function useActivityFeed(zone: ZoneView): { feed: ActivityFeed; snapshot: ActivitySnapshot } | null {
    const { t, locale } = useI18n();
    translate = t;
    const userId = zone.session.identity?.user_id;
    const ready = zone.session.state === "signed_in";
    const feed = userId ? feedOf(zone, userId) : null;
    const snapshot = React.useSyncExternalStore(feed ? feed.subscribe : noSubscription, () => feed?.getSnapshot() ?? null);

    React.useEffect(() => {
        if (!feed || !ready) return;
        const stop = feed.start();
        const unlisten = pageEnvironment.onWake(() => {
            if (pageEnvironment.visible()) void feed.refresh();
        });
        const changed = listen<{ zone: string; source: string }>(CHANGED_EVENT, ({ payload }) => {
            if (payload.zone !== zone.did) return;
            const sources = changedSources(payload.source);
            if (sources) sources.forEach((source) => void feed.refresh(source));
            else void feed.refresh();
        });
        return () => {
            stop();
            unlisten();
            void changed.then((unlisten) => unlisten());
        };
    }, [feed, ready, zone.did]);

    // What could not be read yet does not wait for the feed's own slow rounds.
    const failed = Boolean(snapshot && Object.values(snapshot.status).includes("error"));
    React.useEffect(() => {
        if (!feed || !ready || !failed) return;
        const retry = createRetry(() => {
            void feed.refresh().then(() => {
                if (Object.values(feed.getSnapshot().status).includes("error")) retry.failed();
            });
        });
        retry.failed();
        return () => retry.stop();
    }, [feed, ready, failed]);

    // Conversation rows hold words of the language they were read in.
    const readIn = React.useRef(locale);
    React.useEffect(() => {
        if (readIn.current === locale) return;
        readIn.current = locale;
        if (feed && ready) void feed.refresh("message");
    }, [feed, ready, locale]);

    return feed && snapshot ? { feed, snapshot } : null;
}
