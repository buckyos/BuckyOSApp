import React from "react";
import { HardDrive, Laptop } from "lucide-react";
import { PageHeader } from "../../app/PageHeader";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Rows";
import { Empty, Spinner } from "../../components/ui/States";
import { useActivation } from "../../features/devices/ActivationContext";
import { RemoteDeviceDialog } from "../../features/devices/RemoteDeviceDialog";
import {
    activationUrl,
    candidateIps,
    deviceAddress,
    deviceTitle,
    mergeDevices,
    probeDevices,
    probeThisDevice,
    scanTargets,
    type DeviceRecord,
} from "../../features/devices/scan";
import { useI18n } from "../../i18n";
import { getLocalIPv4List } from "../../utils/network";
import { isMobileShell } from "../../utils/platform";
import oodIllustration from "../../assets/ood.png";
import "./ScanDevice.css";

const BATCH = 64;

type ScanState = "scanning" | "done" | "not_found" | "no_ip" | "canceled";

/** Devices that wait to be activated: this one first, then those on the local network. */
const ScanDevice: React.FC = () => {
    const { t, locale } = useI18n();
    const activation = useActivation();
    const [devices, setDevices] = React.useState<DeviceRecord[]>([]);
    const [state, setState] = React.useState<ScanState>("scanning");
    const [progress, setProgress] = React.useState(0);
    const [remote, setRemote] = React.useState(false);
    const turn = React.useRef(0);

    const scan = React.useCallback(async () => {
        const mine = ++turn.current;
        const current = () => turn.current === mine;
        setDevices([]);
        setProgress(0);
        setState("scanning");
        let own = new Set<string>();
        let found = 0;
        const add = (records: DeviceRecord[]) => {
            if (!current() || records.length === 0) return;
            found += records.length;
            setDevices((known) => mergeDevices(known, records, own));
        };
        const local = isMobileShell() ? Promise.resolve() : probeThisDevice().then((device) => add(device ? [device] : []));
        const ips = candidateIps(await getLocalIPv4List().catch(() => []));
        own = new Set(ips);
        const targets = scanTargets(ips);
        for (let index = 0; index < targets.length && current(); index += BATCH) {
            add(await probeDevices(targets.slice(index, index + BATCH)));
            if (current()) setProgress(Math.min(1, (index + BATCH) / targets.length));
        }
        await local;
        if (!current()) return;
        setProgress(1);
        setState(found > 0 ? "done" : targets.length > 0 ? "not_found" : "no_ip");
    }, []);

    React.useEffect(() => {
        // After a StrictMode remount only the second scan runs.
        const kickoff = window.setTimeout(() => void scan(), 0);
        return () => {
            window.clearTimeout(kickoff);
            turn.current += 1;
        };
    }, [scan]);

    const cancel = () => {
        turn.current += 1;
        setState("canceled");
    };

    const open = (device: DeviceRecord) => {
        const url = activationUrl(device, locale);
        if (!url) return;
        void activation
            ?.openActivation({ url, title: deviceTitle(device) })
            .catch((error) => console.warn("[ScanDevice] opening the activation page failed", device.ip, error));
    };

    const scanning = state === "scanning";
    const percent = Math.round(progress * 100);
    return (
        <div className="shell-page">
            <PageHeader title={t("device_scan.title")} back="/main/home" />
            <div className="shell-page-body ui-scroll" data-testid="scan-device">
                <div className="scan-head">
                    <img src={oodIllustration} alt="" />
                    <div className="scan-head-text">
                        <strong>{t(scanning ? "device_scan.running_title" : `device_scan.status_${STATUS_KEYS[state]}`)}</strong>
                        <span>{t(scanning ? "device_scan.running_desc" : devices.length > 0 ? "device_scan.result_desc" : "device_scan.hint")}</span>
                    </div>
                </div>
                {scanning ? (
                    <div className="ui-meter" role="progressbar" aria-label={t("device_scan.running_short")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <span style={{ width: `${percent}%`, "--ui-meter": "var(--cp-accent)" } as React.CSSProperties} />
                    </div>
                ) : null}
                {devices.length > 0 ? (
                    <Card testId="device-list">
                        {devices.map((device) => {
                            const Icon = device.isSelf && !isMobileShell() ? Laptop : HardDrive;
                            const details = [device.device_type, device.base_os_info, deviceAddress(device)].filter(Boolean).join(" · ");
                            return (
                                <div key={device.ip} className="ui-row">
                                    <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
                                    <span className="ui-row-text">
                                        <span className="ui-row-title">
                                            {deviceTitle(device)}
                                            {device.isSelf ? t("device_scan.self_suffix") : ""}
                                        </span>
                                        <span className="ui-row-sub">{details}</span>
                                    </span>
                                    <Button size="sm" variant={device.isSelf ? "primary" : "secondary"} onClick={() => open(device)}>
                                        {t("start.activate")}
                                    </Button>
                                </div>
                            );
                        })}
                    </Card>
                ) : (
                    <Empty text={t(scanning ? "device_scan.pending_list_scanning" : "device_scan.pending_list_empty")}>
                        {scanning ? <Spinner /> : null}
                    </Empty>
                )}
                <div className="scan-actions">
                    <Button onClick={scanning ? cancel : () => void scan()}>{t(scanning ? "device_scan.stop_button" : "ood.rescan_button")}</Button>
                    <Button variant="ghost" onClick={() => setRemote(true)}>
                        {t("start.remote")}
                    </Button>
                </div>
            </div>
            <RemoteDeviceDialog open={remote} onClose={() => setRemote(false)} />
        </div>
    );
};

const STATUS_KEYS: Record<Exclude<ScanState, "scanning">, string> = {
    done: "done",
    not_found: "not_found",
    no_ip: "error_no_ip",
    canceled: "cancelled",
};

export default ScanDevice;
