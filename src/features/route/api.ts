import { invoke } from "@tauri-apps/api/core";

export interface BrowserStatus {
    enabled: boolean;
    /** Why the script is not there although it is to be. */
    error: string | null;
    port: number;
    address: string;
}

export interface RouteStatus {
    /** Whether pages can take the direct ways on this device. */
    pages: boolean;
    /** Whether the system lets the client at devices in the local network, where it is known. */
    local_network: boolean;
    platform: "windows" | "macos" | "linux" | "android" | "ios";
    browser: BrowserStatus;
}

export const routeStatus = () => invoke<RouteStatus>("route_status");
export const setBrowserRoute = (enabled: boolean) => invoke<RouteStatus>("route_set_browser", { enabled });
