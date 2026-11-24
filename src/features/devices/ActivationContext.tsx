import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { isIosShell, isMobileShell } from "../../utils/platform";
import { openEmbeddedPage } from "../../utils/webview";
import { useDidContext } from "../did/DidContext";
import { reconnectZone } from "../zone/api";
import { useZoneActions } from "../zone/useZoneActions";
import { useZones } from "../zone/ZoneContext";
import { ACTIVATION_POLL_MS, activatedZone, activationOver, type ActivationSession } from "./activation";
import { ACTIVATION_CLOSED_EVENT, closeActivationPage, openActivationPage } from "./activationApi";

/** Where a phone shows the page. */
export const ACTIVATION_PATH = "/activation";
const PAGE_PATHS = [ACTIVATION_PATH, "/web-container"];

/** A Zone that was just activated may still be starting. */
const CONNECT_TRIES = 36;

interface ActivationContextValue {
    /** Opens a device's activation page and takes over the Zone it makes. */
    openActivation: (page: { url: string; title: string }) => Promise<void>;
    /** The page a phone shows. */
    page: { id: string; title: string } | null;
    /** The Zone an open activation page made; shown until the user is back on Home. */
    finished: string | null;
    /** To Home, from the activation page. */
    leave: () => void;
}

const ActivationContext = React.createContext<ActivationContextValue | undefined>(undefined);

async function connect(zone: string): Promise<void> {
    for (let attempt = 0; attempt < CONNECT_TRIES; attempt += 1) {
        const view = await reconnectZone(zone).catch(() => null);
        if (view && view.session.state !== "offline" && view.session.state !== "signing_in") return;
        await new Promise((resolve) => window.setTimeout(resolve, ACTIVATION_POLL_MS));
    }
}

export const ActivationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const { zones, syncOwner } = useZones();
    const { switchTo } = useZoneActions();
    const navigate = useNavigate();
    const location = useLocation();
    const [session, setSession] = React.useState<ActivationSession | null>(null);
    const [finished, setFinished] = React.useState<string | null>(null);
    const [page, setPage] = React.useState<{ id: string; title: string } | null>(null);
    const pageNow = React.useRef(page);
    pageNow.current = page;
    const identity = useDidContext().activeDid?.id;
    const zonesNow = React.useRef(zones);
    zonesNow.current = zones;

    const openActivation = React.useCallback(
        async (target: { url: string; title: string }) => {
            setFinished(null);
            const opened: ActivationSession = { startedAt: Date.now(), before: new Set(zonesNow.current.map((zone) => zone.did)), closedAt: null };
            // Another page while one is being waited for: what counts as new stays what it was.
            setSession((previous) => ({ ...opened, before: previous?.before ?? opened.before }));
            if (isIosShell()) {
                openEmbeddedPage(target.url, target.title);
                return;
            }
            const { id } = await openActivationPage(target.url, target.title);
            if (!isMobileShell()) return;
            setPage({ id, title: target.title });
            navigate(ACTIVATION_PATH);
        },
        [navigate]
    );

    const closed = React.useCallback(() => {
        setSession((current) => (current && current.closedAt === null ? { ...current, closedAt: Date.now() } : current));
    }, []);
    React.useEffect(() => {
        const listening = listen<{ id: string }>(ACTIVATION_CLOSED_EVENT, ({ payload }) => {
            const shown = pageNow.current;
            // A phone's earlier page, which the one just opened replaced.
            if (isMobileShell() && shown?.id !== payload.id) return;
            closed();
            // Its renderer ended, or the identity was switched: this page has nothing to show.
            if (shown) setPage(null);
        });
        return () => void listening.then((stop) => stop()).catch(() => undefined);
    }, [closed]);

    // It was this identity's to activate.
    React.useEffect(() => {
        return () => {
            setSession(null);
            setFinished(null);
        };
    }, [identity]);

    // The owner document says when it worked.
    React.useEffect(() => {
        if (!session) return;
        let stopped = false;
        let timer: number | undefined;
        const tick = async () => {
            await syncOwner().catch((error) => console.warn("[Activation] reading the owner document failed", error));
            if (stopped) return;
            if (activationOver(session, Date.now())) setSession(null);
            else timer = window.setTimeout(() => void tick(), ACTIVATION_POLL_MS);
        };
        timer = window.setTimeout(() => void tick(), session.closedAt === null ? ACTIVATION_POLL_MS : 0);
        return () => {
            stopped = true;
            window.clearTimeout(timer);
        };
    }, [session, syncOwner]);

    React.useEffect(() => {
        const zone = session && activatedZone(session, zones);
        if (!zone) return;
        setSession(null);
        setFinished(zone);
        void switchTo(zone).then(() => connect(zone));
    }, [session, zones, switchTo]);

    const leave = React.useCallback(() => {
        setFinished(null);
        navigate("/main/home", { replace: true });
    }, [navigate]);

    // A phone shows the activation page in this window: it stays until the user leaves it.
    const onPage = PAGE_PATHS.includes(location.pathname);
    const wasOnPage = React.useRef(false);
    React.useEffect(() => {
        if (wasOnPage.current && !onPage) {
            closed();
            setPage((shown) => {
                if (shown) closeActivationPage(shown.id).catch((error) => console.warn("[Activation] closing failed", error));
                return null;
            });
        }
        wasOnPage.current = onPage;
    }, [onPage, closed]);
    React.useEffect(() => {
        if (finished && !onPage) leave();
    }, [finished, onPage, leave]);

    const value = React.useMemo(() => ({ openActivation, page, finished, leave }), [openActivation, page, finished, leave]);
    return <ActivationContext.Provider value={value}>{children}</ActivationContext.Provider>;
};

/** Undefined in the small windows, which show activation pages but do not run the client. */
export function useActivation(): ActivationContextValue | undefined {
    return React.useContext(ActivationContext);
}
