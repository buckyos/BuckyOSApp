import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Where the main window's `<audio>` reads something of a Zone: a scheme of the client's, answered
 * with its session (`src-tauri/src/zone/media.rs`). `path` is path and query on the Zone's root.
 * `convertFileSrc` only says how the scheme is written on this system: it would encode the slashes.
 */
export function mediaUrl(zone: string, path: string, base: string = convertFileSrc("", "zonemedia")): string {
    return `${base.replace(/\/+$/, "")}/${encodeURIComponent(zone)}/${path.replace(/^\/+/, "")}`;
}
