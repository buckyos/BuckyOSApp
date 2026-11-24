import React from "react";
import { readSystemMetrics, type SystemMetrics } from "@buckyos-desktop/controlPanel/systemMetrics.ts";
import { zoneChannel } from "../zone/channel";
import { pageEnvironment } from "../zone/retry";
import type { ZoneView } from "../zone/types";

const POLL_MS = 10_000;
/** After a failure, and after an answer that rarely changes: an older Zone, no permission. */
const FAILED_MS = 5_000;
const REFUSED_MS = 60_000;

export type MetricsState = { kind: "loading" } | { kind: "ready"; metrics: SystemMetrics } | { kind: "unsupported" } | { kind: "denied" } | { kind: "failed" };

/** An older Zone does not know the method; anything else may work again later. */
export function metricsFailure(error: unknown): "unsupported" | "denied" | "failed" {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    const code = (error as { code?: unknown } | null)?.code;
    if (/unknown ?method|no such method|method not found|invalid system\.metrics response|http 404/.test(message)) return "unsupported";
    if (code === "access_denied" || /no permission|access denied/.test(message)) return "denied";
    return "failed";
}

/** A percentage to show: whole, and never outside of 0–100 whatever the Zone reports. */
export function percent(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(Math.min(100, Math.max(0, number))) : 0;
}

export function formatGb(value: number, locale: string): string {
    if (!Number.isFinite(value)) return "–";
    const [size, unit] = value >= 1000 ? [value / 1024, "TB"] : [value, "GB"];
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: size >= 100 ? 0 : 1 }).format(size)} ${unit}`;
}

export function formatRate(bytesPerSecond: number, locale: string): string {
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    let value = Number.isFinite(bytesPerSecond) ? Math.max(0, bytesPerSecond) : 0;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: value >= 100 || unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/** The largest unit the time fills, as `Intl.NumberFormat` writes it. */
export function formatUptime(seconds: number, locale: string): string {
    const steps: [number, string][] = [
        [86_400, "day"],
        [3600, "hour"],
        [60, "minute"],
    ];
    const [size, unit] = steps.find(([length]) => seconds >= length) ?? steps[2];
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(Math.max(0, Math.floor(seconds / size)));
}

export function meterColor(value: number): string {
    if (value >= 95) return "var(--cp-danger)";
    if (value >= 85) return "var(--cp-warning)";
    return "var(--cp-ink-accent)";
}

const last = new Map<string, SystemMetrics>();

/** The Zone's load, read again while the page can be seen. */
export function useMetrics(zone: ZoneView): MetricsState {
    const key = `${zone.did}|${zone.host}`;
    const ready = zone.session.state === "signed_in";
    const initial = (): MetricsState => {
        const known = last.get(key);
        return known ? { kind: "ready", metrics: known } : { kind: "loading" };
    };
    const [state, setState] = React.useState<{ key: string; value: MetricsState }>(() => ({ key, value: initial() }));

    React.useEffect(() => {
        if (!ready) return;
        let stopped = false;
        let reading = false;
        let timer: number | undefined;
        const target = { did: zone.did, host: zone.host };
        const put = (value: MetricsState) => {
            if (!stopped) setState({ key, value });
        };
        const read = async () => {
            if (stopped || reading) return;
            window.clearTimeout(timer);
            let wait = POLL_MS;
            if (document.visibilityState === "visible") {
                reading = true;
                try {
                    const metrics = await readSystemMetrics(zoneChannel(target));
                    last.set(key, metrics);
                    put({ kind: "ready", metrics });
                } catch (error) {
                    const kind = metricsFailure(error);
                    console.info("[Home] system.metrics", target.host, error);
                    put({ kind });
                    wait = kind === "failed" ? FAILED_MS : REFUSED_MS;
                } finally {
                    reading = false;
                }
            }
            if (!stopped) timer = window.setTimeout(() => void read(), wait);
        };
        void read();
        const unlisten = pageEnvironment.onWake(() => {
            if (pageEnvironment.visible()) void read();
        });
        return () => {
            stopped = true;
            window.clearTimeout(timer);
            unlisten();
        };
    }, [key, ready, zone.did, zone.host]);

    return state.key === key ? state.value : initial();
}
