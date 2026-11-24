import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Ellipsis, Layers, Minus, Search, X } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { Menu, type MenuItem } from "../../components/ui/Menu";
import { Dot } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { findApp } from "../apps/catalog";
import { useCatalog } from "../apps/useCatalog";
import { clientRuntime } from "../content/clientRuntime";
import type { MobileView } from "../content/mobileViews";
import { useBack, useBlock } from "../content/useOverlay";
import { useRuntime } from "../content/useRuntime";
import { useZones } from "../zone/ZoneContext";
import { zoneTitle, type ZoneView } from "../zone/types";
import { AppSwitcher, openApps } from "./AppSwitcher";
import { backInView } from "./back";
import { headerModel, menuImage, type HeaderModel } from "./header";
import { useStage } from "./stage";
import { ViewCover } from "./ViewCover";
import "./container.css";

/** Phone: the app in front, over everything else of the client. */
export const AppContainer: React.FC = () => {
    const { views, front } = useRuntime();
    const { zones } = useZones();
    const view = views.find((candidate) => candidate.id === front) as MobileView | undefined;
    const zone = view && zones.find((candidate) => candidate.did === view.zone);
    return view && zone ? <Container key={view.id} view={view} zone={zone} /> : null;
};

const Container: React.FC<{ view: MobileView; zone: ZoneView }> = ({ view, zone }) => {
    const navigate = useNavigate();
    const { headers } = useRuntime();
    const { zones } = useZones();
    const { catalog } = useCatalog(zone);
    const [switching, setSwitching] = React.useState(false);
    const stageRef = React.useRef<HTMLDivElement | null>(null);
    useStage(stageRef, view.id);

    const model = headerModel(headers[view.id] ?? {}, view, catalog && findApp(catalog, view.appInstance)?.window);
    const minimize = () => {
        clientRuntime.minimize();
        navigate("/main/home");
    };
    const back = async () => {
        if (!(await backInView(view.id))) minimize();
    };
    const parts = {
        model,
        view,
        zoneName: zones.length > 1 ? zoneTitle(zone) : null,
        onBack: () => void back(),
        onMinimize: minimize,
        onSwitch: () => setSwitching(true),
    };

    return (
        <div
            className="app-container"
            data-style={model.style}
            data-testid="app-container"
            style={zone.accent ? ({ "--zone-accent": zone.accent } as React.CSSProperties) : undefined}
        >
            {model.style === "standard" ? <StandardHeader {...parts} /> : <div className="container-strip" />}
            <div className="container-stage" ref={stageRef}>
                <ViewCover view={view} />
                {model.style === "compact" ? <CompactHeader {...parts} /> : null}
            </div>
            <div className="container-foot" />
            <AppSwitcher open={switching} zone={zone} onClose={() => setSwitching(false)} />
        </div>
    );
};

interface HeaderProps {
    model: HeaderModel;
    view: MobileView;
    zoneName: string | null;
    onBack: () => void;
    onMinimize: () => void;
    onSwitch: () => void;
}

const SwitchButton: React.FC<{ view: MobileView; onSwitch: () => void }> = ({ view, onSwitch }) => {
    const { t } = useI18n();
    const { views } = useRuntime();
    const count = openApps(views, view.zone).length;
    return (
        <IconButton label={t("container.switch", { count })} onClick={onSwitch} data-testid="app-switch">
            <Layers size={18} />
        </IconButton>
    );
};

const MoreButton: React.FC<{ model: HeaderModel; view: MobileView }> = ({ model, view }) => {
    const { t } = useI18n();
    const [at, setAt] = React.useState<{ x: number; y: number } | null>(null);
    const items: MenuItem[] = [
        ...model.menu.map((item): MenuItem => {
            const image = menuImage(item.icon);
            return {
                id: `app-${item.id}`,
                label: item.label,
                tone: item.danger ? "danger" : undefined,
                icon: image ? <img src={image} alt="" width={16} height={16} /> : undefined,
                onSelect: () => clientRuntime.frames.headerEvent(view.id, { kind: "menu", id: item.id }),
            };
        }),
        { id: "close", label: t("container.close"), onSelect: () => void clientRuntime.closeView(view.id) },
    ];
    return (
        <>
            <IconButton
                label={t("container.more")}
                aria-haspopup="menu"
                data-testid="app-more"
                onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    setAt({ x: box.right, y: box.bottom + 4 });
                }}
            >
                <Ellipsis size={19} />
            </IconButton>
            <Menu at={at} items={items} label={t("container.more")} onClose={() => setAt(null)} />
        </>
    );
};

