import React from "react";
import { X } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { Avatar } from "../../components/ui/Avatar";
import { Empty } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { appName, findApp } from "../apps/catalog";
import { AppIcon } from "../apps/AppTile";
import { clientRuntime } from "../content/clientRuntime";
import { tabOfView } from "../content/phoneTabs";
import type { ViewInfo } from "../content/types";
import { useRuntime } from "../content/useRuntime";
import type { ZoneView } from "../zone/types";
import "./container.css";

/** The open apps of a Zone, the last used first. The two of the navigation only while they are open. */
export function openApps(views: readonly ViewInfo[], zone: string): ViewInfo[] {
    return views.filter((view) => view.zone === zone).sort((left, right) => right.lastActive - left.lastActive);
}

interface AppSwitcherProps {
    open: boolean;
    zone: ZoneView;
    onClose: () => void;
}

export const AppSwitcher: React.FC<AppSwitcherProps> = ({ open, zone, onClose }) => {
    const { t, contentLocale } = useI18n();
    const { views, front } = useRuntime();
    const apps = openApps(views, zone.did);
    const catalog = clientRuntime.open.cachedCatalog(zone);
    return (
        <Sheet open={open} title={t("container.open_apps")} onClose={onClose} testId="app-switcher">
            {apps.length > 0 ? (
                <div className="switcher-list">
                    {apps.map((view) => {
                        const entry = catalog && findApp(catalog, view.appInstance);
                        const name = entry ? appName(entry, contentLocale) : view.app;
                        const tab = tabOfView(view.id);
                        return (
                            <div key={view.id} className="switcher-row" data-view={view.id} data-front={view.id === front || undefined}>
                                <button
                                    type="button"
                                    className="switcher-open"
                                    onClick={() => {
                                        onClose();
                                        void clientRuntime.focusView(view.id);
                                    }}
                                >
                                    {entry ? <AppIcon zone={zone} entry={entry} size={36} /> : <Avatar src={null} name={name} size={36} shape="square" />}
                                    <span className="ui-row-text">
                                        <span className="ui-row-title">{name}</span>
                                        {view.title && view.title !== name ? <span className="ui-row-sub">{view.title}</span> : null}
                                    </span>
                                    {view.id === front ? <span className="ui-row-value">{t("container.this_one")}</span> : null}
                                </button>
                                {tab ? null : (
                                    <IconButton label={t("container.close_app", { app: name })} onClick={() => void clientRuntime.closeView(view.id)}>
                                        <X size={17} />
                                    </IconButton>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <Empty text={t("container.none_open")} />
            )}
        </Sheet>
    );
};
