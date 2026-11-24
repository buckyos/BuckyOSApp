// A device reached by an address the user typed.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export type RemoteProtocol = "http://" | "https://";
export type RemoteAddress = { ok: false; errorKey: string } | { ok: true; host: string; port: number; baseUrl: string };

const DEFAULT_PORT = 3182;
const PROBE_TIMEOUT_MS = 5000;

function isValidIpv4(host: string) {
    const parts = host.split(".");
    if (parts.length !== 4) return false;
    return parts.every((part) => /^\d{1,3}$/.test(part) && !(part.length > 1 && part.startsWith("0")) && Number(part) <= 255);
}

function isValidDomain(host: string) {
    if (host.length > 253) return false;
    return host.split(".").every((label) => label.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label));
}

export function normalizeRemoteAddress(protocol: RemoteProtocol, raw: string): RemoteAddress {
    const address = raw.trim();
    if (!address) return { ok: false, errorKey: "ood.remote_url_error_required" };
    if (/^https?:\/\//i.test(address)) return { ok: false, errorKey: "ood.remote_url_error_scheme_in_input" };
    if (/[/?#@]/.test(address)) return { ok: false, errorKey: "ood.remote_url_error_root_only" };
    const match = address.match(/^([^:]+)(?::(\d+))?$/);
    if (!match) return { ok: false, errorKey: "ood.remote_url_error_invalid" };
    const host = match[1].trim();
    if (!host || (!isValidIpv4(host) && !isValidDomain(host))) return { ok: false, errorKey: "ood.remote_url_error_invalid_host" };
    const port = match[2] ? Number(match[2]) : DEFAULT_PORT;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, errorKey: "ood.remote_url_error_invalid_port" };
    return { ok: true, host, port, baseUrl: `${protocol}${host}:${port}` };
}

export function resolveActiveUrl(baseUrl: string, activeUrl: string): string {
    const trimmed = activeUrl.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "";
    return `${baseUrl}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}

export interface RemoteDevice {
    url: string;
    title: string;
}

/** Asks the device for its activation page; throws when there is none. */
export async function findRemoteDevice(address: Extract<RemoteAddress, { ok: true }>, locale: string): Promise<RemoteDevice> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const response = await tauriFetch(`${address.baseUrl}/device`, { method: "GET", signal: controller.signal });
        if (!response.ok) throw new Error("device_request_failed");
        const device = (await response.json()) as Record<string, unknown>;
        const text = (key: string) => (typeof device[key] === "string" ? (device[key] as string).trim() : "");
        const target = resolveActiveUrl(address.baseUrl, text("active_url"));
        if (!target) throw new Error("missing_active_url");
        const url = new URL(target);
        url.searchParams.set("lang", locale);
        const title = text("device_name") || text("hostname") || address.host;
        return { url: url.toString(), title };
    } finally {
        window.clearTimeout(timeout);
    }
}