/** The header on its own ground, with a second row when the app has one. */
const StandardHeader: React.FC<HeaderProps> = ({ model, view, zoneName, onBack, onMinimize, onSwitch }) => {
    const { t } = useI18n();
    const [searching, setSearching] = React.useState(false);
    const open = searching && model.search !== null;
    return (
        <header className="container-header" data-testid="container-header">
            {open && model.search ? (
                <HeaderSearch key={view.id} view={view} search={model.search} onClose={() => setSearching(false)} />
            ) : (
                <div className="container-bar">
                    {model.back ? (
                        <IconButton label={t("common.back")} onClick={onBack} data-testid="app-back">
                            <ChevronLeft size={22} />
                        </IconButton>
                    ) : (
                        <span className="container-bar-gap" />
                    )}
                    <div className="container-title">
                        <span>{model.title}</span>
                        {zoneName ? (
                            <span className="container-zone">
                                <Dot color="var(--zone-mark)" />
                                <span>{zoneName}</span>
                            </span>
                        ) : null}
                    </div>
                    {model.search ? (
                        <IconButton label={model.search.placeholder || t("container.search")} onClick={() => setSearching(true)} data-testid="app-search">
                            <Search size={18} />
                        </IconButton>
                    ) : null}
                    <SwitchButton view={view} onSwitch={onSwitch} />
                    <div className="container-capsule">
                        <MoreButton model={model} view={view} />
                        <IconButton label={t("container.minimize")} onClick={onMinimize} data-testid="app-minimize">
                            <Minus size={19} />
                        </IconButton>
                    </div>
                </div>
            )}
            {model.secondRow.length > 0 ? (
                <div className="container-second" role="tablist">
                    {model.secondRow.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            role="tab"
                            aria-selected={item.active}
                            onClick={() => clientRuntime.frames.headerEvent(view.id, { kind: "item", id: item.id })}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </header>
    );
};

/** Types into the app: every change goes to it as a header event. */
const HeaderSearch: React.FC<{ view: MobileView; search: { placeholder: string; value: string }; onClose: () => void }> = ({ view, search, onClose }) => {
    const { t } = useI18n();
    const [value, setValue] = React.useState(search.value);
    const change = (next: string) => {
        setValue(next);
        clientRuntime.frames.headerEvent(view.id, { kind: "search", value: next });
    };
    const close = () => {
        if (value) change("");
        onClose();
    };
    useBack(true, close);
    return (
        <div className="container-bar container-searching">
            <div className="ui-search">
                <Search size={15} aria-hidden="true" />
                <input
                    className="ui-input"
                    type="text"
                    role="searchbox"
                    value={value}
                    onChange={(event) => change(event.target.value)}
                    placeholder={search.placeholder || t("container.search")}
                    aria-label={search.placeholder || t("container.search")}
                    enterKeyHint="search"
                    spellCheck={false}
                    autoFocus
                />
            </div>
            <IconButton label={t("ui.close")} onClick={close}>
                <X size={19} />
            </IconButton>
        </div>
    );
};

/** Two groups of buttons over the app's own page. */
const CompactHeader: React.FC<HeaderProps> = ({ model, view, onBack, onMinimize, onSwitch }) => {
    const { t } = useI18n();
    const left = React.useRef<HTMLDivElement | null>(null);
    const right = React.useRef<HTMLDivElement | null>(null);
    useBlock(left);
    useBlock(right);
    return (
        <header className="container-float" data-testid="container-header">
            <div className="container-capsule" ref={left}>
                {model.back ? (
                    <IconButton label={t("common.back")} onClick={onBack} data-testid="app-back">
                        <ChevronLeft size={21} />
                    </IconButton>
                ) : null}
                <SwitchButton view={view} onSwitch={onSwitch} />
            </div>
            <div className="container-capsule" ref={right}>
                <MoreButton model={model} view={view} />
                <IconButton label={t("container.minimize")} onClick={onMinimize} data-testid="app-minimize">
                    <Minus size={19} />
                </IconButton>
            </div>
        </header>
    );
};
