// The music of the Zone on screen: the audio files of one of its folders, in order or shuffled. It
// lives as long as the main window, above the pages, so it goes on while another tab is shown and
// while the window is hidden. It belongs to one Zone and one user of it at a time: switching stops
// it, and it comes back paused where it was. Ported from the Shell's music widget.
import { NfspError } from "buckyos/nfsp";
import { newShuffleSeed, playOrder, resumePoint, trackAlbum, trackTitle, type PlayOrder } from "@buckyos-desktop/music/playlist.ts";
import { ZoneFolders } from "@buckyos-desktop/music/zoneFolders.ts";
import { zoneChannel } from "../zone/channel";
import { mediaUrl } from "./mediaUrl";
import { deviceStore, type MusicSettings, type MusicStore } from "./store";

/** How often a playing track's position is saved, besides on pause, track change and page close. */
const SAVE_INTERVAL_MS = 5000;
/** "Previous" past this point starts the track over instead. */
const RESTART_AFTER_S = 3;
/** So many tracks in a row that this device cannot play: the folder is given up. */
const MAX_FAILURES = 20;

export interface MusicZone {
    did: string;
    host: string;
    /** The user of the Zone; null while it is not known. */
    user: string | null;
    /** The session is signed in. */
    ready: boolean;
}

export type MusicLibrary = "none" | "loading" | "ready" | "unavailable";

export interface MusicSnapshot {
    /** The Zone this is about; null without one, or while its user is not known. */
    zone: string | null;
    ready: boolean;
    folder: string;
    order: PlayOrder;
    library: MusicLibrary;
    count: number;
    /** Of the current track in the order; -1 without one. */
    index: number;
    track: string | null;
    playing: boolean;
    position: number;
    duration: number;
    /** Nothing in the folder plays on this device. */
    failed: boolean;
    /** The Zone did not answer when the track was asked for. */
    unreachable: boolean;
}

type AudioElement = Pick<HTMLAudioElement, "src" | "currentTime" | "duration" | "paused" | "preload" | "play" | "pause" | "load" | "removeAttribute" | "addEventListener">;

export interface MusicPlayerOptions {
    audio: () => AudioElement;
    folders: (zone: { did: string; host: string }) => Pick<ZoneFolders, "tracks" | "readPath">;
    store: MusicStore;
    url: (zone: string, path: string) => string;
    mediaSession: () => MediaSession | null;
    now?: () => number;
}

const NOTHING: MusicSnapshot = {
    zone: null,
    ready: false,
    folder: "",
    order: "sequential",
    library: "none",
    count: 0,
    index: -1,
    track: null,
    playing: false,
    position: 0,
    duration: 0,
    failed: false,
    unreachable: false,
};

export class MusicPlayer {
    private snapshot = NOTHING;
    private listeners = new Set<() => void>();
    private element: AudioElement | null = null;
    private zone: MusicZone | null = null;
    /** Of the stored settings: the Zone and its user. */
    private key = "";
    private settings: MusicSettings = { folder: "", order: "sequential" };
    private tracks: string[] = [];
    private queue: string[] = [];
    private seed = 1;
    private listing: AbortController | null = null;
    /** Counts what was opened; an answer for an earlier one is void. */
    private opening = 0;
    /** The address of the current track is being asked for. */
    private resolving = false;
    /** Which of them the element's source is of. */
    private sourceOf = -1;
    /** Play once the track's source is in: the user asked, or the previous one ended. */
    private playWhenLoaded = false;
    /** Seconds to seek to once the track's metadata is in. */
    private pendingSeek = 0;
    private failures = 0;
    private retried = false;
    private savedAt = 0;

    constructor(private options: MusicPlayerOptions) {}

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    getSnapshot = (): MusicSnapshot => this.snapshot;

    private set(patch: Partial<MusicSnapshot>) {
        const next = { ...this.snapshot, ...patch };
        if ((Object.keys(next) as (keyof MusicSnapshot)[]).every((name) => next[name] === this.snapshot[name])) return;
        this.snapshot = next;
        this.listeners.forEach((listener) => listener());
    }

    private now(): number {
        return (this.options.now ?? Date.now)();
    }

