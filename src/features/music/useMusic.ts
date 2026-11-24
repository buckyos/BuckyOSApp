import React from "react";
import type { ZoneView } from "../zone/types";
import { isMobileShell } from "../../utils/platform";
import { createRetry } from "../zone/retry";
import { keepMusicPlaying } from "./background";
import { musicPlayer, type MusicSnapshot } from "./player";

export function useMusic(): MusicSnapshot {
    return React.useSyncExternalStore(musicPlayer.subscribe, musicPlayer.getSnapshot);
}

/** One plain value of it: the position changes several times a second while a track plays. */
export function useMusicValue<T extends string | number | boolean | null>(select: (music: MusicSnapshot) => T): T {
    return React.useSyncExternalStore(musicPlayer.subscribe, () => select(musicPlayer.getSnapshot()));
}

/** One request that did not get through must not stop the music; what is buffered plays on. */
const OFFLINE_GRACE_MS = 20_000;

function useUsable(zone: ZoneView | null): boolean {
    const state = zone?.session.state;
    const did = zone?.did;
    const [lost, setLost] = React.useState(true);
    React.useEffect(() => {
        if (state === "signed_in") {
            setLost(false);
            return;
        }
        if (state !== "offline") {
            setLost(true);
            return;
        }
        const timer = setTimeout(() => setLost(true), OFFLINE_GRACE_MS);
        return () => clearTimeout(timer);
    }, [did, state]);
    return state === "signed_in" || (state === "offline" && !lost);
}

let keptPlaying = false;

/** Keeps the player with the Zone on screen. Once, for as long as the main window lives. */
export function useMusicHost(zone: ZoneView | null) {
    const did = zone?.did;
    const host = zone?.host;
    const user = zone?.session.identity?.user_id ?? null;
    const ready = useUsable(zone);
    React.useEffect(() => {
        musicPlayer.attach(did && host ? { did, host, user, ready } : null);
    }, [did, host, user, ready]);

    React.useEffect(() => {
        if (keptPlaying || !isMobileShell()) return;
        keptPlaying = true;
        keepMusicPlaying(musicPlayer);
    }, []);

    React.useEffect(() => {
        const save = () => musicPlayer.save();
        window.addEventListener("pagehide", save);
        return () => window.removeEventListener("pagehide", save);
    }, []);

    const state = zone?.session.state;
    React.useEffect(() => {
        if (state === "signed_in" && musicPlayer.getSnapshot().library === "unavailable") void musicPlayer.load({ quiet: true });
    }, [state]);

    const library = useMusicValue((music) => music.library);
    React.useEffect(() => {
        if (!ready || library !== "unavailable") return;
        const retry = createRetry(() => {
            void musicPlayer.load({ quiet: true }).then((done) => {
                if (!done) retry.failed();
            });
        });
        retry.failed();
        return () => retry.stop();
    }, [ready, library]);
}
