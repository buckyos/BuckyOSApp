import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";
import { useI18n } from "../../i18n";
import { getLocalIPv4List } from "../../utils/network";
import { openWebView } from "../../utils/webview";
import oodIllustration from "../../assets/ood.png";
import "./ScanDevice.css";
import "./Home.css";

interface DeviceInfo {
    hostname?: string;
    device_type?: string;
    active_url?: string;
    display_ip?: string;
    [key: string]: any;
}

interface DeviceRecord extends DeviceInfo {
    ip: string;
    isSelf?: boolean;
}

const REQUEST_TIMEOUT = 2500;
const CONCURRENT_REQUESTS = 20;

const ScanDevice: React.FC = () => {
    const { t } = useI18n();
    const [devices, setDevices] = React.useState<DeviceRecord[]>([]);
    const [scanning, setScanning] = React.useState(false);
    const [progress, setProgress] = React.useState(0);
    const [status, setStatus] = React.useState(() => t("device_scan.status_preparing"));
    const [selfScanDone, setSelfScanDone] = React.useState(false);
    const [listOverflow, setListOverflow] = React.useState(false);
    const abortRef = React.useRef<boolean>(false);
    const selfIpSetRef = React.useRef<Set<string>>(new Set());
    const listRef = React.useRef<HTMLUListElement | null>(null);
    const scanInFlightRef = React.useRef(false);

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
                    console.info("[ScanDevice] scan result", { ip, device });
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
                console.info("[ScanDevice] local ips", locals);
                const normalized = normalizeCandidateIps(locals);
                console.info("[ScanDevice] normalized ips", normalized);
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
                                console.info("[ScanDevice] scan result", { ip, device });
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
        [addDevice, fetchDeviceInfo]
    );

    const runScan = React.useCallback(async () => {
        if (scanInFlightRef.current) return;
        scanInFlightRef.current = true;
        abortRef.current = false;
        setDevices([]);
        setProgress(0);
        setStatus(t("device_scan.status_preparing"));
        setScanning(true);
        try {
            const locals = await getLocalIPv4List().catch(() => []);
            console.info("[ScanDevice] scan locals", locals);
            const pool = normalizeCandidateIps(locals);
            console.info("[ScanDevice] scan pool", pool);
            if (!pool.length) {
                setStatus(t("device_scan.status_error_no_ip"));
                return;
            }
            const bases = deriveBaseRanges(pool);
            if (!bases.length) {
                setStatus(t("device_scan.status_error_no_ip"));
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
                setStatus(t("device_scan.status_cancelled"));
            } else if (!found) {
                setStatus(t("device_scan.status_not_found"));
            } else {
                setStatus(t("device_scan.status_done"));
            }
        } finally {
            setScanning(false);
            scanInFlightRef.current = false;
        }
    }, [t, normalizeCandidateIps, deriveBaseRanges, scanTargetsConcurrently]);

    const startScan = React.useCallback(() => {
        void runScan();
    }, [runScan]);

    const handleCancelScan = React.useCallback(() => {
        if (!scanning) return;
        abortRef.current = true;
        setStatus(t("device_scan.status_cancelled"));
        setProgress(0);
        setScanning(false);
    }, [scanning, t]);

    React.useEffect(() => {
        const kickoff = window.setTimeout(() => {
            startScan();
        }, 0);
        return () => {
            window.clearTimeout(kickoff);
            abortRef.current = true;
        };
    }, [startScan]);

    React.useEffect(() => {
        return () => {
            abortRef.current = true;
        };
    }, []);

    React.useEffect(() => {
        const node = listRef.current;
        if (!node) {
            setListOverflow(false);
            return;
        }
        const updateOverflow = () => {
            setListOverflow(node.scrollHeight - node.clientHeight > 1);
        };
        updateOverflow();
        const observer = new ResizeObserver(updateOverflow);
        observer.observe(node);
        node.addEventListener("scroll", updateOverflow, { passive: true });
        return () => {
            observer.disconnect();
            node.removeEventListener("scroll", updateOverflow);
        };
    }, [devices.length]);

    const percent = Math.min(100, Math.round(progress * 100));
    const statusTitle = scanning ? t("device_scan.running_title") : status || t("device_scan.status_preparing");
    const statusDesc = scanning ? t("device_scan.running_desc") : t("device_scan.result_desc");

    return (
        <div className="bind-ood-scan-page">
            <MobileHeader title={t("device_scan.title")} showBack />

            <div className="scan-device-body">
                <div className="scan-device-hero" aria-hidden="true">
                    <img src={oodIllustration} alt="" className="scan-device-hero-image" />
                </div>

                <div className="bind-ood-progress-card">
                    <div className="bind-ood-progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                        <div className="bind-ood-progress-fill" style={{ width: `${percent}%` }} />
                    </div>

                    <div className="bind-ood-progress-meta">
                        <div>
                            <div className="bind-ood-progress-title">{statusTitle}</div>
                            <div className="bind-ood-progress-desc">{statusDesc}</div>
                        </div>
                        <div className="bind-ood-progress-percent">{scanning || percent ? `${percent}%` : ""}</div>
                    </div>
                </div>

                <div className="ood-device-list">
                    <div className={`device-scroll-wrapper ${devices.length ? "" : "is-empty"} ${listOverflow ? "show-fade" : ""}`}>
                        {!devices.length ? (
                            <div className="ood-device-empty">
                                {selfScanDone ? t("device_scan.pending_list_empty") : t("device_scan.pending_list_scanning")}
                            </div>
                        ) : (
                            <ul className="ood-device-scroll" ref={listRef}>
                                {devices.map((device) => {
                                    const title = `${device.hostname || device.ip}${device.isSelf ? t("device_scan.self_suffix") : ""}`;
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
                                                <span className="device-chip">{typeLabel}</span>
                                            </div>
                                            <small>{device.display_ip || device.ip}</small>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>

            <div className="sn-page-actions scan-device-actions">
                <GradientButton onClick={scanning ? handleCancelScan : startScan}>
                    {scanning ? t("device_scan.stop_button") : t("device_scan.rescan_button")}
                </GradientButton>
            </div>
        </div>
    );
};

export default ScanDevice;