    private audio(): AudioElement {
        if (this.element) return this.element;
        const audio = this.options.audio();
        this.element = audio;
        audio.preload = "metadata";
        audio.addEventListener("play", () => {
            this.set({ playing: true });
            this.announceState();
        });
        audio.addEventListener("pause", () => {
            this.set({ playing: false });
            this.announceState();
            this.save();
        });
        audio.addEventListener("loadedmetadata", () => {
            if (!this.loaded()) return;
            const seek = this.pendingSeek < audio.duration ? this.pendingSeek : 0;
            this.pendingSeek = 0;
            if (seek > 0) audio.currentTime = seek;
            this.set({ duration: Number.isFinite(audio.duration) ? audio.duration : 0, position: seek });
            // The client may be ended without being told: the new track is kept now.
            this.save();
        });
        audio.addEventListener("playing", () => {
            this.failures = 0;
            this.set({ failed: false, unreachable: false });
        });
        audio.addEventListener("timeupdate", () => {
            // Until it is at the place it resumes from, the position shown is that place.
            if (!this.loaded() || this.pendingSeek > 0) return;
            this.set({ position: audio.currentTime });
            if (!audio.paused && this.now() - this.savedAt > SAVE_INTERVAL_MS) this.save();
        });
        audio.addEventListener("ended", () => {
            if (this.loaded()) this.advance(true);
        });
        audio.addEventListener("error", () => {
            if (this.loaded()) this.sourceFailed(audio);
        });
        return audio;
    }

    /** The element's source is the current track's. */
    private loaded(): boolean {
        return this.sourceOf === this.opening;
    }

    /** The Zone on screen and its session; null without one. */
    attach(zone: MusicZone | null) {
        // A session being renewed does not know its user for a while.
        const user = zone ? (zone.user ?? (zone.did === this.zone?.did ? this.zone.user : null)) : null;
        const key = zone && user ? `${zone.did}|${user}` : "";
        if (!zone || key !== this.key || zone.host !== this.zone?.host) {
            this.leave();
            if (!zone || !key) return;
            this.key = key;
            this.zone = { ...zone, user };
            this.settings = this.options.store.settings(key);
            this.set({ zone: zone.did, ready: zone.ready, folder: this.settings.folder, order: this.settings.order });
            if (zone.ready && this.settings.folder) void this.load();
            return;
        }
        const was = this.zone;
        this.zone = { ...zone, user };
        if (was.ready === zone.ready) return;
        this.set({ ready: zone.ready });
        if (!zone.ready) {
            this.pause();
        } else if (this.settings.folder && this.snapshot.library !== "ready") {
            void this.load();
        } else {
            this.set({ unreachable: false });
        }
    }

    /** Everything of the Zone stops. */
    private leave() {
        this.save();
        this.listing?.abort();
        this.listing = null;
        this.unload();
        this.key = "";
        this.zone = null;
        this.settings = { folder: "", order: "sequential" };
        this.tracks = [];
        this.queue = [];
        this.playWhenLoaded = false;
        this.pendingSeek = 0;
        this.snapshot = { ...NOTHING };
        this.listeners.forEach((listener) => listener());
        this.announce();
    }

    /** The audio element without a track. */
    private unload() {
        this.opening += 1;
        this.resolving = false;
        this.clearSource();
    }

    private clearSource() {
        const audio = this.element;
        if (!audio) return;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        // Loading anew takes back the event of the pause.
        this.set({ playing: false });
    }

