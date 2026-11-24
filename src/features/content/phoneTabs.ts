// The two tabs of a phone's navigation that show a Zone page. Their view is the app's main window:
// an icon, a notification or a link that opens the app comes to the same one (TODO Q15).
import { appWindowId, parseAppWindowId } from "buckyos/open-app";

export type PhoneTab = "messagehub" | "homestation";

export const PHONE_TABS: readonly PhoneTab[] = ["messagehub", "homestation"];

/** The tab a view belongs to; null for an app's own container. */
export function tabOfView(viewId: string): PhoneTab | null {
    const parts = parseAppWindowId(viewId);
    if (!parts || parts.windowPath !== "") return null;
    return PHONE_TABS.find((tab) => tab === parts.appInstance) ?? null;
}

export function tabViewId(zone: string, tab: PhoneTab): string {
    return appWindowId(zone, tab, "");
}
