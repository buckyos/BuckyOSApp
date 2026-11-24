import React from "react";
import { badgeLabel } from "@buckyos-desktop/activity/model.ts";
import { ActivityPage } from "../../pages/main/Activity";
import { useCatalog } from "../../features/apps/useCatalog";
import { appName, findApp } from "../../features/apps/catalog";
import { useMobileFeed } from "../../features/feed/mobileFeed";
import { useCounts } from "../../features/notify/useUnread";
import { useZones } from "../../features/zone/ZoneContext";
import { useI18n } from "../../i18n";
import { PhoneTabPage } from "./PhoneTabPage";

/** The feed tab: Home Station, or everything that happened. */
const FeedPage: React.FC = () => {
    const { t, contentLocale } = useI18n();
    const { current } = useZones();
    const { mode, choose } = useMobileFeed(current);
    const { catalog } = useCatalog(current);
    const { open } = useCounts(current);
    const station = catalog && findApp(catalog, "homestation");
    if (!current) return <PhoneTabPage tab="homestation" />;

    const bar = (actions: React.ReactNode) => (
        <div className="feed-bar" data-testid="feed-bar">
            <div className="ui-segmented" role="radiogroup" aria-label={t("phone.feed_label")}>
                <button type="button" role="radio" aria-checked={mode === "homestation"} onClick={() => choose("homestation")}>
                    {station ? appName(station, contentLocale) : t("phone.homestation")}
                </button>
                <button type="button" role="radio" aria-checked={mode === "activity"} onClick={() => choose("activity")}>
                    {t("phone.all_activity")}
                    {open > 0 ? <span className="ui-badge">{badgeLabel(open)}</span> : null}
                </button>
            </div>
            {actions}
        </div>
    );

    return mode === "activity" ? <ActivityPage key={current.did} zone={current} header={bar} /> : <PhoneTabPage tab="homestation" top={bar(null)} />;
};

export default FeedPage;
