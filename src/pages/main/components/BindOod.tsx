import React from "react";
import { useI18n } from "../../../i18n";
import { getLocalIPv4List } from "../../../utils/network";
import GradientButton from "../../../components/ui/GradientButton";
import { openWebView } from "../../../utils/webview";

interface DeviceInfo {
    hostname?: string;
    device_type?: string;
    [key: string]: any;
}

interface DeviceRecord extends DeviceInfo {
    ip: string;
    display_ip?: string;
    isSelf?: boolean;
}

const REQUEST_TIMEOUT = 2500;
const CONCURRENT_REQUESTS = 20;

const DEMO_EXTRA_DEVICES: DeviceRecord[] = [
    { hostname: "Office-EdgeDevice", device_type: "ood", display_ip: "192.168.100.80", ip: "demo-extra-1" },
    { hostname: "IoT-Gateway-01", device_type: "iot", display_ip: "192.168.100.120", ip: "demo-extra-2" },
    { hostname: "Home-Server", device_type: "ood", display_ip: "10.0.0.25", ip: "demo-extra-3" },
    { hostname: "Lab-MiniPC", device_type: "mini-pc", display_ip: "192.168.1.55", ip: "demo-extra-4" },
];

const BindOod: React.FC = () => {
    const { t } = useI18n();
    const [devices, setDevices] = React.useState<DeviceRecord[]>([]);
    const [scanning, setScanning] = React.useState(false);
    const [progress, setProgress] = React.useState(0);
    const [status, setStatus] = React.useState("");
    const [selfScanDone, setSelfScanDone] = React.useState(false);
    const abortRef = React.useRef<boolean>(false);
    const demoFilledRef = React.useRef<boolean>(false);
    const selfIpSetRef = React.useRef<Set<string>>(new Set());

    const addDevice = React.useCallback((info: DeviceRecord) => {
        setDevices((prev) => {
            const exists = prev.some(
                (item) =>
                    item.ip === info.ip ||
                    (item.hostname && item.device_type && item.hostname === info.hostname && item.device_type === info.device_type)
            );
            if (exists) return prev;
            if (!demoFilledRef.current && prev.length === 0) {
                demoFilledRef.current = true;
                const clones = Array.from({ length: 5 }, (_, idx) => ({
                    ...info,
                    ip: `${info.ip}-demo-${idx + 1}`,
                    display_ip: info.ip,
                }));
                const extras = DEMO_EXTRA_DEVICES.map((dev, idx) => ({
                    ...dev,
                    ip: `${dev.ip}-${idx}`,
                    display_ip: dev.display_ip || dev.ip,
                }));
                return [...prev, info, ...clones, ...extras];
            }
            return [...prev, info];
        });
    }, []);

    const fetchDeviceInfo = React.useCallback(async (ip: string): Promise<DeviceRecord | null> => {
        if (!ip) return null;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        try {
            const resp = await fetch(`http://${ip}:3182/device`, { signal: controller.signal });
            if (!resp.ok) return null;
            const data = (await resp.json()) as DeviceInfo;
            if (!data) return null;
            return { ...data, ip };
        } catch {
            return null;
        } finally {
            window.clearTimeout(timeout);
        }
    }, []);

    const scanSpecificIps = React.useCallback(
        async (ips: string[]) => {
            for (const ip of ips) {
                if (abortRef.current) return;
                const device = await fetchDeviceInfo(ip);
                if (device) {
                    addDevice({ ...device, isSelf: selfIpSetRef.current.has(device.ip) });
                }
            }
        },
        [addDevice, fetchDeviceInfo]
    );

    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const fallbackHost = window.location.hostname && /^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname)
                    ? [window.location.hostname]
                    : [];
                const locals = await getLocalIPv4List().catch(() => []);
                const unique = Array.from(
                    new Set([
                        ...locals,
                        ...fallbackHost,
                        ...(window.location.hostname === "localhost" ? ["127.0.0.1"] : []),
                    ]),
                );
                selfIpSetRef.current = new Set(unique);
                await scanSpecificIps(unique);
                if (!demoFilledRef.current && unique.length === 0) {
                    demoFilledRef.current = true;
                    setDevices((prev) => [
                        ...prev,
                        ...DEMO_EXTRA_DEVICES.map((dev, idx) => ({
                            ...dev,
                            ip: `${dev.ip}-initial-${idx}`,
                            display_ip: dev.display_ip || dev.ip,
                        })),
                    ]);
                }
            } finally {
                if (alive) setSelfScanDone(true);
            }
        })();
        return () => {
            alive = false;
        };
    }, [scanSpecificIps]);

    const deriveBaseRanges = React.useCallback((ips: string[]) => {
        const bases = new Set<string>();
        ips.forEach((ip) => {
            const parts = ip.split(".");
            if (parts.length === 4) {
                bases.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
            }
        });
        return Array.from(bases);
    }, []);

    const scanTargetsConcurrently = React.useCallback(
        (targets: string[]) => {
            if (!targets.length) return Promise.resolve(false);
            let index = 0;
            let active = 0;
            let processed = 0;
            let found = false;
            const total = targets.length;
            return new Promise<boolean>((resolve) => {
                const maybeResolve = () => {
                    if ((abortRef.current || index >= total) && active === 0) {
                        resolve(found);
                    }
                };
                const launch = () => {
                    if (abortRef.current) {
                        maybeResolve();
                        return;
                    }
                    if (index >= total) {
                        maybeResolve();
                        return;
                    }
                    const ip = targets[index++];
                    active += 1;
                    fetchDeviceInfo(ip)
                        .then((device) => {
                            if (device) {
                                addDevice({ ...device, isSelf: selfIpSetRef.current.has(device.ip) });
                                found = true;
                            }
                        })
                        .finally(() => {
                            active -= 1;
                            processed += 1;
                            if (!abortRef.current) {
                                setProgress(processed / total);
                            }
                            launch();
                            maybeResolve();
                        });
                };
                const initial = Math.min(CONCURRENT_REQUESTS, total);
                for (let i = 0; i < initial; i += 1) {
                    launch();
                }
            });
        },
        [addDevice, fetchDeviceInfo, t]
    );

    const handleScanNetwork = React.useCallback(async () => {
        if (scanning) return;
        abortRef.current = false;
        setDevices([]);
        setProgress(0);
        setStatus(t("ood.scan_status_preparing"));
        setScanning(true);
        try {
            const fallbackHost = window.location.hostname && /^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname)
                ? [window.location.hostname]
                : window.location.hostname === "localhost"
                    ? ["127.0.0.1"]
                    : [];
            const locals = await getLocalIPv4List().catch(() => []);
            const pool = [...locals, ...fallbackHost];
            if (!pool.length) {
                setStatus(t("ood.scan_error_no_ip"));
                return;
            }
            const non172 = pool.filter((ip) => !ip.startsWith("172."));
            const candidatePool = non172.length ? non172 : pool;
            const bases = deriveBaseRanges(candidatePool);
            if (!bases.length) {
                setStatus(t("ood.scan_error_no_ip"));
                return;
            }
            const targets: string[] = [];
            bases.forEach((base) => {
                for (let i = 1; i <= 255; i += 1) {
                    targets.push(`${base}.${i}`);
                }
            });
            const found = await scanTargetsConcurrently(targets);
            if (!abortRef.current) {
                setProgress(1);
            }
            if (abortRef.current) {
                setStatus(t("ood.scan_cancelled"));
            } else if (!found) {
                setStatus(t("ood.scan_not_found"));
            } else {
                setStatus(t("ood.scan_status_done"));
            }
        } finally {
            setScanning(false);
        }
    }, [scanning, t, deriveBaseRanges, scanTargetsConcurrently]);

    const handleCancelScan = React.useCallback(() => {
        if (!scanning) return;
        abortRef.current = true;
        setStatus(t("ood.scan_cancelled"));
        setProgress(0);
        setScanning(false);
    }, [scanning, t]);

    React.useEffect(() => {
        return () => {
            abortRef.current = true;
        };
    }, []);

    return (
        <>
            <div className="ood-info-card">
                <p>{t("ood.activate_desc_inline")}</p>
            </div>

            <div className="ood-actions">
                <GradientButton
                    className="ood-action-btn"
                    fullWidth={false}
                    style={{ height: 42 }}
                    onClick={scanning ? handleCancelScan : handleScanNetwork}
                >
                    {scanning ? t("ood.cancel_scan_button") : t("ood.scan_local_button")}
                </GradientButton>
                <GradientButton
                    className="ood-action-btn"
                    fullWidth={false}
                    variant="secondary"
                    style={{ height: 42 }}
                    disabled
                    title={t("ood.manual_url_hint")}
                >
                    {t("ood.manual_url_button")}
                </GradientButton>
            </div>

            {(scanning || progress > 0 || !!status) && (
                <div className="ood-progress">
                    <div
                        className="ood-progress-bar"
                        style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }}
                    />
                </div>
            )}
            {(scanning || status) && (
                <div className="sn-loading-text">
                    {scanning
                        ? t("ood.scanning_percent_label", { percent: Math.min(100, Math.round(progress * 100)) })
                        : status}
                </div>
            )}

            <div className="ood-device-list">
                <div className="ood-device-header">{t("ood.pending_list_title")}</div>
                {!devices.length ? (
                    <div className="ood-device-empty">
                        {selfScanDone ? t("ood.pending_list_empty") : t("ood.pending_list_scanning")}
                    </div>
                ) : (
                    <ul className="ood-device-scroll">
                        {devices.map((device) => {
                            const title = `${device.hostname || device.ip}${device.isSelf ? t("ood.self_suffix") : ""}`;
                            const typeLabel = device.device_type || "unknown";
                            const label = `active-${device.hostname || typeLabel}-${device.ip}`;
                            return (
                                <li
                                    key={`${device.ip}-${device.hostname || typeLabel}`}
                                    className="ood-device-item"
                                    onClick={() => {
                                        const activeUrl = device.active_url || "";
                                        let target = activeUrl.trim();
                                        if (!target) return;
                                        if (/^https?:\/\//i.test(target)) {
                                            openWebView(target, title, label);
                                        } else {
                                            const base = `http://${device.display_ip || device.ip}:3182`;
                                            const path = target.startsWith("/") ? target : `/${target}`;
                                            openWebView(`${base}${path}`, title, label);
                                        }
                                    }}
                                >
                                    <div className="ood-device-title-row">
                                        <span>{title}</span>
                                        <span className="ood-device-tag">{typeLabel}</span>
                                    </div>
                                    <small>{device.display_ip || device.ip}</small>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </>
    );
};

export default BindOod;
