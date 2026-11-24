import { invoke } from "@tauri-apps/api/core";
import type { OwnerZone, ZoneList, ZoneProbe, ZoneView } from "./types";

export const ZONES_CHANGED_EVENT = "zone://changed";
export const SESSION_CHANGED_EVENT = "zone://session";

export const listZones = () => invoke<ZoneList>("zone_list");
export const probeZone = (address: string) => invoke<ZoneProbe>("zone_probe", { address });
/** Refused when `account` is no longer the active identity. */
export const syncOwnerZones = (account: string, zones: OwnerZone[]) => invoke<ZoneList>("zone_sync_owner", { account, zones });
export const addZone = (address: string, username: string, password: string) =>
    invoke<ZoneView>("zone_add", { address, username, password });
export const loginZone = (zone: string, username: string, password: string) =>
    invoke<ZoneView>("zone_login", { zone, username, password });
export const reconnectZone = (zone: string) => invoke<ZoneView>("zone_reconnect", { zone });
export const logoutZone = (zone: string) => invoke<void>("zone_logout", { zone });
export const removeZone = (zone: string) => invoke<ZoneList>("zone_remove", { zone });
export const setCurrentZone = (zone: string) => invoke<ZoneList>("zone_set_current", { zone });
export const updateZone = (zone: string, patch: { accent?: string | null; notify?: boolean }) =>
    invoke<ZoneList>("zone_update", { zone, patch });
/** An image of the Zone as a `data:` address; null when there is none. */
export const zoneImage = (zone: string, url: string) => invoke<string | null>("zone_image", { zone, url });
