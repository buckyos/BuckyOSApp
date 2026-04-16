import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";
import { useI18n } from "../../i18n";
import { useDidContext } from "../../features/did/DidContext";
import { fetchSnStatus, getCachedSnStatus } from "../../features/sn/snStatusManager";
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

const SCAN_BATCH_SIZE = 64;
const SCAN_INTERLEAVE_GROUPS = 4;
const isMobileShell = () => /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent);

function hasUsableActiveUrl(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

const ScanDevice: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { activeDid } = useDidContext();
    const [devices, setDevices] = React.useState<DeviceRecord[]>([]);
    const [scanning, setScanning] = React.useState(false);
    const [progress, setProgress] = React.useState(0);
    const [status, setStatus] = React.useState(() => t("device_scan.status_preparing"));
    const [selfScanDone, setSelfScanDone] = React.useState(false);
    const [showTapHint, setShowTapHint] = React.useState(false);
    const abortRef = React.useRef<boolean>(false);
    const selfIpSetRef = React.useRef<Set<string>>(new Set());
    const listRef = React.useRef<HTMLUListElement | null>(null);
    const scanInFlightRef = React.useRef(false);
    const pendingStartRef = React.useRef(false);
    const oodCheckInFlightRef = React.useRef(false);

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

    const scanDeviceBatch = React.useCallback(async (ips: string[]) => {
        if (!ips.length) return [];
        try {
            const devices = await invoke<DeviceRecord[]>("scan_device_batch", { ips });
            return devices.filter((device) => device?.ip && hasUsableActiveUrl(device.active_url));
        } catch (err) {
            console.debug("[ScanDevice] scan_device_batch failed", { ips, err });
            return [];
        }
    }, []);

    const scanSpecificIps = React.useCallback(
        async (ips: string[]) => {
            const devices = await scanDeviceBatch(ips);
            if (abortRef.current) return;
            for (const device of devices) {
                console.info("[ScanDevice] self scan result", { ip: device.ip, device });
                addDevice({ ...device, isSelf: selfIpSetRef.current.has(device.ip) });
            }
        },
        [addDevice, scanDeviceBatch]
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

    const buildScanTargets = React.useCallback((base: string) => {
        const hosts = Array.from({ length: 254 }, (_, index) => index + 1);
        const laneSize = Math.ceil(hosts.length / SCAN_INTERLEAVE_GROUPS);
        const ordered: string[] = [];

        for (let offset = 0; offset < laneSize; offset += 1) {
            for (let lane = 0; lane < SCAN_INTERLEAVE_GROUPS; lane += 1) {
                const host = hosts[lane * laneSize + offset];
                if (host) {
                    ordered.push(`${base}.${host}`);
                }
            }
        }

        return ordered;
    }, []);

    const scanTargetsConcurrently = React.useCallback(
        async (targets: string[]) => {
            if (!targets.length) return false;
            let found = false;
            let processed = 0;
            let index = 0;
            const total = targets.length;

            while (index < total && !abortRef.current) {
                const batch = targets.slice(index, index + SCAN_BATCH_SIZE);
                index += batch.length;
                const devices = await scanDeviceBatch(batch);
                if (abortRef.current) return found;
                for (const device of devices) {
                    console.info("[ScanDevice] scan result", { ip: device.ip, device });
                    addDevice({ ...device, isSelf: selfIpSetRef.current.has(device.ip) });
                    found = true;
                }
                processed += batch.length;
                setProgress(processed / total);
            }

            return found;
        },
        [addDevice, scanDeviceBatch]
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
                targets.push(...buildScanTargets(base));
            });
            const prioritizedTargets = targets.sort((left, right) => {
                const leftIsLocal = selfIpSetRef.current.has(left);
                const rightIsLocal = selfIpSetRef.current.has(right);
                if (leftIsLocal !== rightIsLocal) {
                    return leftIsLocal ? -1 : 1;
                }
                return left.localeCompare(right, undefined, { numeric: true });
            });
            const found = await scanTargetsConcurrently(prioritizedTargets);
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
    }, [t, normalizeCandidateIps, deriveBaseRanges, buildScanTargets, scanTargetsConcurrently]);

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

    React.useEffect(() => {
        if (!showTapHint) return;
        const timer = window.setTimeout(() => {
            setShowTapHint(false);
        }, 1500);
        return () => {
            window.clearTimeout(timer);
        };
    }, [showTapHint]);

    React.useEffect(() => {
        if (!activeDid || devices.length === 0 || oodCheckInFlightRef.current) return;

        let cancelled = false;
        let timer: number | undefined;

        const pollOodBinding = async () => {
            if (!activeDid?.bucky_wallets?.length) return;
            const cached = await getCachedSnStatus(activeDid.id);
            const hasUsername = Boolean(
                (typeof cached?.username === "string" && cached.username.trim().length > 0) ||
                (typeof activeDid.sn_status?.username === "string" &&
                    activeDid.sn_status.username.trim().length > 0)
            );
            const hasZoneConfig =
                typeof cached?.zoneConfig === "string" && cached.zoneConfig.trim().length > 0;

            if (cancelled) return;
            if (hasZoneConfig) {
                navigate("/main/home");
                return;
            }
            if (!hasUsername) return;

            try {
                oodCheckInFlightRef.current = true;
                const jwk = JSON.stringify(activeDid.bucky_wallets[0].public_key as any);
                const record = await fetchSnStatus(activeDid.id, jwk);
                if (
                    !cancelled &&
                    typeof record.zoneConfig === "string" &&
                    record.zoneConfig.trim().length > 0
                ) {
                    navigate("/main/home");
                    return;
                }
            } catch (err) {
                console.warn("[OOD-CHECK] scan page refresh failed", err);
            } finally {
                oodCheckInFlightRef.current = false;
            }

            if (!cancelled) {
                timer = window.setTimeout(pollOodBinding, 5000);
            }
        };

        timer = window.setTimeout(pollOodBinding, 5000);

        return () => {
            cancelled = true;
            if (timer) {
                window.clearTimeout(timer);
            }
        };
    }, [activeDid, devices.length, navigate]);

    const percent = Math.min(100, Math.round(progress * 100));
    const statusTitle = scanning ? t("device_scan.running_title") : status || t("device_scan.status_preparing");
    const statusDesc = scanning ? t("device_scan.running_desc") : t("device_scan.result_desc");

    return (
        <div className="bind-ood-scan-page">
            {showTapHint ? <div className="scan-device-mobile-hint">Locating...</div> : null}
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
                                                if (isMobileShell()) {
                                                    setShowTapHint(true);
                                                }
                                                const baseWindowOptions = {
                                                    center: true,
                                                };
                                                const target = /^https?:\/\//i.test(activeUrl)
                                                    ? activeUrl
                                                    : `http://${device.display_ip || device.ip}:3182${
                                                        activeUrl.startsWith("/") ? activeUrl : `/${activeUrl}`
                                                    }`;
                                                void openWebView(target, title, label, baseWindowOptions).catch((err) => {
                                                    console.warn("[ScanDevice] open device webview failed", {
                                                        ip: device.ip,
                                                        target,
                                                        err,
                                                    });
                                                });
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
