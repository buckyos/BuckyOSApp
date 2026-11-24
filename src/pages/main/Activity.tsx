import React from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import type { ActivityFeed, ActivitySnapshot } from "@buckyos-desktop/activity/feed.ts";
import type { ActivityEntry } from "@buckyos-desktop/activity/model.ts";
import { PageHeader } from "../../app/PageHeader";
import { Button, IconButton } from "../../components/ui/Button";
import { Empty, Notice, Spinner } from "../../components/ui/States";
import { ActivityRow } from "../../features/activity/ActivityRow";
import { useActivityFeed } from "../../features/activity/useActivityFeed";
import { canMarkAll, dayTitle, groupByDay, type RowAction } from "../../features/activity/view";
import { clientRuntime } from "../../features/content/clientRuntime";
import { refreshNotify } from "../../features/notify/api";
import { useNotifyStatuses } from "../../features/notify/useUnread";
import { SessionNotice } from "../../features/zone/SessionNotice";
import { useZones } from "../../features/zone/ZoneContext";
import { zoneTitle, type ZoneView } from "../../features/zone/types";
import { useI18n } from "../../i18n";

const MINUTE_MS = 60_000;

const Activity: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { current } = useZones();
    if (!current) {
        return (
            <div className="shell-page">
                <PageHeader title={t("tabs.activity")} />
                <div className="shell-page-body">
                    <div className="shell-fill">
                        <Empty icon={<Bell size={26} strokeWidth={1.6} />} title={t("activity.no_zone")} text={t("activity.no_zone_text")}>
                            <Button onClick={() => navigate("/main/home")}>{t("zones.to_home")}</Button>
                        </Empty>
                    </div>
                </div>
            </div>
        );
    }
    return <ActivityPage key={current.did} zone={current} />;
};

/** Everything that happened in one Zone, newest first. `header` takes the place of the page's own. */
export const ActivityPage: React.FC<{ zone: ZoneView; header?: (actions: React.ReactNode) => React.ReactNode }> = ({ zone, header }) => {
    const { t } = useI18n();
    const activity = useActivityFeed(zone);
    const [marking, setMarking] = React.useState(false);
    const [failed, setFailed] = React.useState(false);
    const connection = useNotifyStatuses().find((status) => status.zone === zone.did);

    const after = async (work: Promise<unknown>) => {
        setFailed(false);
        try {
            await work;
        } catch (error) {
            console.warn("[Activity] changing a row failed", error);
            setFailed(true);
        }
        refreshNotify().catch(() => undefined);
    };

    const markAll = async () => {
        if (!activity) return;
        setMarking(true);
        await after(activity.feed.markAllRead());
        setMarking(false);
    };

    const actions = (
        <IconButton
            label={t("activity.mark_all")}
            disabled={marking || !activity || !canMarkAll(activity.snapshot.entries)}
            onClick={() => void markAll()}
            data-testid="mark-all"
        >
            {marking ? <Spinner /> : <CheckCheck size={17} />}
        </IconButton>
    );

    return (
        <div className="shell-page">
            {header ? header(actions) : <PageHeader title={t("tabs.activity")} zone actions={actions} />}
            <div className="shell-page-body ui-scroll" data-testid="activity-page">
                <SessionNotice zone={zone} />
                {zone.session.state === "signed_in" && connection?.state === "reconnecting" ? (
                    <Notice tone="busy" testId="activity-connection">
                        {t("activity.reconnecting", { zone: zoneTitle(zone) })}
                    </Notice>
                ) : null}
                {zone.session.state === "signed_in" && connection?.state === "need_login" ? (
                    <Notice
                        tone="warn"
                        testId="activity-connection"
                        action={
                            <Button size="sm" variant="primary" onClick={() => clientRuntime.askSignIn(zone.did)}>
                                {t("zones.sign_in")}
                            </Button>
                        }
                    >
                        {t("activity.need_login", { zone: zoneTitle(zone) })}
                    </Notice>
                ) : null}
                {failed ? <Notice tone="bad">{t("activity.change_failed")}</Notice> : null}
                {activity ? <ActivityList zone={zone} feed={activity.feed} snapshot={activity.snapshot} after={after} /> : null}
            </div>
        </div>
    );
};