    /** The folder's tracks, and where this device left off in them. Quietly: what the last try said stays until it works. False when it did not. */
    async load(options: { quiet?: boolean } = {}): Promise<boolean> {
        const { zone, key } = this;
        const { folder } = this.settings;
        if (!zone || !folder) return false;
        this.save();
        this.listing?.abort();
        const controller = new AbortController();
        this.listing = controller;
        this.unload();
        this.tracks = [];
        this.queue = [];
        this.set({ library: options.quiet ? this.snapshot.library : "loading", track: null, index: -1, count: 0, failed: false, unreachable: false, position: 0, duration: 0 });
        try {
            const found = await this.options.folders(zone).tracks(folder, controller.signal);
            if (controller.signal.aborted) return true;
            const saved = this.options.store.playback(key);
            this.tracks = found;
            this.seed = saved?.folder === folder ? saved.seed : newShuffleSeed();
            this.queue = playOrder(found, this.settings.order, this.seed);
            const resume = resumePoint(this.queue, saved, folder);
            this.failures = 0;
            this.set({ library: "ready", count: found.length });
            const track = this.queue[resume.index];
            if (track) this.open(track, { play: this.playWhenLoaded, from: resume.position });
            else this.announce();
            return true;
        } catch (error) {
            if (controller.signal.aborted) return true;
            console.warn("[Music] listing the folder failed", zone.host, error);
            this.playWhenLoaded = false;
            this.set({ library: "unavailable" });
            this.announce();
            return false;
        }
    }

    /** The folder to play, at once; empty for none. */
    choose(folder: string) {
        if (!this.key) return;
        this.playWhenLoaded = Boolean(folder);
        this.save();
        this.settings = { ...this.settings, folder };
        this.options.store.saveSettings(this.key, this.settings);
        this.set({ folder });
        if (folder) {
            void this.load();
            return;
        }
        this.listing?.abort();
        this.unload();
        this.tracks = [];
        this.queue = [];
        this.set({ library: "none", track: null, index: -1, count: 0, position: 0, duration: 0, failed: false, unreachable: false });
        this.announce();
    }

    private open(track: string, options: { play: boolean; from?: number; retry?: boolean }) {
        const { zone } = this;
        if (!zone) return;
        const audio = this.audio();
        this.opening += 1;
        const opening = this.opening;
        const from = options.from ?? 0;
        this.resolving = true;
        this.playWhenLoaded = options.play;
        this.pendingSeek = from;
        this.retried = options.retry ?? false;
        this.set({ track, index: this.queue.indexOf(track), position: from, unreachable: false, ...(options.retry ? {} : { duration: 0 }) });
        this.announce();
        this.options
            .folders(zone)
            .readPath(track)
            .then(
                (path) => {
                    if (opening !== this.opening) return;
                    this.resolving = false;
                    this.sourceOf = opening;
                    audio.src = this.options.url(zone.did, path);
                    if (this.playWhenLoaded) this.start();
                },
                (error: unknown) => {
                    if (opening !== this.opening) return;
                    console.info("[Music] reading a track failed", zone.host, error);
                    this.resolving = false;
                    // The previous track's source goes: it must not be played as this one.
                    this.clearSource();
                    if (error instanceof NfspError) {
                        this.skip(this.playWhenLoaded);
                    } else {
                        // No answer says nothing about the track: it is asked for again on play.
                        this.playWhenLoaded = false;
                        this.set({ unreachable: true });
                    }
                }
            );
    }

    private start() {
        this.audio()
            .play()
            .catch((error: unknown) => {
                // A source that failed is told by its event; an interrupted start by the next one.
                console.info("[Music] playing did not start", error);
            });
    }

    /** The element cannot go on with its source. */
    private sourceFailed(audio: AudioElement) {
        const { track } = this.snapshot;
        if (!track) return;
        const play = this.playWhenLoaded || !audio.paused;
        // One that stopped mid-track (an expired address): asked for once more, from where it was.
        if (!this.retried && audio.currentTime > 0) this.open(track, { play, from: audio.currentTime, retry: true });
        else this.skip(play);
    }

    /** On to the next track after one that cannot be read or played. */
    private skip(play: boolean) {
        this.failures += 1;
        if (this.failures >= Math.min(this.queue.length, MAX_FAILURES)) {
            this.unload();
            this.playWhenLoaded = false;
            this.set({ failed: true });
            return;
        }
        this.advance(play);
    }

    private advance(play: boolean) {
        if (this.queue.length === 0) return;
        const { index, order, track } = this.snapshot;
        if (index + 1 < this.queue.length) {
            this.open(this.queue[index + 1], { play });
        } else if (order === "shuffle" && this.queue.length > 1) {
            // Past the last track: a new shuffle, not starting with the one just heard.
            this.seed = newShuffleSeed();
            this.queue = playOrder(this.tracks, order, this.seed);
            this.open(this.queue[0] === track ? this.queue[1] : this.queue[0], { play });
        } else {
            this.open(this.queue[0], { play });
        }
    }

