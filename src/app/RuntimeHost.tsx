import React from "react";
import { useNavigate } from "react-router-dom";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { Button, IconButton } from "../components/ui/Button";
import { askConfirm, ConfirmHost } from "../components/ui/confirm";
import { Dot } from "../components/ui/States";
import { backInView, backTarget } from "../features/container/back";
import { clientRuntime } from "../features/content/clientRuntime";
import { ChooseAppDialog } from "../features/content/ChooseAppDialog";
import { backStack, setNativeLabels, shareFile, toBackground } from "../features/content/mobileViews";
import { failureText } from "../features/content/openFailure";
import { tabOfView, tabViewId, type PhoneTab } from "../features/content/phoneTabs";
import { useBlock } from "../features/content/useOverlay";
import { useRuntime } from "../features/content/useRuntime";
import { showFeed } from "../features/feed/mobileFeed";
import { useMusicHost } from "../features/music/useMusic";
import { appName, findApp } from "../features/apps/catalog";
import { notifySettings, notifyPermission, setNotifyEnabled, setNotifyLabels } from "../features/notify/api";
import { reconnectZone } from "../features/zone/api";
import { SignInDialog } from "../features/zone/SignInDialog";
import { useZoneActions } from "../features/zone/useZoneActions";
import { useActivation } from "../features/devices/ActivationContext";
import { useDidContext } from "../features/did/DidContext";
import { useZones } from "../features/zone/ZoneContext";
import { zoneTitle } from "../features/zone/types";
import { useI18n } from "../i18n";
import { subscribeTheme } from "../theme";
import { isMobileShell } from "../utils/platform";
import { nativeLabels } from "./phone/nativeLabels";
import { PHONE_PATHS } from "./phone/paths";

const TOAST_MS = 7000;
const RECONNECT_MS = 30_000;
const ASKED_KEY = "buckyos.notify.asked";

export const TAB_PATHS = {
    home: "/main/home",
    apps: "/main/apps",
    activity: "/main/activity",
    settings: "/main/setting",
} as const;

function showWindow() {
    const window = getCurrentWindow();
    void window.show().catch(() => undefined);
    void window.unminimize().catch(() => undefined);
    void window.setFocus().catch(() => undefined);
}

