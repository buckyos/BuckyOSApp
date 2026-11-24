import { describe, expect, it, vi } from "vitest";
import { NfspError } from "buckyos/nfsp";
import type { SavedPlayback } from "@buckyos-desktop/music/playlist.ts";
import { mediaUrl } from "./mediaUrl";
import { MusicPlayer, type MusicZone } from "./player";
import { parseSettings, type MusicSettings, type MusicStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: () => "", invoke: () => Promise.reject(new Error("unused")) }));

/** An `<audio>`: what a page sets, and the events a test tells. */
class FakeAudio {
    source = "";
    currentTime = 0;
    duration = Number.NaN;
    paused = true;
    preload = "";
    private listeners = new Map<string, (() => void)[]>();
    set src(value: string) {
        this.source = value;
        this.currentTime = 0;
        this.duration = Number.NaN;
        this.paused = true;
    }
    get src() {
        return this.source;
    }
    addEventListener(name: string, listener: () => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    }
    removeAttribute() {
        this.source = "";
    }
    load() {
        this.currentTime = 0;
        this.duration = Number.NaN;
    }
    tell(name: string) {
        this.listeners.get(name)?.forEach((listener) => listener());
    }
    play() {
        this.paused = false;
        this.tell("play");
        return Promise.resolve();
    }
    pause() {
        if (this.paused) return;
        this.paused = true;
        this.tell("pause");
    }
    /** The source is in, and it plays when it was started. */
    ready(duration = 200) {
        this.duration = duration;
        this.tell("loadedmetadata");
        if (!this.paused) this.tell("playing");
    }
    at(seconds: number) {
        this.currentTime = seconds;
        this.tell("timeupdate");
    }
}

const settle = async () => {
    for (let round = 0; round < 8; round += 1) await Promise.resolve();
};

const bob: MusicZone = { did: "did:bns:bob", host: "bob.example", user: "bob", ready: true };
const library = ["/home/bob/Music/1.mp3", "/home/bob/Music/2.mp3", "/home/bob/Music/3.mp3"];

function setup(options: { settings?: Record<string, MusicSettings>; playback?: Record<string, SavedPlayback>; tracks?: string[] | Error } = {}) {
    const audio = new FakeAudio();
    const settings = new Map(Object.entries(options.settings ?? { "did:bns:bob|bob": { folder: "/home/bob/Music", order: "sequential" as const } }));
    const playback = new Map(Object.entries(options.playback ?? {}));
    const store: MusicStore = {
        settings: (key) => settings.get(key) ?? { folder: "", order: "sequential" },
        saveSettings: (key, value) => void settings.set(key, value),
        playback: (key) => playback.get(key) ?? null,
        savePlayback: (key, value) => void playback.set(key, value),
    };
    const clock = { now: 1_000_000 };
    const zoneOf: string[] = [];
    const state = { tracks: (options.tracks ?? library) as string[] | Error, read: async (path: string): Promise<string> => `/nfs/v1/read${path}` };
    const tracks = vi.fn(async () => {
        if (state.tracks instanceof Error) throw state.tracks;
        return state.tracks;
    });
    const player = new MusicPlayer({
        audio: () => audio as unknown as HTMLAudioElement,
        folders: (zone) => {
            zoneOf.push(zone.did);
            return { tracks, readPath: (path: string) => state.read(path) };
        },
        store,
        url: (zone, path) => `${zone}${path}`,
        mediaSession: () => null,
        now: () => clock.now,
    });
    return { audio, player, settings, playback, clock, state, tracks, zoneOf };
}

describe("the address of a Zone's media", () => {
    it("names the Zone and keeps the path as it is written", () => {
        expect(mediaUrl("did:web:charlie.me", "/nfs/v1/read/a%20b?sig=x%2By", "zonemedia://localhost/")).toBe(
            "zonemedia://localhost/did%3Aweb%3Acharlie.me/nfs/v1/read/a%20b?sig=x%2By"
        );
        expect(mediaUrl("did:bns:a", "/b", "http://zonemedia.localhost/")).toBe("http://zonemedia.localhost/did%3Abns%3Aa/b");
    });
});

describe("what a device keeps", () => {
    it("is read back with care", () => {
        expect(parseSettings({ folder: "cyfs:///home/bob/Music/", order: "shuffle" })).toEqual({ folder: "/home/bob/Music", order: "shuffle" });
        expect(parseSettings({ folder: "  ", order: "x" })).toEqual({ folder: "", order: "sequential" });
        expect(parseSettings(null)).toEqual({ folder: "", order: "sequential" });
        expect(parseSettings("x")).toEqual({ folder: "", order: "sequential" });
    });
});

