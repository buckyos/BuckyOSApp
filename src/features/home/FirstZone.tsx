import React from "react";
import { useNavigate } from "react-router-dom";
import { Laptop, RefreshCw } from "lucide-react";
import { Button, IconButton } from "../../components/ui/Button";
import { Spinner } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { isMobileShell } from "../../utils/platform";
import { useActivation } from "../devices/ActivationContext";
import { RemoteDeviceDialog } from "../devices/RemoteDeviceDialog";
import { activationUrl, deviceTitle, probeThisDevice, type DeviceRecord } from "../devices/scan";
import "./home.css";

/** Home of an account without any Zone: activate a device, or sign in to a Zone that is already there. */
export const FirstZone: React.FC = () => {
    const { t, locale } = useI18n();
    const navigate = useNavigate();
    const activation = useActivation();
    const [remote, setRemote] = React.useState(false);
    const desktop = !isMobileShell();
    const [device, setDevice] = React.useState<DeviceRecord | null | undefined>(undefined);

    const look = React.useCallback(() => {
        if (!desktop) return () => undefined;
        let stopped = false;
        setDevice(undefined);
        void probeThisDevice().then((found) => {
            if (!stopped) setDevice(found);
        });
        return () => {
            stopped = true;
        };
    }, [desktop]);
    React.useEffect(() => look(), [look]);

    const activate = (found: DeviceRecord) => {
        const url = activationUrl(found, locale);
        if (!url) return;
        const title = deviceTitle(found);
        void activation?.openActivation({ url, title }).catch((error) => console.warn("[Home] opening the activation page failed", error));
    };

    return (
        <>
            <section className="ui-card start-card" data-testid="first-zone">
                <h2>{t("start.device_title")}</h2>
                <p>{t(desktop ? "start.device_text" : "start.device_text_phone")}</p>
                {desktop ? (
                    <div className="device-row" data-testid="this-device">
                        <Laptop size={20} strokeWidth={1.7} aria-hidden="true" />
                        <span className="ui-row-text">
                            <span className="ui-row-title">{t("start.this_device")}</span>
                            <span className="ui-row-sub" data-wrap="true">
                                {device === undefined ? t("start.this_device_looking") : device ? deviceTitle(device) : t("start.this_device_none")}
                            </span>
                        </span>
                        {device === undefined ? (
                            <Spinner />
                        ) : device ? (
                            <Button size="sm" variant="primary" onClick={() => activate(device)}>
                                {t("start.activate")}
                            </Button>
                        ) : (
                            <IconButton label={t("start.look_again")} onClick={() => look()}>
                                <RefreshCw size={15} />
                            </IconButton>
                        )}
                    </div>
                ) : null}
                <div className="start-actions">
                    <Button variant={desktop ? "secondary" : "primary"} onClick={() => navigate("/main/home/ood-scan")}>
                        {t("start.scan")}
                    </Button>
                    <Button onClick={() => setRemote(true)}>{t("start.remote")}</Button>
                </div>
            </section>
            <section className="ui-card start-card">
                <h2>{t("start.zone_title")}</h2>
                <p>{t("start.zone_text")}</p>
                <div className="start-actions">
                    <Button onClick={() => navigate("/main/setting/zones/add")}>{t("zones.add")}</Button>
                </div>
            </section>
            <RemoteDeviceDialog open={remote} onClose={() => setRemote(false)} />
        </>
    );
};