/** Runs the client's runtime for as long as the main window lives, and draws what it asks for. */
export const RuntimeHost: React.FC = () => {
    const { t, locale, contentLocale } = useI18n();
    const navigate = useNavigate();
    const { zones, current } = useZones();
    const { switchTo } = useZoneActions();
    const runtime = useRuntime();

    const zonesNow = React.useRef({ zones, current });
    zonesNow.current = { zones, current };
    const latestT = React.useRef(t);
    latestT.current = t;

    React.useEffect(() => {
        const phone = isMobileShell();
        clientRuntime.setHooks({
            showTab: (tab) => {
                if (!phone) {
                    navigate(TAB_PATHS[tab]);
                    showWindow();
                    return;
                }
                const zone = zonesNow.current.current;
                if (tab === "activity" && zone) showFeed(zone, "activity");
                clientRuntime.minimize();
                navigate(tab === "activity" ? PHONE_PATHS.feed : tab === "settings" ? PHONE_PATHS.settings : PHONE_PATHS.home);
            },
            showTabView: (tab, zoneDid) => {
                const zone = zonesNow.current.zones.find((candidate) => candidate.did === zoneDid);
                if (tab === "homestation" && zone) showFeed(zone, "homestation");
                navigate(tab === "homestation" ? PHONE_PATHS.feed : PHONE_PATHS.messagehub);
            },
            confirmZone: (zoneDid) => {
                const zone = zonesNow.current.zones.find((candidate) => candidate.did === zoneDid);
                const translate = latestT.current;
                if (!zone) return Promise.resolve(false);
                if (!phone) showWindow();
                return askConfirm({
                    title: translate("zones.enter_title", { zone: zoneTitle(zone) }),
                    message: translate("zones.enter_text", { zone: zoneTitle(zone), host: zone.host }),
                    confirmText: translate("zones.enter_confirm"),
                });
            },
            // What leads here (a link, a notification) is not the Zone switch of the account area.
            enterZone: async (zoneDid) => {
                const { current: from } = zonesNow.current;
                if (from?.did === zoneDid) return true;
                const open = clientRuntime.getSnapshot().views.some((view) => view.zone === from?.did && !tabOfView(view.id));
                if (open && !clientRuntime.askedByUser && !(await clientRuntime.askZone(zoneDid))) return false;
                return switchTo(zoneDid);
            },
        });
        return () => clientRuntime.setHooks(null);
    }, [navigate, switchTo]);

    useBackButton();
    useMusicHost(current);

    React.useEffect(() => clientRuntime.setZones(zones), [zones]);
    React.useEffect(() => clientRuntime.setLocale(contentLocale), [contentLocale]);
    React.useEffect(() => subscribeTheme(() => clientRuntime.themeChanged()), []);
    React.useEffect(() => {
        clientRuntime.start().catch((error) => console.error("[Runtime] starting failed", error));
    }, []);

    React.useEffect(() => {
        setNotifyLabels({
            newMessage: t("notify.new_message"),
            many: t("notify.many", { count: "{count}" }),
            taskDone: t("notify.task_done"),
            taskFailed: t("notify.task_failed"),
        }).catch((error) => console.warn("[Notify] labels", error));
        if (isMobileShell()) setNativeLabels(nativeLabels(t)).catch((error) => console.warn("[Native] labels", error));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locale]);

    useFirstPermission(zones.some((zone) => zone.session.state === "signed_in"));
    useReconnect(current?.did, current?.session.state === "offline");

    const signInZone = runtime.signIn ? zones.find((zone) => zone.did === runtime.signIn) : undefined;
    // What the main window has to say or ask may come from a link or a notification while it is hidden.
    const asks = `${runtime.failure?.at ?? ""}|${runtime.signIn ?? ""}`;
    React.useEffect(() => {
        if (asks !== "|" && !isMobileShell()) showWindow();
    }, [asks]);

    const failureZone = runtime.failure?.zone ? zones.find((zone) => zone.did === runtime.failure?.zone) : undefined;
    const failureApp = (() => {
        const { failure } = runtime;
        if (!failure?.app || !failureZone) return failure?.app ?? "";
        const catalog = clientRuntime.open.cachedCatalog(failureZone);
        const entry = catalog && findApp(catalog, failure.app);
        return entry ? appName(entry, contentLocale) : failure.app;
    })();

    return (
        <>
            {signInZone ? <SignInDialog key={signInZone.did} zone={signInZone} onClose={() => clientRuntime.askSignIn(null)} /> : null}
            <ConfirmHost />
            {runtime.choice ? <ChooseAppDialog key={runtime.choice.name} choice={runtime.choice} /> : null}
            <div className="ui-toasts" aria-live="polite">
                {runtime.failure && !(runtime.failure.reason === "need_login" && signInZone) ? (
                    <Toast key={runtime.failure.at} tone="bad" onClose={() => clientRuntime.dismissFailure()}>
                        {failureText(t, runtime.failure, { zone: failureZone ? zoneTitle(failureZone) : "", app: failureApp })}
                    </Toast>
                ) : null}
                {runtime.download ? (
                    <Toast
                        key={runtime.download.at}
                        tone={runtime.download.success ? "ok" : "bad"}
                        onClose={() => clientRuntime.dismissDownload()}
                        action={
                            runtime.download.success && runtime.download.path ? (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        const path = runtime.download?.path;
                                        clientRuntime.dismissDownload();
                                        const show = isMobileShell() ? shareFile : revealItemInDir;
                                        if (path) show(path).catch((error) => console.warn("[Download] showing the file failed", error));
                                    }}
                                >
                                    {t(isMobileShell() ? "open.share_file" : "open.show_file")}
                                </Button>
                            ) : null
                        }
                    >
                        {t(runtime.download.success ? "open.downloaded" : "open.download_failed", { name: runtime.download.name ?? t("open.file") })}
                    </Toast>
                ) : null}
            </div>
        </>
    );
};

