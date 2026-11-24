import React from "react";
import { useNavigate } from "react-router-dom";
import { LayoutGrid, RotateCw } from "lucide-react";
import { PageHeader } from "../../app/PageHeader";
import { Button, IconButton } from "../../components/ui/Button";
import { SearchInput } from "../../components/ui/Field";
import { Menu } from "../../components/ui/Menu";
import { Empty, Notice } from "../../components/ui/States";
import { AppGridSkeleton, AppTile } from "../../features/apps/AppTile";
import { findApp, type AppEntry } from "../../features/apps/catalog";
import { launcherEntries, useCatalog } from "../../features/apps/useCatalog";
import { clientRuntime } from "../../features/content/clientRuntime";
import { useRuntime } from "../../features/content/useRuntime";
import { addShortcut, removeShortcut, shortcutEntries } from "../../features/home/shortcuts";
import { useShortcuts } from "../../features/home/useShortcuts";
import { SessionNotice } from "../../features/zone/SessionNotice";
import { useZones } from "../../features/zone/ZoneContext";
import { zoneTitle, type ZoneView } from "../../features/zone/types";
import { useI18n } from "../../i18n";

const Apps: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { current } = useZones();
    if (!current) {
        return (
            <div className="shell-page">
                <PageHeader title={t("tabs.apps")} />
                <div className="shell-page-body">
                    <div className="shell-fill">
                        <Empty icon={<LayoutGrid size={26} strokeWidth={1.6} />} title={t("apps.no_zone")} text={t("apps.no_zone_text")}>
                            <Button onClick={() => navigate("/main/home")}>{t("zones.to_home")}</Button>
                        </Empty>
                    </div>
                </div>
            </div>
        );
    }
    return <ZoneApps key={current.did} zone={current} />;
};

/** Every app of the Zone for its user. */
const ZoneApps: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t, contentLocale } = useI18n();
    const [search, setSearch] = React.useState("");
    const { catalog, loading, failed, reload } = useCatalog(zone);
    const { shortcuts, editable, change } = useShortcuts(zone);
    const { views } = useRuntime();
    const [menu, setMenu] = React.useState<{ x: number; y: number; entry: AppEntry } | null>(null);
    const entries = catalog ? launcherEntries(catalog, contentLocale, search) : [];
    const running = new Set(views.filter((view) => view.zone === zone.did).map((view) => view.appInstance));
    const userId = zone.session.identity?.user_id;
    const onHome = new Set(
        catalog && shortcuts ? shortcutEntries(catalog, shortcuts, (list, id) => findApp(list, id, userId)).map((entry) => entry.instance) : []
    );

    const open = (entry: AppEntry) => void clientRuntime.openApp(zone.did, entry.instance);

    return (
        <div className="shell-page">
            <PageHeader
                title={t("tabs.apps")}
                zone
                actions={
                    <IconButton label={t("apps.reload")} onClick={reload} disabled={zone.session.state !== "signed_in"}>
                        <RotateCw size={15} />
                    </IconButton>
                }
            />
            <div style={{ padding: "0 16px 8px" }}>
                <SearchInput value={search} onChange={setSearch} label={t("apps.search")} />
            </div>
            <div className="shell-page-body ui-scroll">
                <SessionNotice zone={zone} />
                {catalog?.systemApps === "unavailable" ? (
                    <Notice tone="warn" testId="apps-upgrade">
                        {t("apps.upgrade", { zone: zoneTitle(zone) })}
                    </Notice>
                ) : null}
                {catalog ? (
                    entries.length > 0 ? (
                        <div className="app-grid" data-testid="app-grid">
                            {entries.map((entry) => (
                                <AppTile
                                    key={entry.instance}
                                    zone={zone}
                                    entry={entry}
                                    running={running.has(entry.instance)}
                                    onOpen={() => open(entry)}
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        setMenu({ x: event.clientX, y: event.clientY, entry });
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <Empty text={t(search.trim() ? "apps.no_match" : "apps.empty")} />
                    )
                ) : loading ? (
                    <AppGridSkeleton count={12} />
                ) : failed ? (
                    <Empty text={t("apps.failed")}>
                        <Button size="sm" onClick={reload}>
                            {t("ui.retry")}
                        </Button>
                    </Empty>
                ) : null}
            </div>
            <Menu
                at={menu}
                label={t("tabs.apps")}
                onClose={() => setMenu(null)}
                items={
                    menu
                        ? [
                            { id: "open", label: t("apps.open"), onSelect: () => open(menu.entry) },
                            onHome.has(menu.entry.instance)
                                ? {
                                    id: "remove",
                                    label: t("apps.remove_home"),
                                    disabled: !editable,
                                    onSelect: () => {
                                        const id = shortcuts?.find((candidate) => candidate === menu.entry.instance || candidate === menu.entry.id);
                                        if (shortcuts && id) change(removeShortcut(shortcuts, id));
                                    },
                                }
                                : {
                                    id: "add",
                                    label: t("apps.add_home"),
                                    disabled: !editable,
                                    onSelect: () => {
                                        if (shortcuts) change(addShortcut(shortcuts, menu.entry.id));
                                    },
                                },
                        ]
                        : []
                }
            />
        </div>
    );
};

export default Apps;
