import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppWindow, Bell, ListChecks, MessageCircle } from "lucide-react";
import { useI18n } from "../i18n";
import { recentAlerts } from "../features/notify/api";
import type { Alert } from "../features/notify/types";
import { rowTime } from "../features/activity/view";

/** Rows the window has room for (src-tauri/src/tray.rs). */
const ROWS = 5;

const ICONS = { notify: AppWindow, message: MessageCircle, task: ListChecks, activity: Bell } as const;

/** The last notifications, next to the tray icon while the pointer is there. */
const TrayPopover: React.FC = () => {
    const { t, locale } = useI18n();
    const [alerts, setAlerts] = React.useState<Alert[] | null>(null);
    const several = new Set((alerts ?? []).map((alert) => alert.zone)).size > 1;

    React.useEffect(() => {
        let stopped = false;
        let newer = false;
        const put = (next: Alert[]) => {
            if (!stopped) setAlerts(next);
        };
        const changed = listen<Alert[]>("tray://alerts", ({ payload }) => {
            newer = true;
            put(payload);
        });
        void changed
            .then(() => recentAlerts())
            .then((recent) => {
                if (!newer) put(recent);
            })
            .catch((error) => console.warn("[Tray] no notifications", error));
        return () => {
            stopped = true;
            void changed.then((stop) => stop());
        };
    }, []);

    const hover = (inside: boolean) => void invoke("tray_popover_hover", { inside }).catch(() => undefined);
    const open = (alert: Alert | null) => void invoke("tray_popover_open", { alert }).catch((error) => console.error("[Tray] opening failed", error));

    return (
        <div className="tray-popover" data-testid="tray-popover" onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
            {(alerts ?? []).slice(0, ROWS).map((alert) => {
                const Icon = ICONS[alert.target.kind] ?? Bell;
                return (
                    <button key={`${alert.tag}-${alert.atMs}`} type="button" className="tray-row" onClick={() => open(alert)}>
                        <span className="activity-icon">
                            <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                        </span>
                        <span className="tray-text">
                            <span className="tray-title">{alert.title}</span>
                            <span className="tray-body">{[several ? alert.zoneLabel : "", alert.body].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className="activity-time">{rowTime(alert.atMs, Date.now(), locale)}</span>
                    </button>
                );
            })}
            {alerts && (
                <button type="button" className="tray-row tray-all" onClick={() => open(null)}>
                    {t("tray.popover_all")}
                </button>
            )}
        </div>
    );
};

export default TrayPopover;
