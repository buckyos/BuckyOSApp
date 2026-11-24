import React from "react";
import { BatteryWarning, ShieldAlert } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Field";
import { Card, Row, Section } from "../../components/ui/Rows";
import { nativeStatus, openSystemSettings } from "../../features/content/mobileViews";
import { notifyPermission, notifySettings, setNotifyEnabled } from "../../features/notify/api";
import { updateZone } from "../../features/zone/api";
import { useZones } from "../../features/zone/ZoneContext";
import { zoneTitle } from "../../features/zone/types";
import { ZoneMark } from "../../features/zone/ZoneMark";
import { useI18n } from "../../i18n";
import { isIosShell, isMobileShell } from "../../utils/platform";

/** Notifications of the client: on or off, from which Zones, and what the system says about it. */
export const NotifySection: React.FC = () => {
    const { t } = useI18n();
    const { zones } = useZones();
    const [enabled, setEnabled] = React.useState<boolean | null>(null);
    const [refused, setRefused] = React.useState(false);
    const phone = isMobileShell();
    /** Nothing is shown by the system there yet (TODO Q18): neither its permission nor the service matter. */
    const ios = isIosShell();
    /** Phone: the system stops the client in the background to save power. */
    const [restricted, setRestricted] = React.useState(false);

    React.useEffect(() => {
        let stopped = false;
        const read = () => {
            if (phone && !ios) {
                nativeStatus()
                    .then((status) => {
                        if (!stopped) setRestricted(!status.batteryUnrestricted);
                    })
                    .catch((error) => console.info("[Notify] no native status", error));
            }
            Promise.all([notifySettings(), notifyPermission()])
                .then(([settings, permission]) => {
                    if (stopped) return;
                    setEnabled(settings.enabled);
                    setRefused(permission === false);
                })
                .catch((error) => console.warn("[Notify] reading the settings failed", error));
        };
        read();
        // Back from the system's settings.
        const onVisible = () => {
            if (document.visibilityState === "visible") read();
        };
        window.addEventListener("focus", read);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            stopped = true;
            window.removeEventListener("focus", read);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [phone, ios]);

    const change = async (next: boolean) => {
        setEnabled(next);
        try {
            const allowed = await setNotifyEnabled(next);
            setRefused(next && !allowed && !ios);
        } catch (error) {
            console.error("[Notify] changing the switch failed", error);
            setEnabled(!next);
        }
    };

    return (
        <Section
            title={t("prefs.notifications")}
            note={ios ? t("prefs.notify_ios_note") : enabled && refused && !phone ? t("prefs.notify_refused") : enabled && phone ? t("prefs.notify_phone_note") : undefined}
        >
            <Card testId="notify-settings">
                <Row
                    title={t("prefs.notify_all")}
                    sub={t("prefs.notify_all_sub")}
                    wrapSub
                    end={
                        <Switch
                            label={t("prefs.notify_all")}
                            checked={enabled ?? false}
                            disabled={enabled === null}
                            testId="notify-enabled"
                            onChange={(next) => void change(next)}
                        />
                    }
                />
                {enabled && phone && refused ? (
                    <Row
                        icon={<ShieldAlert size={18} strokeWidth={1.8} />}
                        title={t("prefs.notify_allow")}
                        sub={t("prefs.notify_allow_sub")}
                        wrapSub
                        testId="notify-allow"
                        end={
                            <Button size="sm" variant="primary" onClick={() => void openSystemSettings("notifications")}>
                                {t("prefs.open_settings")}
                            </Button>
                        }
                    />
                ) : null}
                {enabled && phone && restricted ? (
                    <Row
                        icon={<BatteryWarning size={18} strokeWidth={1.8} />}
                        title={t("prefs.battery")}
                        sub={t("prefs.battery_sub")}
                        wrapSub
                        testId="notify-battery"
                        end={
                            <Button size="sm" onClick={() => void openSystemSettings("battery")}>
                                {t("prefs.open_settings")}
                            </Button>
                        }
                    />
                ) : null}
                {enabled
                    ? zones.map((zone) => (
                        <Row
                            key={zone.did}
                            icon={<ZoneMark zone={zone} size={22} />}
                            title={zoneTitle(zone)}
                            end={
                                <Switch
                                    label={t("prefs.notify_from", { zone: zoneTitle(zone) })}
                                    checked={zone.notify}
                                    onChange={(notify) =>
                                        void updateZone(zone.did, { notify }).catch((error) => console.error("[Zone] notify", error))
                                    }
                                />
                            }
                        />
                    ))
                    : null}
            </Card>
        </Section>
    );
};
