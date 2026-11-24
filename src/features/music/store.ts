// What this device keeps of the music of each Zone, per user of the Zone.
import { parseSavedPlayback, type PlayOrder, type SavedPlayback } from "@buckyos-desktop/music/playlist.ts";
import { folderPath } from "@buckyos-desktop/music/zoneFolders.ts";

export interface MusicSettings {
    /** Empty: none chosen. */
    folder: string;
    order: PlayOrder;
}

export interface MusicStore {
    settings: (key: string) => MusicSettings;
    saveSettings: (key: string, settings: MusicSettings) => void;
    playback: (key: string) => SavedPlayback | null;
    savePlayback: (key: string, playback: SavedPlayback) => void;
}

export function parseSettings(value: unknown): MusicSettings {
    const { folder, order } = (value ?? {}) as Record<string, unknown>;
    return {
        folder: typeof folder === "string" && folder.trim() ? folderPath(folder) : "",
        order: order === "shuffle" ? "shuffle" : "sequential",
    };
}

function read(key: string): unknown {
    try {
        return JSON.parse(localStorage.getItem(key) ?? "null");
    } catch {
        return null;
    }
}

function write(key: string, value: unknown) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Until the client closes.
    }
}

export const deviceStore: MusicStore = {
    settings: (key) => parseSettings(read(`buckyos.music.${key}`)),
    saveSettings: (key, settings) => write(`buckyos.music.${key}`, settings),
    playback: (key) => parseSavedPlayback(read(`buckyos.music.playback.${key}`)),
    savePlayback: (key, playback) => write(`buckyos.music.playback.${key}`, playback),
};
