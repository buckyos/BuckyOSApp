import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, House, MessageCircle, Newspaper, Plus, Settings } from "lucide-react";
import { badgeLabel } from "@buckyos-desktop/activity/model.ts";
import { CreateSheet } from "../../features/create/CreateSheet";
import { resetFeed, useMobileFeed } from "../../features/feed/mobileFeed";
import { useCounts } from "../../features/notify/useUnread";
import { useZones } from "../../features/zone/ZoneContext";
import { useI18n } from "../../i18n";
import { PHONE_PATHS } from "./paths";
import "../../features/container/container.css";

export const PhoneNav: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { current } = useZones();
    const { mode } = useMobileFeed(current);
    const { open, unread } = useCounts(current);
    const [creating, setCreating] = React.useState(false);

    const tab = (path: string, label: string, Icon: typeof House, badge = 0, onGo?: () => void) => {
        const active = pathname === path;
        return (
            <button
                key={path}
                type="button"
                className={`tab ${active ? "active" : ""}`}
                aria-current={active ? "page" : undefined}
                aria-label={badge > 0 ? t("tabs.unread", { tab: label, count: badgeLabel(badge) }) : undefined}
                data-tab={path}
                onClick={() => {
                    onGo?.();
                    navigate(path);
                }}
            >
                <span className="tab-icon">
                    <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
                    {badge > 0 ? <span className="ui-badge">{badgeLabel(badge)}</span> : null}
                </span>
                <span className="tab-label">{label}</span>
            </button>
        );
    };

    return (
        <nav className="tabbar phone-nav" aria-label={t("tabs.label")}>
            {tab(PHONE_PATHS.home, t("tabs.home"), House)}
            {tab(PHONE_PATHS.messagehub, t("phone.messages"), MessageCircle, unread)}
            <button
                type="button"
                className="tab-plus"
                aria-label={t("phone.create")}
                aria-haspopup="dialog"
                disabled={current?.session.state !== "signed_in"}
                onClick={() => setCreating(true)}
                data-testid="create"
            >
                <span>
                    <Plus size={21} strokeWidth={2.2} aria-hidden="true" />
                </span>
            </button>
            {tab(PHONE_PATHS.feed, t("phone.feed"), mode === "activity" ? Bell : Newspaper, open, () => current && pathname !== PHONE_PATHS.feed && resetFeed(current))}
            {tab(PHONE_PATHS.settings, t("tabs.setting"), Settings)}
            {current ? <CreateSheet open={creating} zone={current} onClose={() => setCreating(false)} /> : null}
        </nav>
    );
};
