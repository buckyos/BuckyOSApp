import { listen } from "@tauri-apps/api/event";
import { LINE_CHANGED_EVENT, type LineChanged } from "./api";

const listeners = new Set<() => void>();
let started = false;

/**
 * Calls back when a Zone can be reached (again, or another way). Without any network the browser's
 * own `online` never comes, although the Zone on this computer is there.
 */
export function onLineBack(listener: () => void): () => void {
    listeners.add(listener);
    if (!started) {
        started = true;
        listen<LineChanged>(LINE_CHANGED_EVENT, ({ payload: { line } }) => {
            if (line.line && !line.waiting && !line.unreachable) listeners.forEach((call) => call());
        }).catch((error) => {
            started = false;
            console.warn("[Zone] not told of the lines", error);
        });
    }
    return () => {
        listeners.delete(listener);
    };
}
