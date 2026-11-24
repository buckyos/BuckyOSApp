import React from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronsUpDown, Plus, SlidersHorizontal } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { Dot, StateText } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { useBack } from "../content/useOverlay";
import { useDidContext } from "../did/DidContext";
import { getIdentityAvatar, getIdentityDid, getIdentityDisplayName } from "../did/identityView";
import { avatarDisplayUrl } from "../did/ownerDocument";
import { sessionLabelKey, sessionTone } from "./sessionView";
import { zoneTitle } from "./types";
import { useZoneActions } from "./useZoneActions";
import { useZones } from "./ZoneContext";
import { ZoneMark } from "./ZoneMark";
import "./zones.css";

/** Who is signed in and the Zone on screen; opens the list of Zones to switch to. */
export const AccountArea: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { activeDid } = useDidContext();
    const { zones, current } = useZones();
    const { switchTo } = useZoneActions();
    const [open, setOpen] = React.useState(false);
    const areaRef = React.useRef<HTMLDivElement | null>(null);
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);
    const name = getIdentityDisplayName(activeDid) || t("common.account.unnamed");

    useBack(open, () => setOpen(false));
    React.useEffect(() => {
        if (!open) return;
        const outside = (event: Event) => {
            if (!areaRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setOpen(false);
            buttonRef.current?.focus();
        };
        document.addEventListener("pointerdown", outside);
        window.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", outside);
            window.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const go = (path: string) => {
        setOpen(false);
        navigate(path);
    };

    return (
        <div className="account-area" ref={areaRef}>
            <button
                ref={buttonRef}
                type="button"
                className="account-button"
                aria-expanded={open}
                aria-haspopup="menu"
                aria-label={t("zones.switcher_label", { name, zone: current ? zoneTitle(current) : t("zones.none") })}
                onClick={() => setOpen((value) => !value)}
                data-testid="account-area"
            >
                <Avatar src={avatarDisplayUrl(getIdentityAvatar(activeDid))} name={name} id={getIdentityDid(activeDid)} size={40} />
                <span className="account-text">
                    <span className="account-name">{name}</span>
                    {current ? (
                        <span className="account-zone">
                            <Dot color="var(--zone-mark)" />
                            <span className="account-zone-name">{zoneTitle(current)}</span>
                            <span className="account-zone-state">{t(sessionLabelKey(current))}</span>
                        </span>
                    ) : (
                        <span className="account-zone">{t("zones.none")}</span>
                    )}
                </span>
                <ChevronsUpDown size={16} aria-hidden="true" />
            </button>
            {open ? (
                <div className="zone-menu" role="menu" aria-label={t("zones.title")} data-testid="zone-menu">
                    {zones.length > 0 ? (
                        <div className="zone-menu-list ui-scroll">
                            {zones.map((zone) => (
                                <button
                                    key={zone.did}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={zone.did === current?.did}
                                    className="zone-menu-item"
                                    data-zone={zone.did}
                                    onClick={() => {
                                        setOpen(false);
                                        void switchTo(zone.did).catch((error) => console.error("[Zone] switching failed", error));
                                    }}
                                >
                                    <ZoneMark zone={zone} size={28} />
                                    <span className="ui-row-text">
                                        <span className="ui-row-title">{zoneTitle(zone)}</span>
                                        <StateText tone={sessionTone(zone)}>{t(sessionLabelKey(zone))}</StateText>
                                    </span>
                                    {zone.did === current?.did ? <Check size={16} aria-hidden="true" /> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <div className="zone-menu-actions">
                        <button type="button" role="menuitem" className="ui-menu-item" onClick={() => go("/main/setting/zones/add")}>
                            <Plus size={16} aria-hidden="true" />
                            {t("zones.add")}
                        </button>
                        {zones.length > 0 ? (
                            <button type="button" role="menuitem" className="ui-menu-item" onClick={() => go("/main/setting/zones")}>
                                <SlidersHorizontal size={16} aria-hidden="true" />
                                {t("zones.manage")}
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
};
