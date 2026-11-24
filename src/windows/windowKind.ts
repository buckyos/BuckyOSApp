import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Which of the client's windows this page runs in. Only `main` runs the client's runtime (the
 * Zones, the app windows, the tray); the others are small pages of their own.
 */
export type WindowKind = "main" | "content" | "sign" | "tray" | "other";

export function windowKindOf(label: string | undefined): WindowKind {
    if (!label || label === "main") return "main";
    if (label.startsWith("app_")) return "content";
    if (label === "aux_tray") return "tray";
    if (label.startsWith("aux_sign_")) return "sign";
    return "other";
}

export function currentWindowKind(): WindowKind {
    try {
        return windowKindOf(getCurrentWebviewWindow().label);
    } catch {
        // A plain browser (development).
        return "main";
    }
}