const ActivityList: React.FC<{
    zone: ZoneView;
    feed: ActivityFeed;
    snapshot: ActivitySnapshot;
    after: (work: Promise<unknown>) => Promise<void>;
}> = ({ zone, feed, snapshot, after }) => {
    const { t, locale } = useI18n();
    const [now, setNow] = React.useState(() => Date.now());

    React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), MINUTE_MS);
        return () => window.clearInterval(timer);
    }, []);
    React.useEffect(() => setNow(Date.now()), [snapshot.entries]);

    const act = (entry: ActivityEntry, action: RowAction) => {
        if (entry.kind === "message") return void after(feed.markSessionRead(entry.item.sessionId));
        if (entry.kind === "task") {
            feed.dismissTask(entry.item.taskId);
            return;
        }
        void after(action === "read" ? feed.ackNotify(entry.item.notifyId) : feed.dismissNotify(entry.item.notifyId));
    };

    const open = async (entry: ActivityEntry) => {
        const view = await clientRuntime.openActivity(zone, entry);
        // Opened is read; what waits for an answer keeps waiting.
        if (view && entry.kind === "notify" && entry.item.kind === "notice" && entry.item.status === "open") {
            await after(feed.ackNotify(entry.item.notifyId));
        }
    };

    const statuses = Object.values(snapshot.status);
    if (snapshot.entries.length === 0) {
        if (zone.session.state !== "signed_in") return null;
        if (statuses.includes("loading")) {
            return (
                <div className="shell-fill">
                    <Empty>
                        <Spinner label={t("ui.loading")} />
                    </Empty>
                </div>
            );
        }
        if (statuses.every((status) => status === "error")) {
            return (
                <div className="shell-fill">
                    <Empty text={t("activity.failed")}>
                        <Button size="sm" onClick={() => void feed.refresh()}>
                            {t("ui.retry")}
                        </Button>
                    </Empty>
                </div>
            );
        }
        return (
            <div className="shell-fill">
                <Empty icon={<Bell size={26} strokeWidth={1.6} />} title={t("activity.empty")} text={t("activity.empty_text")} testId="activity-empty" />
            </div>
        );
    }

    return (
        <div className="activity-list">
            {statuses.includes("error") ? <Notice tone="bad">{t("activity.partial")}</Notice> : null}
            {groupByDay(snapshot.entries, now).map((day) => (
                <section key={day.key} className="activity-day">
                    <h2 className="ui-section-title">{dayTitle(day, locale)}</h2>
                    <div className="ui-card">
                        {day.entries.map((entry) => (
                            <ActivityRow
                                key={entry.key}
                                zone={zone}
                                entry={entry}
                                now={now}
                                onOpen={() => void open(entry)}
                                onAction={(action) => act(entry, action)}
                            />
                        ))}
                    </div>
                </section>
            ))}
            {snapshot.hasMore ? <MoreRows loading={snapshot.loadingMore} onMore={() => feed.loadMore()} /> : null}
        </div>
    );
};

/** Loads more as the end comes into view; after a failure only when asked. */
const MoreRows: React.FC<{ loading: boolean; onMore: () => Promise<void> }> = ({ loading, onMore }) => {
    const { t } = useI18n();
    const ref = React.useRef<HTMLDivElement | null>(null);
    const [failed, setFailed] = React.useState(false);
    const more = React.useRef(() => {});
    more.current = () => {
        setFailed(false);
        onMore().catch((error) => {
            console.warn("[Activity] loading earlier rows failed", error);
            setFailed(true);
        });
    };
    React.useEffect(() => {
        const node = ref.current;
        if (!node || loading || failed || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((records) => {
            if (records.some((record) => record.isIntersecting)) more.current();
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, [loading, failed]);
    return (
        <div className="activity-end" ref={ref}>
            <Button size="sm" variant="ghost" busy={loading} onClick={() => more.current()}>
                {t("activity.earlier")}
            </Button>
        </div>
    );
};

export default Activity;
