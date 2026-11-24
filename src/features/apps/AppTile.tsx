import React from "react";
import { Avatar } from "../../components/ui/Avatar";
import { useI18n } from "../../i18n";
import { useZoneImage } from "../zone/images";
import type { ZoneView } from "../zone/types";
import { appName, type AppEntry } from "./catalog";
import "./apps.css";

/** A system app's picture is public; an installed app's is fetched with the client's own session. */
export const AppIcon: React.FC<{ zone: Pick<ZoneView, "did" | "host">; entry: AppEntry; size: number }> = ({ zone, entry, size }) => {
    const { contentLocale: locale } = useI18n();
    const fetched = useZoneImage(entry.kind === "app" ? zone.did : null, zone.host, entry.icon);
    return (
        <Avatar
            src={entry.kind === "system" ? entry.icon : fetched}
            name={appName(entry, locale)}
            id={entry.id}
            size={size}
            shape="square"
        />
    );
};

interface AppTileProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
    zone: Pick<ZoneView, "did" | "host">;
    entry: AppEntry;
    /** A window of the app is open: marked in the Zone's color. */
    running?: boolean;
    onOpen: () => void;
}

/** One app of a launcher grid. */
export const AppTile = React.forwardRef<HTMLButtonElement, React.PropsWithChildren<AppTileProps>>(function AppTile(
    { zone, entry, running = false, onOpen, className, children, ...rest },
    ref
) {
    const { t, contentLocale: locale } = useI18n();
    const name = appName(entry, locale);
    return (
        <button
            {...rest}
            ref={ref}
            type="button"
            className={className ? `app-tile ${className}` : "app-tile"}
            title={name}
            onClick={onOpen}
            data-app={entry.id}
        >
            <span className="app-tile-icon">
                <AppIcon zone={zone} entry={entry} size={44} />
                {running ? <span className="app-tile-running" role="img" aria-label={t("apps.running")} /> : null}
            </span>
            <span className="app-tile-name">{name}</span>
            {children}
        </button>
    );
});

export const AppGridSkeleton: React.FC<{ count: number }> = ({ count }) => (
    <div className="app-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
            <span key={index} className="app-tile app-tile-loading">
                <span className="app-tile-icon" />
                <span className="app-tile-name" />
            </span>
        ))}
    </div>
);
