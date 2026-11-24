import React from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Empty, Spinner } from "../../components/ui/States";
import { useStage } from "../../features/container/stage";
import { ViewCover } from "../../features/container/ViewCover";
import { clientRuntime } from "../../features/content/clientRuntime";
import { hideViews, type MobileView } from "../../features/content/mobileViews";
import { tabViewId, type PhoneTab } from "../../features/content/phoneTabs";
import { useRuntime } from "../../features/content/useRuntime";
import { SessionNotice } from "../../features/zone/SessionNotice";
import { useZones } from "../../features/zone/ZoneContext";
import type { ZoneView } from "../../features/zone/types";
import { useI18n } from "../../i18n";
import "../../features/container/container.css";

/** A tab of the navigation that shows one of the Zone's pages. `top` is above it. */
export const PhoneTabPage: React.FC<{ tab: PhoneTab; top?: React.ReactNode }> = ({ tab, top }) => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { current } = useZones();
    return (
        <div className="phone-tab" data-testid={`tab-${tab}`}>
            {top ?? <div className="phone-strip" />}
            {current ? (
                <ZoneTab key={`${current.did}|${tab}`} zone={current} tab={tab} />
            ) : (
                <div className="phone-message">
                    <Empty icon={<MessageCircle size={26} strokeWidth={1.6} />} title={t("zones.none")} text={t(`phone.no_zone_${tab}`)}>
                        <Button onClick={() => navigate("/main/home")}>{t("zones.to_home")}</Button>
                    </Empty>
                </div>
            )}
        </div>
    );
};

const ZoneTab: React.FC<{ zone: ZoneView; tab: PhoneTab }> = ({ zone, tab }) => {
    const { t } = useI18n();
    const { views, front, leaving } = useRuntime();
    const id = tabViewId(zone.did, tab);
    const view = views.find((candidate) => candidate.id === id) as MobileView | undefined;
    const ready = zone.session.state === "signed_in";
    const [failed, setFailed] = React.useState(false);
    const stageRef = React.useRef<HTMLDivElement | null>(null);
    const alive = React.useRef(true);
    const opening = React.useRef(false);
    // An app in front covers this page; its view has the stage.
    useStage(stageRef, view && !front ? view.id : null);

    React.useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);

    const open = React.useCallback(async () => {
        if (opening.current) return;
        opening.current = true;
        setFailed(false);
        const opened = await clientRuntime.openTab(zone.did, tab, id);
        opening.current = false;
        if (!alive.current) {
            // Left while it opened: it stays open, behind the page that is shown now.
            if (opened && !document.documentElement.hasAttribute("data-content-view")) {
                await hideViews().catch(() => undefined);
            }
            return;
        }
        if (!opened) setFailed(true);
    }, [zone.did, tab, id]);

    const missing = ready && !view && !front && leaving !== zone.did;
    React.useEffect(() => {
        if (missing && !failed) void open();
    }, [missing, failed, open]);

    if (view) {
        return (
            <div className="phone-stage" ref={stageRef}>
                <ViewCover view={view} />
            </div>
        );
    }
    return (
        <div className="phone-message">
            <SessionNotice zone={zone} />
            {ready ? (
                failed ? (
                    <Empty text={t("open.failure.failed")}>
                        <Button size="sm" onClick={() => void open()}>
                            {t("ui.retry")}
                        </Button>
                    </Empty>
                ) : (
                    <Empty>
                        <Spinner label={t("ui.loading")} />
                    </Empty>
                )
            ) : null}
        </div>
    );
};
