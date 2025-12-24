import React from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
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
const CONCURRENT_REQUESTS = 50;

const ScanDevice: React.FC = () => {
    const { t } = useI18n();
    const [devices, setDevices] = React.useState<DeviceRecord[]>([]);
    const [scanning, setScanning] = React.useState(false);
    const [progress, setProgress] = React.useState(0);
    const [status, setStatus] = React.useState(() => t("device_scan.status_preparing"));
    const [selfScanDone, setSelfScanDone] = React.useState(false);
    const abortRef = React.useRef<boolean>(false);
    const selfIpSetRef = React.useRef<Set<string>>(new Set());
    const listRef = React.useRef<HTMLUListElement | null>(null);
    const scanInFlightRef = React.useRef(false);
    const pendingStartRef = React.useRef(false);

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
        const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        try {
            const response = await tauriFetch(`http://${ip}:3182/device`, {
                method: "GET",
                signal: controller.signal,
            });
            if (!response.ok) return null;
            const data = (await response.json()) as DeviceInfo | null;
            if (!data) return null;
            return { ...data, ip };
        } catch (err) {
            console.debug("[ScanDevice] plugin-http fetch failed", { ip, err });
            return null;
        } finally {
            window.clearTimeout(timer);
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
        async (targets: string[]) => {
            if (!targets.length) return false;
            let found = false;
            let processed = 0;
            let index = 0;
            const total = targets.length;

            const processIp = async (ip: string) => {
                if (abortRef.current) return;
                try {
                    const device = await fetchDeviceInfo(ip);
                    if (device) {
                        console.info("[ScanDevice] scan result", { ip, device });
                        addDevice({ ...device, isSelf: selfIpSetRef.current.has(device.ip) });
                        found = true;
                    }
                } finally {
                    processed += 1;
                    if (!abortRef.current) {
                        setProgress(processed / total);
                    }
                }
            };

            while (index < total && !abortRef.current) {
                const batch = targets.slice(index, index + CONCURRENT_REQUESTS);
                index += batch.length;
                await Promise.all(batch.map(processIp));
            }

            return found;
        },
        [addDevice, fetchDeviceInfo]
    );

    const runScan = React.useCallback(async function runScanImpl() {
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
            if (pendingStartRef.current) {
                pendingStartRef.current = false;
                runScanImpl();
            }
        }
    }, [t, normalizeCandidateIps, deriveBaseRanges, scanTargetsConcurrently]);

    const startScan = React.useCallback(() => {
        if (scanInFlightRef.current) {
            pendingStartRef.current = true;
            return;
        }
        pendingStartRef.current = false;
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
                        <div className="bind-ood-progress-percent">
                            {scanning && (
                                <span className="scan-progress-circle" aria-hidden="true">
                                    <span />
                                </span>
                            )}
                            <span>{scanning || percent ? `${percent}%` : ""}</span>
                        </div>
                    </div>
                </div>

                <div className="ood-device-list">
                    <div className="device-scroll-wrapper">
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
                                                const activeUrl = (device.active_url || "").trim();
                                                if (!activeUrl) return;
                                                const baseWindowOptions = {
                                                    center: true,
                                                };
                                                if (/^https?:\/\//i.test(activeUrl)) {
                                                    openWebView(activeUrl, title, label, baseWindowOptions);
                                                } else {
                                                    const base = `http://${device.display_ip || device.ip}:3182`;
                                                    const path = activeUrl.startsWith("/") ? activeUrl : `/${activeUrl}`;
                                                    openWebView(`${base}${path}`, title, label, baseWindowOptions);
                                                }
                                            }}
                                        >
                                            <div className="ood-device-title-row">
                                                <span>{title}</span>
                                                <span className="device-chip">{typeLabel}</span>
                                            </div>
                                            {device.base_os_info && (
                                                <div className="device-os-info">{device.base_os_info}</div>
                                            )}
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
