import React from "react";
import { NavLink } from "react-router-dom";
import { Bell, House, LayoutGrid, Settings } from "lucide-react";
import { badgeLabel } from "@buckyos-desktop/activity/model.ts";
import { useUnread } from "../features/notify/useUnread";
import { useZones } from "../features/zone/ZoneContext";
import { useI18n } from "../i18n";
import { TAB_PATHS } from "./RuntimeHost";

export const TabBar: React.FC = () => {
    const { t } = useI18n();
    const { current } = useZones();
    const unread = useUnread(current);
    const tabs = [
        { to: TAB_PATHS.home, label: t("tabs.home"), Icon: House, badge: 0 },
        { to: TAB_PATHS.apps, label: t("tabs.apps"), Icon: LayoutGrid, badge: 0 },
        { to: TAB_PATHS.activity, label: t("tabs.activity"), Icon: Bell, badge: unread },
        { to: TAB_PATHS.settings, label: t("tabs.setting"), Icon: Settings, badge: 0 },
    ];
    return (
        <nav className="tabbar" aria-label={t("tabs.label")}>
            {tabs.map(({ to, label, Icon, badge }) => (
                <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `tab ${isActive ? "active" : ""}`}
                    aria-label={badge > 0 ? t("tabs.unread", { tab: label, count: badgeLabel(badge) }) : undefined}
                >
                    <span className="tab-icon">
                        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                        {badge > 0 ? <span className="ui-badge">{badgeLabel(badge)}</span> : null}
                    </span>
                    <span className="tab-label">{label}</span>
                </NavLink>
            ))}
        </nav>
    );
};
