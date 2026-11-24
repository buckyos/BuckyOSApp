import React from "react";
import { ChevronRight, Music } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { SearchInput } from "../../components/ui/Field";
import { Empty, Notice } from "../../components/ui/States";
import { AppGridSkeleton, AppIcon, AppTile } from "../../features/apps/AppTile";
import { findApp, type AppEntry } from "../../features/apps/catalog";
import { launcherEntries, useCatalog } from "../../features/apps/useCatalog";
import { AppSwitcher, openApps } from "../../features/container/AppSwitcher";
import { clientRuntime } from "../../features/content/clientRuntime";
import { useRuntime } from "../../features/content/useRuntime";
import { FirstZone } from "../../features/home/FirstZone";
import { pinnedFirst, shortcutEntries } from "../../features/home/shortcuts";
import { useShortcuts } from "../../features/home/useShortcuts";
import { MusicCard, MusicFolderDialog } from "../../features/music/MusicCard";
import { useMusicValue } from "../../features/music/useMusic";
import { AccountArea } from "../../features/zone/AccountArea";
import { SessionNotice } from "../../features/zone/SessionNotice";
import { useZones } from "../../features/zone/ZoneContext";
import { zoneTitle, type ZoneView } from "../../features/zone/types";
import { useI18n } from "../../i18n";
import "../../features/container/container.css";

const PhoneHome: React.FC = () => {
    const { current, zones, loading } = useZones();
    return (
        <div className="shell-page ui-scroll">
            <div className="shell-page-body home-page" data-testid="phone-home">
                <AccountArea />
                {current ? <Launcher key={current.did} zone={current} /> : zones.length === 0 && !loading ? <FirstZone /> : null}
            </div>
        </div>
    );
};

/** Every app of the Zone; those kept on Home come first. */
const Launcher: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t, contentLocale } = useI18n();
    const { catalog, loading, failed, reload } = useCatalog(zone);
    const { shortcuts } = useShortcuts(zone);
    const { views } = useRuntime();
    const [search, setSearch] = React.useState("");
    const [switching, setSwitching] = React.useState(false);
    const [choosing, setChoosing] = React.useState(false);
    // Until there is a folder, music takes no more than its button.
    const offerMusic = useMusicValue((music) => music.zone === zone.did && !music.folder && music.ready);
    const userId = zone.session.identity?.user_id;

    const entries = React.useMemo(() => {
        if (!catalog) return [];
        const listed = launcherEntries(catalog, contentLocale, search);
        const pinned = shortcuts ? shortcutEntries(catalog, shortcuts, (list, id) => findApp(list, id, userId)) : [];
        return pinnedFirst(listed, pinned);
    }, [catalog, shortcuts, contentLocale, search, userId]);
    const running = openApps(views, zone.did);
    const instances = new Set(running.map((view) => view.appInstance));
    const runningEntries = running
        .map((view) => catalog && findApp(catalog, view.appInstance))
        .filter((entry): entry is AppEntry => Boolean(entry))
        .slice(0, 4);

    return (
        <>
            <SessionNotice zone={zone} />
            {running.length > 0 ? (
                <button type="button" className="open-apps" onClick={() => setSwitching(true)} data-testid="open-apps">
                    <span className="open-apps-icons">
                        {runningEntries.map((entry) => (
                            <AppIcon key={entry.instance} zone={zone} entry={entry} size={24} />
                        ))}
                    </span>
                    <span>{t("container.open_count", { count: running.length })}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                </button>
            ) : null}
            <MusicCard zone={zone} optional />
            {catalog ? (
                <div className="phone-search">
                    <SearchInput value={search} onChange={setSearch} label={t("apps.search")} />
                    {offerMusic ? (
                        <IconButton label={t("music.choose_title")} onClick={() => setChoosing(true)} data-testid="music-choose">
                            <Music size={19} />
                        </IconButton>
                    ) : null}
                </div>
            ) : null}
            {catalog?.systemApps === "unavailable" ? <Notice tone="warn">{t("apps.upgrade", { zone: zoneTitle(zone) })}</Notice> : null}
            {catalog ? (
                entries.length > 0 ? (
                    <div className="app-grid" data-testid="app-grid">
                        {entries.map((entry) => (
                            <AppTile
                                key={entry.instance}
                                zone={zone}
                                entry={entry}
                                running={instances.has(entry.instance)}
                                onOpen={() => void clientRuntime.openApp(zone.did, entry.instance)}
                            />
                        ))}
                    </div>
                ) : (
                    <Empty text={t(search.trim() ? "apps.no_match" : "apps.empty")} />
                )
            ) : loading ? (
                <AppGridSkeleton count={16} />
            ) : failed ? (
                <Empty text={t("apps.failed")}>
                    <Button size="sm" onClick={reload}>
                        {t("ui.retry")}
                    </Button>
                </Empty>
            ) : null}
            {choosing ? <MusicFolderDialog zone={zone} onClose={() => setChoosing(false)} /> : null}
            <AppSwitcher open={switching} zone={zone} onClose={() => setSwitching(false)} />
        </>
    );
};

export default PhoneHome;
