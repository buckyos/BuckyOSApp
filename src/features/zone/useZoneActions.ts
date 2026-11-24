import React from "react";
import { askConfirm } from "../../components/ui/confirm";
import { useI18n } from "../../i18n";
import { readEndingAudio, type EndingAudio } from "../content/audioLeave";
import { clientRuntime } from "../content/clientRuntime";
import { musicPlayer } from "../music/player";
import { reconnectZone, logoutZone, removeZone } from "./api";
import { zoneTitle, type ZoneView } from "./types";
import { useZones } from "./ZoneContext";

type Translate = (key: string, params?: Record<string, string | number | boolean>) => string;

/** Whether to leave a Zone although something of it plays or records. */
async function mayEndAudio(ending: EndingAudio | null, from: ZoneView, t: Translate): Promise<boolean> {
    const music = musicPlayer.getSnapshot();
    const playing = [...(music.playing && music.zone === from.did ? [t("music.title")] : []), ...(ending?.playing ?? [])];
    const recording = ending?.recording;
    const lines = [
        ...(playing.length > 0 ? [t("zones.leave_playing", { apps: playing.join(", ") })] : []),
        ...(recording ? [t("zones.leave_recording", { app: recording })] : []),
    ];
    if (lines.length === 0) return true;
    return askConfirm({
        title: t("zones.leave_title", { zone: zoneTitle(from) }),
        message: lines.join("\n"),
        confirmText: t("zones.leave_confirm"),
    });
}

/** What can be done with a Zone from any page. Every function names its Zone. */
export function useZoneActions() {
    const { t } = useI18n();
    const { zones, current, select } = useZones();
    const [busy, setBusy] = React.useState<string | null>(null);
    const latest = React.useRef({ zones, current, t });
    latest.current = { zones, current, t };

    const run = React.useCallback(async <T,>(zone: string, work: () => Promise<T>): Promise<T | undefined> => {
        setBusy(zone);
        try {
            return await work();
        } finally {
            setBusy((value) => (value === zone ? null : value));
        }
    }, []);

    /**
     * Makes a Zone the current one. On the desktop the other Zone's windows stay; a phone shows one
     * Zone at a time, so the other's apps are asked and end first. The other's music stops on both.
     * False when the user stays.
     */
    const switchTo = React.useCallback(
        async (zone: string): Promise<boolean> => {
            const { current: from, zones: list, t: translate } = latest.current;
            if (from?.did === zone) return true;
            if (clientRuntime.formFactor === "mobile" && from) {
                const ending = await readEndingAudio(clientRuntime.getSnapshot().views, from.did);
                if (!(await mayEndAudio(ending, from, translate))) return false;
                clientRuntime.setLeaving(from.did);
                try {
                    if (!(await clientRuntime.closeAll(from.did))) return false;
                    await select(zone);
                } finally {
                    clientRuntime.setLeaving(null);
                }
            } else {
                if (from && !(await mayEndAudio(null, from, translate))) return false;
                await select(zone);
            }
            const target = list.find((candidate) => candidate.did === zone);
            // Chosen by hand: the one thing in the way is asked for right here.
            if (target?.session.state === "need_password") clientRuntime.askSignIn(zone);
            return true;
        },
        [select]
    );

    /** Signs in with what the client has; asks for the password when that is not enough. */
    const signIn = React.useCallback(
        (zone: ZoneView) =>
            run(zone.did, async () => {
                if (zone.session.state === "signed_out") {
                    const after = await reconnectZone(zone.did).catch(() => null);
                    if (after?.session.state === "signed_in" || after?.session.state === "offline") return;
                }
                clientRuntime.askSignIn(zone.did);
            }),
        [run]
    );

    const reconnect = React.useCallback(
        (zone: ZoneView) =>
            run(zone.did, async () => {
                await reconnectZone(zone.did).catch((error) => console.warn("[Zone] reconnecting failed", zone.host, error));
            }),
        [run]
    );

    /** Closes the Zone's windows, then signs out. False when a window stays open. */
    const signOut = React.useCallback(
        (zone: ZoneView) =>
            run(zone.did, async () => {
                if (!(await clientRuntime.closeAll(zone.did, "logout"))) return false;
                await logoutZone(zone.did);
                return true;
            }),
        [run]
    );

    const remove = React.useCallback(
        (zone: ZoneView) =>
            run(zone.did, async () => {
                if (!(await clientRuntime.closeAll(zone.did, "logout"))) return false;
                await removeZone(zone.did);
                return true;
            }),
        [run]
    );

    return { busy, switchTo, signIn, reconnect, signOut, remove };
}
