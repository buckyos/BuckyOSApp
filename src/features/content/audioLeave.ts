import { audioStatus, type AudioStatus } from "./mobileViews";
import type { ViewInfo } from "./types";

export interface EndingAudio {
    /** Titles of the apps whose sound stops. */
    playing: string[];
    /** Title of the app whose recording stops. */
    recording: string | null;
}

/** What stops when the views of a Zone are closed; null when nothing does. */
export function endingAudio(status: AudioStatus, views: readonly Pick<ViewInfo, "id" | "zone" | "title" | "app">[], zone: string): EndingAudio | null {
    const own = views.filter((view) => view.zone === zone);
    const name = (view: (typeof own)[number]) => view.title || view.app;
    const playing = own.filter((view) => status.playing.includes(view.id)).map(name);
    const recorder = status.recording && status.recording.zone === zone ? status.recording : null;
    const recording = recorder ? name(own.find((view) => view.id === recorder.view) ?? { id: "", zone, title: "", app: recorder.app }) : null;
    return playing.length > 0 || recording ? { playing: [...new Set(playing)], recording } : null;
}

export async function readEndingAudio(views: readonly ViewInfo[], zone: string): Promise<EndingAudio | null> {
    try {
        return endingAudio(await audioStatus(), views, zone);
    } catch (error) {
        console.info("[Audio] no status", error);
        return null;
    }
}
