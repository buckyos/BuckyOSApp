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

const BindOod: React.FC = () => {
    const { t } = useI18n();
    const [devices, setDevices] = React.useState<DeviceRecord[]>([]);
    const [scanning, setScanning] = React.useState(false);
    const [progress, setProgress] = React.useState(0);
    const [status, setStatus] = React.useState("");
    const [selfScanDone, setSelfScanDone] = React.useState(false);
    const abortRef = React.useRef<boolean>(false);
    const selfIpSetRef = React.useRef<Set<string>>(new Set());

    const addDevice = React.useCallback((info: DeviceRecord) => {
        setDevices((prev) => {
            const exists = prev.some(
                (item) =>
                    item.ip === info.ip ||
                    (item.hostname && item.device_type && item.hostname === info.hostname && item.device_type === info.device_type)
            );
            if (exists) return prev;
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
                    console.info("[BindOod] scan result", { ip, device });
                    addDevice({ ...device, isSelf: selfIpSetRef.current.has(device.ip) });
                }
            }
        },
        [addDevice, fetchDeviceInfo]
    );

    const normalizeCandidateIps = React.useCallback((ips: string[]) => {
        const sanitized = ips.filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith("127."));
        const hasNon172 = sanitized.some((ip) => !ip.startsWith("172."));
        return hasNon172 ? sanitized.filter((ip) => !ip.startsWith("172.")) : sanitized;
    }, []);

    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const locals = await getLocalIPv4List().catch(() => []);
                console.info("[BindOod] local ips", locals);
                const normalized = normalizeCandidateIps(locals);
                console.info("[BindOod] normalized ips", normalized);
                selfIpSetRef.current = new Set(normalized);
                await scanSpecificIps(normalized);
            } finally {
                if (alive) setSelfScanDone(true);
            }
        })();
        return () => {
            alive = false;
        };
    }, [scanSpecificIps, normalizeCandidateIps]);

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
                                console.info("[BindOod] scan result", { ip, device });
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
            const locals = await getLocalIPv4List().catch(() => []);
            console.info("[BindOod] scan locals", locals);
            const pool = normalizeCandidateIps(locals);
            console.info("[BindOod] scan pool", pool);
            if (!pool.length) {
                setStatus(t("ood.scan_error_no_ip"));
                return;
            }
            const bases = deriveBaseRanges(pool);
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
    }, [scanning, t, deriveBaseRanges, scanTargetsConcurrently, normalizeCandidateIps]);

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
        <section className="did-section" style={{ marginBottom: 12 }}>
            <header className="home-header">
                <div>
                    <h1>{t("ood.activate_title")}</h1>
                    <p>{t("ood.activate_subtitle")}</p>
                </div>
            </header>

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
        </section>
    );
};

export default BindOod;
