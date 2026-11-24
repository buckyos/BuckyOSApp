import React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useI18n } from "../../i18n";
import type { ZoneView } from "../zone/types";
import { formatGb, formatRate, formatUptime, meterColor, percent, useMetrics } from "./metrics";
import "./home.css";

const Stat: React.FC<{ label: string; value: string; used: number; detail?: string }> = ({ label, value, used, detail }) => (
    <div className="status-stat">
        <span className="status-label">{label}</span>
        <span className="status-value">{value}</span>
        <div className="ui-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}>
            <span style={{ width: `${used}%`, "--ui-meter": meterColor(used) } as React.CSSProperties} />
        </div>
        <span className="status-detail">{detail}</span>
    </div>
);

/** How loaded the Zone's devices are. */
export const StatusCard: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t, locale } = useI18n();
    const state = useMetrics(zone);
    if (state.kind === "denied") return null;
    const metrics = state.kind === "ready" ? state.metrics : null;
    return (
        <section className="ui-section" data-testid="status-card">
            <div className="home-heading">
                <h2 className="ui-section-title">{t("home.status")}</h2>
                {metrics ? <span className="home-heading-note">{t("home.uptime", { time: formatUptime(metrics.uptimeSeconds, locale) })}</span> : null}
            </div>
            <div className="ui-card status-card">
                {state.kind === "unsupported" ? (
                    <p className="status-message">{t("home.status_upgrade")}</p>
                ) : state.kind === "failed" ? (
                    <p className="status-message">{t("home.status_failed")}</p>
                ) : (
                    <>
                        <div className="status-stats">
                            <Stat
                                label={t("home.cpu")}
                                value={metrics ? `${percent(metrics.cpu?.usagePercent)}%` : "–"}
                                used={percent(metrics?.cpu?.usagePercent)}
                                detail={metrics ? t("home.cores", { count: metrics.cpu?.cores ?? 0 }) : ""}
                            />
                            <Stat
                                label={t("home.memory")}
                                value={metrics ? `${percent(metrics.memory?.usagePercent)}%` : "–"}
                                used={percent(metrics?.memory?.usagePercent)}
                                detail={metrics ? formatGb(metrics.memory?.totalGb, locale) : ""}
                            />
                            <Stat
                                label={t("home.storage")}
                                value={metrics ? `${percent(metrics.disk?.usagePercent)}%` : "–"}
                                used={percent(metrics?.disk?.usagePercent)}
                                detail={metrics ? formatGb(metrics.disk?.totalGb, locale) : ""}
                            />
                        </div>
                        <div className="status-network">
                            <span title={t("home.download")}>
                                <ArrowDown size={13} aria-label={t("home.download")} />
                                {metrics ? formatRate(metrics.network?.rxPerSec ?? 0, locale) : "–"}
                            </span>
                            <span title={t("home.upload")}>
                                <ArrowUp size={13} aria-label={t("home.upload")} />
                                {metrics ? formatRate(metrics.network?.txPerSec ?? 0, locale) : "–"}
                            </span>
                        </div>
                    </>
                )}
            </div>
        </section>
    );
};