    /** Playing, or about to. */
    private goingOn(): boolean {
        return this.resolving ? this.playWhenLoaded : this.element?.paused === false;
    }

    toggle() {
        const { track, position, ready } = this.snapshot;
        if (!track) return;
        if (this.goingOn()) {
            this.pause();
            return;
        }
        if (!ready) return;
        this.failures = 0;
        this.playWhenLoaded = true;
        if (this.resolving) return;
        if (this.loaded()) this.start();
        else this.open(track, { play: true, from: position });
    }

    pause() {
        this.playWhenLoaded = false;
        this.element?.pause();
    }

    next() {
        this.failures = 0;
        this.advance(this.goingOn());
    }

    previous() {
        if (this.queue.length === 0) return;
        if ((this.loaded() && this.audio().currentTime > RESTART_AFTER_S) || this.queue.length === 1) {
            this.seek(0);
            return;
        }
        this.failures = 0;
        const { index } = this.snapshot;
        this.open(this.queue[(index - 1 + this.queue.length) % this.queue.length], { play: this.goingOn() });
    }

    seek(position: number) {
        if (!this.snapshot.track || !this.loaded()) return;
        this.audio().currentTime = position;
        this.set({ position });
        this.save();
    }

    toggleOrder() {
        if (!this.key) return;
        const order: PlayOrder = this.settings.order === "shuffle" ? "sequential" : "shuffle";
        if (order === "shuffle") this.seed = newShuffleSeed();
        this.settings = { ...this.settings, order };
        this.options.store.saveSettings(this.key, this.settings);
        this.queue = playOrder(this.tracks, order, this.seed);
        const { track } = this.snapshot;
        this.set({ order, index: track ? this.queue.indexOf(track) : -1 });
        this.save();
    }

    /** Where this device is, kept for the next time. */
    save() {
        const { folder } = this.settings;
        const { track } = this.snapshot;
        if (!this.key || !folder || !track) return;
        this.savedAt = this.now();
        const position = this.pendingSeek || (this.loaded() ? this.element?.currentTime : this.snapshot.position) || 0;
        this.options.store.savePlayback(this.key, { folder, track, position, seed: this.seed });
    }

    // ── Lock screen, media keys ──

    private announce() {
        const session = this.options.mediaSession();
        if (!session) return;
        const { track, folder } = this.snapshot;
        const handlers: [MediaSessionAction, () => void][] = [
            ["play", () => this.toggle()],
            ["pause", () => this.pause()],
            ["nexttrack", () => this.next()],
            ["previoustrack", () => this.previous()],
        ];
        for (const [action, handler] of handlers) {
            try {
                session.setActionHandler(action, track ? handler : null);
            } catch {
                // Not on this system.
            }
        }
        session.metadata = track && typeof MediaMetadata !== "undefined" ? new MediaMetadata({ title: trackTitle(track), album: trackAlbum(track, folder) }) : null;
        this.announceState();
    }

    private announceState() {
        const session = this.options.mediaSession();
        if (session) session.playbackState = !this.snapshot.track ? "none" : this.snapshot.playing ? "playing" : "paused";
    }
}

const libraries = new Map<string, ZoneFolders>();

/** The folders of a Zone, with the client's session. */
export function zoneFolders(zone: { did: string; host: string }): ZoneFolders {
    const key = `${zone.did}|${zone.host}`;
    let found = libraries.get(key);
    if (!found) {
        found = new ZoneFolders(zoneChannel(zone));
        libraries.set(key, found);
    }
    return found;
}

export const musicPlayer = new MusicPlayer({
    audio: () => {
        const audio = document.createElement("audio");
        audio.dataset.testid = "music-audio";
        document.body.append(audio);
        return audio;
    },
    folders: zoneFolders,
    store: deviceStore,
    url: mediaUrl,
    mediaSession: () => ("mediaSession" in navigator ? navigator.mediaSession : null),
});
