// What the Activity page shows of a row; no React.
import { isTaskFinished, type ActivityEntry, type ActivityLabel } from "@buckyos-desktop/activity/model.ts";

const DAY_MS = 86_400_000;

function dayStart(at: number): number {
    const date = new Date(at);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export interface ActivityDay {
    key: string;
    /** Whole days before today; 0 is today. */
    ago: number;
    start: number;
    entries: ActivityEntry[];
}

/** Rows under their days, in the order they come. */
export function groupByDay(entries: readonly ActivityEntry[], now: number): ActivityDay[] {
    const today = dayStart(now);
    const days: ActivityDay[] = [];
    for (const entry of entries) {
        const start = dayStart(entry.timestamp);
        const last = days[days.length - 1];
        if (last?.start === start) last.entries.push(entry);
        // Days are not all 24 hours long.
        else days.push({ key: String(start), ago: Math.max(0, Math.round((today - start) / DAY_MS)), start, entries: [entry] });
    }
    return days;
}

export function dayTitle(day: Pick<ActivityDay, "ago" | "start">, locale: string): string {
    if (day.ago < 2) {
        const text = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-day.ago, "day");
        return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
    }
    const sameYear = new Date(day.start).getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale, {
        weekday: day.ago < 7 ? "long" : undefined,
        month: "short",
        day: "numeric",
        year: sameYear ? undefined : "numeric",
    }).format(day.start);
}

/** Minutes ago for the last hour, then the time of day: the day is in the heading. */
export function rowTime(at: number, now: number, locale: string): string {
    const minutes = Math.floor((now - at) / 60_000);
    if (minutes < 1) return new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" }).format(0, "second");
    if (minutes < 60) return new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "narrow" }).format(-minutes, "minute");
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(at);
}

export type RowAction = "read" | "dismiss";

export function isUnread(entry: ActivityEntry): boolean {
    switch (entry.kind) {
        case "message":
            return entry.item.unreadCount > 0;
        case "notify":
            return entry.item.status === "open";
        default:
            return false;
    }
}

/** What can be done with a row besides opening it. */
export function rowActions(entry: ActivityEntry): RowAction[] {
    switch (entry.kind) {
        case "message":
            return entry.item.unreadCount > 0 ? ["read"] : [];
        case "notify":
            if (entry.item.status !== "open") return [];
            // A notice is read; what waits for an answer can only be answered or dismissed.
            return entry.item.kind === "notice" ? ["read"] : ["dismiss"];
        default:
            return isTaskFinished(entry.item.state) ? ["dismiss"] : [];
    }
}

/** Whether "mark all read" would change anything. */
export function canMarkAll(entries: readonly ActivityEntry[]): boolean {
    return entries.some((entry) => rowActions(entry).length > 0 && !(entry.kind === "notify" && entry.item.kind === "input"));
}

/** A label of the shared model by this client's own i18n keys: `tray.notify.todo` is `activity.label.notify_todo`. */
export function labelKey(label: ActivityLabel): string {
    return `activity.label.${label.key.replace(/^tray\./, "").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/\./g, "_")}`;
}

/** The sources of a `notify://changed` event that the feed reads again. */
export function changedSources(source: string): ("message" | "notify" | "task")[] | null {
    if (source === "message") return ["message", "notify"];
    if (source === "task") return ["task"];
    return null;
}
