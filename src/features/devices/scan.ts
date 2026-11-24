// Devices waiting to be activated, on this computer and on the local network.
import { invoke } from "@tauri-apps/api/core";

export const LOOPBACK = "127.0.0.1";
const ACTIVATION_PORT = 3182;
const INTERLEAVE_GROUPS = 4;

export interface DeviceInfo {
    hostname?: string;
    device_type?: string;
    active_url?: string;
    display_ip?: string;
    base_os_info?: string;
    [key: string]: unknown;
}

export interface DeviceRecord extends DeviceInfo {
    ip: string;
    isSelf?: boolean;
}

/** The devices among these addresses that answer with an activation page. */
export async function probeDevices(ips: string[]): Promise<DeviceRecord[]> {
    if (ips.length === 0) return [];
    try {
        const devices = await invoke<DeviceRecord[]>("scan_device_batch", { ips });
        return devices.filter((device) => device?.ip && typeof device.active_url === "string" && device.active_url.trim());
    } catch (error) {
        console.debug("[Devices] probing failed", ips.length, error);
        return [];
    }
}

/** The device this client runs on, when its activation page is up. */
export async function probeThisDevice(): Promise<DeviceRecord | null> {
    const [device] = await probeDevices([LOOPBACK]);
    return device ? { ...device, isSelf: true } : null;
}

/** Addresses on a network worth scanning: no loopback, and no container networks when there is another. */
export function candidateIps(ips: readonly string[]): string[] {
    const usable = ips.filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith("127."));
    const plain = usable.filter((ip) => !ip.startsWith("172."));
    return plain.length > 0 ? plain : usable;
}

/** Every host of the networks of these addresses; the addresses themselves come first. */
export function scanTargets(ips: readonly string[]): string[] {
    const bases = [...new Set(ips.map((ip) => ip.split(".").slice(0, 3).join(".")))];
    const targets = new Set(ips);
    const lane = Math.ceil(254 / INTERLEAVE_GROUPS);
    for (const base of bases) {
        for (let offset = 0; offset < lane; offset += 1) {
            for (let group = 0; group < INTERLEAVE_GROUPS; group += 1) {
                const host = group * lane + offset + 1;
                if (host <= 254) targets.add(`${base}.${host}`);
            }
        }
    }
    return [...targets];
}

function sameDevice(left: DeviceRecord, right: DeviceRecord): boolean {
    if (left.ip === right.ip) return true;
    return Boolean(left.hostname && left.device_type && left.hostname === right.hostname && left.device_type === right.device_type);
}

/** Adds what was found. A device found by its loopback address stays that one; this device is listed first. */
export function mergeDevices(known: readonly DeviceRecord[], found: readonly DeviceRecord[], ownIps: ReadonlySet<string>): DeviceRecord[] {
    const devices = [...known];
    for (const device of found) {
        const record = { ...device, isSelf: device.isSelf || device.ip === LOOPBACK || ownIps.has(device.ip) };
        const index = devices.findIndex((other) => sameDevice(other, record));
        if (index < 0) devices.push(record);
        else if (record.ip === LOOPBACK) devices[index] = record;
        else if (record.isSelf) devices[index] = { ...devices[index], isSelf: true };
    }
    return [...devices.filter((device) => device.isSelf), ...devices.filter((device) => !device.isSelf)];
}

export function deviceTitle(device: DeviceRecord): string {
    return device.hostname || device.ip;
}

/** The address shown for a device; its loopback address says nothing to the user. */
export function deviceAddress(device: DeviceRecord): string {
    return device.ip === LOOPBACK ? device.display_ip || "" : device.display_ip || device.ip;
}

/** The activation page of a device, in the language of the client. */
export function activationUrl(device: DeviceRecord, locale: string): string | null {
    const path = device.active_url?.trim();
    if (!path) return null;
    const host = device.ip === LOOPBACK ? LOOPBACK : device.display_ip || device.ip;
    try {
        const url = new URL(/^https?:\/\//i.test(path) ? path : `http://${host}:${ACTIVATION_PORT}${path.startsWith("/") ? path : `/${path}`}`);
        url.searchParams.set("lang", locale);
        return url.toString();
    } catch {
        return null;
    }
}