const Toast: React.FC<React.PropsWithChildren<{ tone: "ok" | "bad"; onClose: () => void; action?: React.ReactNode }>> = ({
    tone,
    onClose,
    action,
    children,
}) => {
    const { t } = useI18n();
    const close = React.useRef(onClose);
    close.current = onClose;
    const [held, setHeld] = React.useState(false);
    const ref = React.useRef<HTMLDivElement | null>(null);
    useBlock(ref);
    React.useEffect(() => {
        if (held) return;
        const timer = window.setTimeout(() => close.current(), TOAST_MS);
        return () => window.clearTimeout(timer);
    }, [held]);
    return (
        <div ref={ref} className="ui-toast" role="status" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
            <Dot tone={tone} />
            <span className="ui-toast-text">{children}</span>
            {action}
            <IconButton label={t("ui.close")} onClick={onClose}>
                <X size={14} />
            </IconButton>
        </div>
    );
};

/** Back on a phone: what is open closes, then the app, its history, Home, and out. */
function useBackButton() {
    const navigate = useNavigate();
    const { current } = useZones();
    const { activeDid } = useDidContext();
    const activation = useActivation();
    const now = React.useRef<{ back: () => Promise<void>; available: () => boolean }>({ back: async () => undefined, available: () => true });
    // As it is now: a press may come before the last one was rendered.
    const here = () => window.location.hash.replace(/^#/, "").split("?", 1)[0];
    // Without an identity chosen there is only the list of them.
    const targetOf = (pathname: string) => (pathname === "/main/setting/identities" && !activeDid ? "background" : backTarget(pathname));
    now.current.available = () => clientRuntime.getSnapshot().front !== null || targetOf(here()) !== "background";
    now.current.back = async () => {
        const { front, views } = clientRuntime.getSnapshot();
        const pathname = here();
        if (front) {
            if (await backInView(front)) return;
            clientRuntime.minimize();
            navigate(PHONE_PATHS.home);
            return;
        }
        // The view a tab shows right now.
        const tab: PhoneTab | null = pathname === PHONE_PATHS.messagehub ? "messagehub" : pathname === PHONE_PATHS.feed ? "homestation" : null;
        const id = tab && current ? tabViewId(current.did, tab) : null;
        const shown = id && views.find((view) => view.id === id && view.focused);
        if (shown && tabOfView(shown.id) && (await backInView(shown.id))) return;
        if (pathname === "/activation" && activation?.finished) {
            activation.leave();
            return;
        }
        const target = targetOf(pathname);
        if (target === "background") await toBackground();
        else if (target === "history") navigate(-1);
        else navigate(target.to, { replace: true });
    };
    React.useEffect(() => {
        if (!isMobileShell()) return;
        let stopped = false;
        let stop: (() => void) | undefined;
        backStack
            .start(() => now.current.back(), () => now.current.available())
            .then((release) => {
                if (stopped) release();
                else stop = release;
            })
            .catch((error) => console.warn("[Back] not available", error));
        return () => {
            stopped = true;
            stop?.();
        };
    }, []);
}

/** Notifications are on from the start: the system is asked once, when there is a Zone to hear from. */
function useFirstPermission(ready: boolean) {
    React.useEffect(() => {
        if (!ready) return;
        try {
            if (localStorage.getItem(ASKED_KEY)) return;
            localStorage.setItem(ASKED_KEY, "1");
        } catch {
            return;
        }
        void (async () => {
            const { enabled } = await notifySettings();
            if (enabled && (await notifyPermission()) === null) await setNotifyEnabled(true);
        })().catch((error) => console.info("[Notify] asking for the permission failed", error));
    }, [ready]);
}

/** The Zone on screen is tried again while it is out of reach. */
function useReconnect(zone: string | undefined, offline: boolean) {
    React.useEffect(() => {
        if (!zone || !offline) return;
        const attempt = () => {
            if (document.visibilityState === "visible") void reconnectZone(zone).catch(() => undefined);
        };
        const timer = window.setInterval(attempt, RECONNECT_MS);
        window.addEventListener("online", attempt);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("online", attempt);
        };
    }, [zone, offline]);
}
