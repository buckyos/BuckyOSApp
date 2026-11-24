// The apps on Home: a list of app ids in the account's desktop state of each Zone (`client_home`),
// the same on every device.
import type { ZoneChannel } from "@buckyos-desktop/channel.ts";
import { readDesktopState, writeDesktopState } from "@buckyos-desktop/controlPanel/desktopState.ts";
import type { AppCatalog, AppEntry } from "../apps/catalog";

export const CLIENT_HOME_STATE_KEY = "client_home";
const MAX_SHORTCUTS = 60;

/** What an account that never chose starts with. */
export const DEFAULT_SHORTCUTS = ["messagehub", "homestation", "aiworkspace", "files"];

/** The stored list; null when the account has none. */
export function readShortcuts(raw: unknown): string[] | null {
    const list = raw && typeof raw === "object" ? (raw as { shortcuts?: unknown }).shortcuts : null;
    if (!Array.isArray(list)) return null;
    const ids = list.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    return [...new Set(ids)].slice(0, MAX_SHORTCUTS);
}

/** The apps to show, in order. An id the Zone does not have now is kept in the list but not shown. */
export function shortcutEntries(catalog: AppCatalog, shortcuts: readonly string[], find: (catalog: AppCatalog, id: string) => AppEntry | undefined): AppEntry[] {
    const entries: AppEntry[] = [];
    for (const id of shortcuts) {
        const entry = find(catalog, id);
        if (entry && !entries.some((known) => known.instance === entry.instance)) entries.push(entry);
    }
    return entries;
}

/** `entries` with the pinned ones in front, in their order; the others keep theirs. */
export function pinnedFirst(entries: readonly AppEntry[], pinned: readonly AppEntry[]): AppEntry[] {
    const listed = new Set(entries.map((entry) => entry.instance));
    const first = pinned.filter((entry) => listed.has(entry.instance));
    const taken = new Set(first.map((entry) => entry.instance));
    return [...first, ...entries.filter((entry) => !taken.has(entry.instance))];
}

export function addShortcut(shortcuts: readonly string[], id: string): string[] {
    return shortcuts.includes(id) ? [...shortcuts] : [...shortcuts, id].slice(0, MAX_SHORTCUTS);
}

export function removeShortcut(shortcuts: readonly string[], id: string): string[] {
    return shortcuts.filter((candidate) => candidate !== id);
}

/** Puts `id` where `target` is. Ids that are not shown now keep their place next to their neighbours. */
export function moveShortcut(shortcuts: readonly string[], id: string, target: string): string[] {
    if (id === target || !shortcuts.includes(id) || !shortcuts.includes(target)) return [...shortcuts];
    const forward = shortcuts.indexOf(id) < shortcuts.indexOf(target);
    const rest = shortcuts.filter((candidate) => candidate !== id);
    const index = rest.indexOf(target) + (forward ? 1 : 0);
    return [...rest.slice(0, index), id, ...rest.slice(index)];
}

/** The tile whose middle is closest to a point, for dragging. */
export function nearestIndex(point: { x: number; y: number }, boxes: readonly { left: number; top: number; width: number; height: number }[]): number {
    let best = -1;
    let distance = Infinity;
    boxes.forEach((box, index) => {
        const dx = point.x - (box.left + box.width / 2);
        const dy = point.y - (box.top + box.height / 2);
        const square = dx * dx + dy * dy;
        if (square < distance) {
            distance = square;
            best = index;
        }
    });
    return best;
}

export async function loadShortcuts(channel: ZoneChannel): Promise<string[] | null> {
    const { value } = await readDesktopState<unknown>(channel, CLIENT_HOME_STATE_KEY);
    return readShortcuts(value);
}

export function saveShortcuts(channel: ZoneChannel, shortcuts: readonly string[]): Promise<void> {
    return writeDesktopState(channel, CLIENT_HOME_STATE_KEY, [...shortcuts], "shortcuts");
}