describe("the music player", () => {
    it("comes back paused where it was", async () => {
        const { audio, player } = setup({ playback: { "did:bns:bob|bob": { folder: "/home/bob/Music", track: library[1], position: 42, seed: 7 } } });
        player.attach(bob);
        expect(player.getSnapshot()).toMatchObject({ library: "loading", folder: "/home/bob/Music" });
        await settle();
        expect(audio.src).toBe("did:bns:bob/nfs/v1/read/home/bob/Music/2.mp3");
        expect(audio.paused).toBe(true);
        expect(player.getSnapshot()).toMatchObject({ library: "ready", track: library[1], index: 1, count: 3, playing: false, position: 42 });
        // The element is at its start until its metadata is in.
        audio.tell("timeupdate");
        expect(player.getSnapshot().position).toBe(42);
        audio.ready();
        expect(audio.currentTime).toBe(42);
        expect(player.getSnapshot()).toMatchObject({ position: 42, duration: 200 });
    });

    it("plays on to the next track, and from the top after the last", async () => {
        const { audio, player, playback } = setup();
        player.attach(bob);
        await settle();
        player.toggle();
        audio.ready();
        expect(player.getSnapshot()).toMatchObject({ playing: true, index: 0 });
        audio.tell("ended");
        await settle();
        audio.ready();
        expect(audio.src).toContain("2.mp3");
        expect(player.getSnapshot()).toMatchObject({ playing: true, index: 1, position: 0 });
        expect(playback.get("did:bns:bob|bob")).toMatchObject({ track: library[1], position: 0 });
        player.next();
        await settle();
        audio.ready();
        audio.tell("ended");
        await settle();
        expect(audio.src).toContain("1.mp3");
        expect(audio.paused).toBe(false);
    });

    it("starts a track over before it goes back, and goes back without playing when paused", async () => {
        const { audio, player } = setup();
        player.attach(bob);
        await settle();
        player.next();
        await settle();
        audio.ready();
        audio.at(10);
        player.previous();
        expect(player.getSnapshot()).toMatchObject({ index: 1, position: 0 });
        audio.at(1);
        player.previous();
        await settle();
        expect(player.getSnapshot().index).toBe(0);
        expect(audio.paused).toBe(true);
    });

    it("keeps the position while playing, on pause and on seeking", async () => {
        const { audio, player, playback, clock } = setup();
        const saved = () => playback.get("did:bns:bob|bob")?.position;
        player.attach(bob);
        await settle();
        player.toggle();
        audio.ready();
        clock.now += 1000;
        audio.at(3);
        expect(saved()).toBe(0);
        clock.now += 6000;
        audio.at(8);
        expect(saved()).toBe(8);
        audio.at(9);
        player.toggle();
        expect(saved()).toBe(9);
        player.seek(100);
        expect([saved(), audio.currentTime]).toEqual([100, 100]);
    });

    it("shuffles without leaving the track that plays", async () => {
        const { audio, player, settings } = setup({ tracks: Array.from({ length: 30 }, (_, index) => `/home/bob/Music/${index}.mp3`) });
        player.attach(bob);
        await settle();
        player.toggle();
        audio.ready();
        player.toggleOrder();
        expect(player.getSnapshot()).toMatchObject({ order: "shuffle", track: "/home/bob/Music/0.mp3", playing: true });
        expect(settings.get("did:bns:bob|bob")?.order).toBe("shuffle");
        player.toggleOrder();
        expect(player.getSnapshot()).toMatchObject({ order: "sequential", index: 0 });
    });

    it("stops for another Zone and shows that one's folder", async () => {
        const { audio, player, playback, zoneOf } = setup({
            settings: { "did:bns:bob|bob": { folder: "/home/bob/Music", order: "sequential" }, "did:bns:alice|bob": { folder: "/home/bob/Songs", order: "shuffle" } },
        });
        player.attach(bob);
        await settle();
        player.toggle();
        audio.ready();
        audio.at(20);
        player.attach({ ...bob, did: "did:bns:alice", host: "alice.example" });
        expect(audio.paused).toBe(true);
        expect(audio.src).toBe("");
        expect(playback.get("did:bns:bob|bob")?.position).toBe(20);
        expect(player.getSnapshot()).toMatchObject({ zone: "did:bns:alice", folder: "/home/bob/Songs", order: "shuffle", playing: false, track: null });
        await settle();
        expect(zoneOf.at(-1)).toBe("did:bns:alice");
        expect(audio.paused).toBe(true);
        player.attach(null);
        expect(player.getSnapshot()).toMatchObject({ zone: null, folder: "", library: "none" });
    });

    it("drops an answer for a Zone it has left", async () => {
        const { audio, player, state } = setup();
        let answer: (path: string) => void = () => undefined;
        state.read = () => new Promise((resolve) => (answer = resolve));
        player.attach(bob);
        await settle();
        player.attach(null);
        answer("/nfs/v1/read/late");
        await settle();
        expect(audio.src).toBe("");
    });

    it("pauses when the session is not signed in, and keeps what it knows", async () => {
        const { audio, player, tracks } = setup();
        player.attach(bob);
        await settle();
        player.toggle();
        audio.ready();
        audio.at(30);
        player.attach({ ...bob, ready: false, user: null });
        expect(audio.paused).toBe(true);
        expect(player.getSnapshot()).toMatchObject({ ready: false, playing: false, library: "ready", track: library[0], position: 30 });
        player.toggle();
        expect(audio.paused).toBe(true);
        player.attach(bob);
        expect(player.getSnapshot()).toMatchObject({ ready: true, playing: false });
        expect(tracks).toHaveBeenCalledTimes(1);
        player.toggle();
        expect(audio.paused).toBe(false);
        expect(audio.currentTime).toBe(30);
    });

    it("lists a folder that could not be listed again when the session is back", async () => {
        const { player, state, tracks } = setup({ tracks: new TypeError("offline") });
        player.attach(bob);
        await settle();
        expect(player.getSnapshot().library).toBe("unavailable");
        state.tracks = library;
        player.attach({ ...bob, ready: false });
        player.attach(bob);
        await settle();
        expect(player.getSnapshot()).toMatchObject({ library: "ready", track: library[0] });
        expect(tracks).toHaveBeenCalledTimes(2);
    });

    it("does not look for the folder before the session is signed in", async () => {
        const { player, tracks } = setup();
        player.attach({ ...bob, ready: false });
        await settle();
        expect(tracks).not.toHaveBeenCalled();
        expect(player.getSnapshot().folder).toBe("/home/bob/Music");
        player.attach(bob);
        await settle();
        expect(player.getSnapshot().library).toBe("ready");
    });

    it("stays on a track the Zone did not answer for, and asks again on play", async () => {
        const { audio, player, state } = setup();
        const read = state.read;
        player.attach(bob);
        await settle();
        player.toggle();
        audio.ready();
        audio.at(50);
        state.read = () => Promise.reject(new TypeError("offline"));
        audio.tell("error");
        await settle();
        expect(player.getSnapshot()).toMatchObject({ track: library[0], position: 50, playing: false, unreachable: true });
        state.read = read;
        player.toggle();
        await settle();
        audio.ready();
        expect(player.getSnapshot()).toMatchObject({ track: library[0], position: 50, playing: true, unreachable: false });
        expect(audio.currentTime).toBe(50);
    });

    it("asks again once for a source that stopped, then goes on", async () => {
        const { audio, player } = setup();
        player.attach(bob);
        await settle();
        player.toggle();
        audio.ready();
        audio.at(50);
        audio.tell("error");
        await settle();
        expect(player.getSnapshot().index).toBe(0);
        audio.ready();
        expect(audio.currentTime).toBe(50);
        audio.tell("error");
        await settle();
        expect(player.getSnapshot().index).toBe(1);
        expect(audio.paused).toBe(false);
    });

    it("gives a folder up in which nothing can be read", async () => {
        const { player, state } = setup();
        state.read = () => Promise.reject(new NfspError({ code: "NOT_FOUND", message: "gone" }, 404));
        player.attach(bob);
        for (let round = 0; round < 10; round += 1) await settle();
        expect(player.getSnapshot()).toMatchObject({ failed: true, playing: false });
    });

    it("plays a folder that was just chosen, and nothing after it was cleared", async () => {
        const { audio, player, settings } = setup({ settings: {} });
        player.attach(bob);
        expect(player.getSnapshot().library).toBe("none");
        player.choose("/home/bob/Music");
        await settle();
        expect(audio.paused).toBe(false);
        expect(settings.get("did:bns:bob|bob")?.folder).toBe("/home/bob/Music");
        player.choose("");
        expect(audio.paused).toBe(true);
        expect(player.getSnapshot()).toMatchObject({ library: "none", track: null, folder: "", playing: false });
        expect(settings.get("did:bns:bob|bob")?.folder).toBe("");
    });

    it("is pressed while a track's address is on its way", async () => {
        const { audio, player, state } = setup();
        const answers: ((path: string) => void)[] = [];
        state.read = () => new Promise((resolve) => answers.push(resolve));
        player.attach(bob);
        await settle();
        player.toggle();
        player.toggle();
        answers[0]("/nfs/v1/read/1");
        await settle();
        expect(audio.paused).toBe(true);
        player.next();
        player.toggle();
        answers[1]("/nfs/v1/read/2");
        await settle();
        expect(audio.paused).toBe(false);
    });
});
