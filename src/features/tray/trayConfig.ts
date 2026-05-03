import { useEffect, useState } from "react";
import { isMobileShell } from "../../utils/platform";

const TRAY_ENABLED_KEY = "buckyos.tray.enabled";

export function isTrayCapable(): boolean {
    // Tray is desktop-only. Mobile shells (iOS / Android) never get one.
    return !isMobileShell();
}

export function readTrayEnabled(): boolean {
    if (!isTrayCapable()) return false;
    try {
        const raw = localStorage.getItem(TRAY_ENABLED_KEY);
        if (raw === null) return true; // default ON for desktop
        return raw === "1" || raw === "true";
    } catch {
        return true;
    }
}

export function writeTrayEnabled(enabled: boolean): void {
    try {
        localStorage.setItem(TRAY_ENABLED_KEY, enabled ? "1" : "0");
    } catch {
        // best-effort persistence
    }
}

const subscribers = new Set<(enabled: boolean) => void>();

export function setTrayEnabledPreference(enabled: boolean): void {
    writeTrayEnabled(enabled);
    subscribers.forEach((cb) => cb(enabled));
}

export function useTrayEnabledPreference(): [boolean, (enabled: boolean) => void] {
    const [enabled, setEnabled] = useState<boolean>(() => readTrayEnabled());

    useEffect(() => {
        const cb = (next: boolean) => setEnabled(next);
        subscribers.add(cb);
        return () => {
            subscribers.delete(cb);
        };
    }, []);

    return [enabled, setTrayEnabledPreference];
}
