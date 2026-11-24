// A phone stops a page's sound soon after the client leaves the screen unless the client says that
// something plays; then the system's media controls work too. On the desktop nothing is needed.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { trackAlbum, trackTitle } from "@buckyos-desktop/music/playlist.ts";
import type { MusicPlayer } from "./player";

const COMMAND_EVENT = "audio://command";
/** Paused this long, it lets go. */
const PAUSED_MS = 10 * 60_000;

interface Item {
    title: string;
    artist: string;
    playing: boolean;
}

export interface BackgroundOptions {
    hold: (item: Item | null) => Promise<unknown>;
    onCommand: (handle: (command: string) => void) => void;
}

const native: BackgroundOptions = {
    hold: (item) => invoke("audio_hold", { item }),
    onCommand: (handle) => void listen<{ command: string }>(COMMAND_EVENT, ({ payload }) => handle(payload.command)),
};

type Player = Pick<MusicPlayer, "subscribe" | "getSnapshot" | "toggle" | "pause" | "next" | "previous">;

export function keepMusicPlaying(player: Player, options: BackgroundOptions = native): void {
    let told: Item | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tell = (item: Item | null) => {
        if (JSON.stringify(item) === JSON.stringify(told)) return;
        told = item;
        void options.hold(item).catch((error) => console.info("[Music] background", error));
    };

    const update = () => {
        const { track, folder, playing } = player.getSnapshot();
        clearTimeout(timer);
        // What was never started here (a track to come back to) needs nothing.
        if (!track || (!playing && !told)) {
            tell(null);
            return;
        }
        tell({ title: trackTitle(track), artist: trackAlbum(track, folder), playing });
        if (!playing) timer = setTimeout(() => tell(null), PAUSED_MS);
    };

    options.onCommand((command) => {
        const { playing } = player.getSnapshot();
        if (command === "play" ? !playing : command === "pause" ? playing : false) player.toggle();
        else if (command === "stop") player.pause();
        else if (command === "next") player.next();
        else if (command === "previous") player.previous();
    });
    player.subscribe(update);
    update();
}
