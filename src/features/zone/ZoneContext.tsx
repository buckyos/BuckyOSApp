import React from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readDesktopState } from "@buckyos-desktop/controlPanel/desktopState.ts";
import { normalizeAccent } from "@buckyos-desktop/appearance/accent.ts";
import { APPEARANCE_STATE_KEY } from "@buckyos-desktop/appearance/model.ts";
import { useDidContext } from "../did/DidContext";
import { getIdentityDid } from "../did/identityView";
import { resolveOwnerZones } from "./ownerZones";
import * as api from "./api";
import { zoneChannel } from "./channel";
import { onLineBack } from "./lineEvents";
import type { SessionStatus, ZoneList, ZoneView } from "./types";

interface ZoneContextValue {
    account: string | null;
    zones: ZoneView[];
    /** The Zone the local pages show; never an implied argument of a request. */
    current: ZoneView | null;
    loading: boolean;
    select: (zone: string) => Promise<void>;
    /** Reads the owner document's Zone list again. */
    syncOwner: () => Promise<void>;
}

const EMPTY: ZoneList = { account: null, zones: [], current: null };
const ZoneContext = React.createContext<ZoneContextValue | undefined>(undefined);

export const ZoneProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const { activeDid } = useDidContext();
    const [list, setList] = React.useState<ZoneList>(EMPTY);
    const [loading, setLoading] = React.useState(true);
    const ownerDid = getIdentityDid(activeDid);

    React.useEffect(() => {
        let stopped = false;
        const unlisten: UnlistenFn[] = [];
        const keep = (promise: Promise<UnlistenFn>) => {
            void promise.then((stop) => (stopped ? stop() : unlisten.push(stop)));
        };
        keep(listen<ZoneList>(api.ZONES_CHANGED_EVENT, (event) => setList(event.payload)));
        keep(
            listen<{ account: string; zone: string; session: SessionStatus }>(api.SESSION_CHANGED_EVENT, ({ payload }) => {
                setList((previous) =>
                    previous.account !== payload.account
                        ? previous
                        : {
                            ...previous,
                            zones: previous.zones.map((zone) =>
                                zone.did === payload.zone ? { ...zone, session: payload.session } : zone
                            ),
                        }
                );
            })
        );
        keep(
            listen<api.LineChanged>(api.LINE_CHANGED_EVENT, ({ payload }) => {
                setList((previous) => ({
                    ...previous,
                    zones: previous.zones.map((zone) => (zone.host === payload.host ? { ...zone, line: payload.line } : zone)),
                }));
            })
        );
        return () => {
            stopped = true;
            unlisten.forEach((stop) => stop());
        };
    }, []);

    React.useEffect(() => {
        let stopped = false;
        setLoading(true);
        api.listZones()
            .then((next) => {
                if (!stopped) setList(next);
            })
            .catch((error) => console.error("[Zone] reading the list failed", error))
            .finally(() => {
                if (!stopped) setLoading(false);
            });
        return () => {
            stopped = true;
        };
    }, [activeDid?.id]);

    const ownerNow = React.useRef(ownerDid);
    ownerNow.current = ownerDid;
    const syncOwner = React.useCallback(async () => {
        if (!ownerDid) return;
        const zones = await resolveOwnerZones(ownerDid);
        // Null: the owner document could not be read; the list stays as it is.
        if (!zones || ownerNow.current !== ownerDid) return;
        const next = await api.syncOwnerZones(ownerDid, zones);
        if (ownerNow.current === ownerDid) setList(next);
    }, [ownerDid]);

    React.useEffect(() => {
        if (!ownerDid) return;
        const run = () => {
            syncOwner().catch((error) => console.warn("[Zone] syncing the owner's Zones failed", error));
        };
        run();
        window.addEventListener("online", run);
        const stopLine = onLineBack(run);
        return () => {
            stopLine();
            window.removeEventListener("online", run);
        };
    }, [ownerDid, syncOwner]);

    const current = React.useMemo(
        () => list.zones.find((zone) => zone.did === list.current) ?? null,
        [list.zones, list.current]
    );

    // The accent is part of the account's appearance in each Zone.
    const signedIn = list.zones.filter((zone) => zone.session.state === "signed_in");
    const accentKey = signedIn.map((zone) => `${zone.did}@${zone.host}`).join(" ");
    React.useEffect(() => {
        let stopped = false;
        for (const zone of signedIn) {
            readDesktopState<{ accent?: unknown }>(zoneChannel(zone), APPEARANCE_STATE_KEY)
                .then(({ value }) => {
                    const accent = normalizeAccent(value?.accent);
                    if (!stopped && accent !== zone.accent) return api.updateZone(zone.did, { accent });
                })
                .catch((error) => console.info("[Zone] no appearance state", zone.host, error));
        }
        return () => {
            stopped = true;
        };
        // The list itself changes with every accent; the Zones signed in to are what matters here.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accentKey]);

    const select = React.useCallback(async (zone: string) => {
        setList(await api.setCurrentZone(zone));
    }, []);

    const value = React.useMemo<ZoneContextValue>(
        () => ({ account: list.account, zones: list.zones, current, loading, select, syncOwner }),
        [list.account, list.zones, current, loading, select, syncOwner]
    );
    return <ZoneContext.Provider value={value}>{children}</ZoneContext.Provider>;
};

export function useZones(): ZoneContextValue {
    const context = React.useContext(ZoneContext);
    if (!context) throw new Error("useZones must be used within a ZoneProvider");
    return context;
}
