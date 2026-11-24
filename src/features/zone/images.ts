import React from "react";
import { zoneImage } from "./api";

/** An address the page can load by itself: a data URL, or one without a session (`publicly`). */
export function directImage(url: string | null | undefined): string | null {
    return url && /^data:image\//i.test(url) ? url : null;
}

/** An image reference of a Zone as an absolute https address; a path is on the Zone's root. */
export function absoluteImage(url: string | null | undefined, host: string): string | null {
    const text = url?.trim();
    if (!text) return null;
    try {
        const absolute = new URL(text, `https://${host}/`);
        return absolute.protocol === "https:" ? absolute.href : null;
    } catch {
        return null;
    }
}

const loads = new Map<string, Promise<string | null>>();
const loaded = new Map<string, string | null>();
const MAX_KEPT = 300;

/** An image the client's own session fetches, as a data URL. Kept for as long as the window lives. */
export function loadZoneImage(zone: string, url: string): Promise<string | null> {
    const key = `${zone}|${url}`;
    let load = loads.get(key);
    if (!load) {
        if (loads.size >= MAX_KEPT) {
            const oldest = loads.keys().next().value;
            if (oldest !== undefined) {
                loads.delete(oldest);
                loaded.delete(oldest);
            }
        }
        load = zoneImage(zone, url)
            .then((image) => {
                loaded.set(key, image);
                return image;
            })
            .catch((error) => {
                console.info("[Zone] no image", url, error);
                // Not kept: the Zone may just be out of reach.
                loads.delete(key);
                return null;
            });
        loads.set(key, load);
    }
    return load;
}

/** The picture behind a Zone's image reference; null until it is there, and when there is none. */
export function useZoneImage(zone: string | null | undefined, host: string | undefined, url: string | null | undefined): string | null {
    const direct = directImage(url);
    const absolute = direct || !host ? null : absoluteImage(url, host);
    const key = zone && absolute ? `${zone}|${absolute}` : "";
    const [, changed] = React.useReducer((count: number) => count + 1, 0);
    React.useEffect(() => {
        if (!zone || !absolute || loaded.has(key)) return;
        let stopped = false;
        void loadZoneImage(zone, absolute).then(() => {
            if (!stopped) changed();
        });
        return () => {
            stopped = true;
        };
    }, [zone, absolute, key]);
    return direct ?? (key ? loaded.get(key) ?? null : null);
}
