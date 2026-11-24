import { afterEach, describe, expect, it, vi } from "vitest";
import { keepMusicPlaying } from "./background";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));

function setup() {
    let snapshot = { track: null as string | null, folder: "/home/bob/Music", playing: false, position: 0 };
    const listeners = new Set<() => void>();
    const asked: string[] = [];
    const held: unknown[] = [];
    let command: (name: string) => void = () => undefined;
    keepMusicPlaying(
        {
            subscribe: (listener: () => void) => {
                listeners.add(listener);
                return () => void listeners.delete(listener);
            },
            getSnapshot: () => snapshot as never,
            toggle: () => void asked.push("toggle"),
            pause: () => void asked.push("pause"),
            next: () => void asked.push("next"),
            previous: () => void asked.push("previous"),
        },
        { hold: async (item) => void held.push(item), onCommand: (handle) => (command = handle) }
    );
    const set = (patch: Partial<typeof snapshot>) => {
        snapshot = { ...snapshot, ...patch };
        listeners.forEach((listener) => listener());
    };
    return { set, held, asked, command: (name: string) => command(name) };
}

const item = (track: string, playing: boolean) => expect.objectContaining({ title: track, playing });

describe("the music in the background", () => {
    afterEach(() => vi.useRealTimers());

    it("holds from the first play on, and lets go with the track", () => {
        const { set, held } = setup();
        set({ track: "/home/bob/Music/1.mp3" });
        expect(held).toEqual([]);
        set({ playing: true });
        set({ position: 1 });
        set({ playing: false });
        set({ track: "/home/bob/Music/2.mp3", playing: true });
        set({ track: null, playing: false });
        expect(held).toEqual([item("1", true), item("1", false), item("2", true), null]);
    });

    it("lets go after a long pause and holds again on play", () => {
        vi.useFakeTimers();
        const { set, held } = setup();
        set({ track: "/home/bob/Music/1.mp3", playing: true });
        set({ playing: false });
        vi.advanceTimersByTime(9 * 60_000);
        set({ position: 3 });
        expect(held.length).toBe(2);
        vi.advanceTimersByTime(10 * 60_000);
        expect(held.at(-1)).toBeNull();
        set({ playing: true });
        expect(held.at(-1)).toEqual(item("1", true));
    });

    it("does what the media controls ask", () => {
        const { set, asked, command } = setup();
        set({ track: "/home/bob/Music/1.mp3", playing: true });
        for (const name of ["play", "pause", "next", "previous", "stop", "other"]) command(name);
        set({ playing: false });
        for (const name of ["pause", "play"]) command(name);
        expect(asked).toEqual(["toggle", "next", "previous", "pause", "toggle"]);
    });
});
