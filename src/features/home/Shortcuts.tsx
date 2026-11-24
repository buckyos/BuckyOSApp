import React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { SearchInput } from "../../components/ui/Field";
import { Menu } from "../../components/ui/Menu";
import { Empty } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { appName, findApp, type AppCatalog, type AppEntry } from "../apps/catalog";
import { AppGridSkeleton, AppIcon, AppTile } from "../apps/AppTile";
import { launcherEntries, useCatalog } from "../apps/useCatalog";
import { clientRuntime } from "../content/clientRuntime";
import { useRuntime } from "../content/useRuntime";
import type { ZoneView } from "../zone/types";
import { addShortcut, moveShortcut, nearestIndex, removeShortcut, shortcutEntries } from "./shortcuts";
import { useShortcuts } from "./useShortcuts";
import "./home.css";

const DRAG_START = 5;

interface Drag {
    id: string;
    dx: number;
    dy: number;
}

/** The apps the user keeps on Home. */
export const Shortcuts: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t } = useI18n();
    const { catalog, loading, failed, reload } = useCatalog(zone);
    const { shortcuts, unsaved, editable, change } = useShortcuts(zone);
    const { views } = useRuntime();
    const [editing, setEditing] = React.useState(false);
    const [adding, setAdding] = React.useState(false);
    const [menu, setMenu] = React.useState<{ x: number; y: number; entry: AppEntry } | null>(null);
    const userId = zone.session.identity?.user_id;

    React.useEffect(() => {
        setEditing(false);
        setAdding(false);
        setMenu(null);
    }, [zone.did]);

    const entries = React.useMemo(
        () => (catalog && shortcuts ? shortcutEntries(catalog, shortcuts, (list, id) => findApp(list, id, userId)) : []),
        [catalog, shortcuts, userId]
    );
    const ready = Boolean(catalog && shortcuts);
    const running = React.useMemo(
        () => new Set(views.filter((view) => view.zone === zone.did).map((view) => view.appInstance)),
        [views, zone.did]
    );
    // The list holds app ids; a shown app may have been stored by its instance.
    const idOf = (entry: AppEntry) => shortcuts?.find((id) => id === entry.instance || id === entry.id) ?? entry.id;
    const move = (entry: AppEntry, target: AppEntry | undefined) => {
        if (shortcuts && target) change(moveShortcut(shortcuts, idOf(entry), idOf(target)));
    };
    const remove = (entry: AppEntry) => {
        if (!shortcuts) return;
        const next = removeShortcut(shortcuts, idOf(entry));
        change(next);
        if (entries.length <= 1) setEditing(false);
    };

    if (zone.session.state !== "signed_in" && !catalog) return null;

    return (
        <section className="ui-section" data-testid="shortcuts">
            <div className="home-heading">
                <h2 className="ui-section-title">{t("home.shortcuts")}</h2>
                {ready && editable && entries.length > 0 ? (
                    <button type="button" className="ui-link" onClick={() => setEditing((value) => !value)} data-testid="edit-shortcuts">
                        {t(editing ? "common.actions.done" : "home.edit")}
                    </button>
                ) : null}
            </div>
            {failed && !catalog ? (
                <Empty text={t("apps.failed")}>
                    <Button size="sm" onClick={reload}>
                        {t("ui.retry")}
                    </Button>
                </Empty>
            ) : !ready ? (
                loading || !shortcuts ? <AppGridSkeleton count={4} /> : null
            ) : (
                <ShortcutGrid
                    zone={zone}
                    entries={entries}
                    editing={editing}
                    running={running}
                    onMove={move}
                    onRemove={remove}
                    onMenu={(entry, at) => setMenu({ ...at, entry })}
                    onAdd={editable ? () => setAdding(true) : undefined}
                />
            )}
            {unsaved ? <p className="ui-section-note">{t("home.shortcuts_unsaved")}</p> : null}
            {adding && catalog && shortcuts ? (
                <AddAppDialog
                    zone={zone}
                    catalog={catalog}
                    shown={new Set(entries.map((entry) => entry.instance))}
                    onAdd={(entry) => change(addShortcut(shortcuts, entry.id))}
                    onClose={() => setAdding(false)}
                />
            ) : null}
            <Menu
                at={menu}
                label={t("home.shortcuts")}
                onClose={() => setMenu(null)}
                items={
                    menu
                        ? [
                            { id: "open", label: t("apps.open"), onSelect: () => void clientRuntime.openApp(zone.did, menu.entry.instance) },
                            ...(editable
                                ? [
                                    { id: "edit", label: t("home.arrange"), onSelect: () => setEditing(true) },
                                    { id: "remove", label: t("apps.remove_home"), onSelect: () => remove(menu.entry) },
                                ]
                                : []),
                        ]
                        : []
                }
            />
        </section>
    );
};

interface GridProps {
    zone: ZoneView;
    entries: AppEntry[];
    editing: boolean;
    running: ReadonlySet<string>;
    onMove: (entry: AppEntry, target: AppEntry | undefined) => void;
    onRemove: (entry: AppEntry) => void;
    onMenu: (entry: AppEntry, at: { x: number; y: number }) => void;
    onAdd?: () => void;
}

/** Arranged by dragging while editing, or with the arrow keys. */
const ShortcutGrid: React.FC<GridProps> = ({ zone, entries, editing, running, onMove, onRemove, onMenu, onAdd }) => {
    const { t, contentLocale } = useI18n();
    const cells = React.useRef(new Map<string, HTMLDivElement>());
    const press = React.useRef<{ id: string; pointer: number; x: number; y: number } | null>(null);
    const [drag, setDrag] = React.useState<Drag | null>(null);

    const boxes = () => entries.map((entry) => cells.current.get(entry.instance)?.getBoundingClientRect() ?? new DOMRect());

    const onPointerMove = (event: React.PointerEvent) => {
        const start = press.current;
        if (!start || event.pointerId !== start.pointer) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!drag && Math.hypot(dx, dy) < DRAG_START) return;
        if (!drag) (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        const rects = boxes();
        const from = entries.findIndex((entry) => entry.instance === start.id);
        const over = nearestIndex({ x: event.clientX, y: event.clientY }, rects);
        if (from >= 0 && over >= 0 && over !== from) {
            onMove(entries[from], entries[over]);
            // The tile now lives in the other cell: it keeps following the pointer from there.
            start.x += rects[over].left - rects[from].left;
            start.y += rects[over].top - rects[from].top;
        }
        setDrag({ id: start.id, dx: event.clientX - start.x, dy: event.clientY - start.y });
    };

    const end = () => {
        press.current = null;
        setDrag(null);
    };

    return (
        <div className="app-grid shortcut-grid">
            {entries.map((entry, index) => {
                const name = appName(entry, contentLocale);
                const dragged = drag?.id === entry.instance;
                return (
                    <div
                        key={entry.instance}
                        className="shortcut-cell"
                        ref={(node) => {
                            if (node) cells.current.set(entry.instance, node);
                            else cells.current.delete(entry.instance);
                        }}
                    >
                        <AppTile
                            zone={zone}
                            entry={entry}
                            running={!editing && running.has(entry.instance)}
                            className="shortcut-tile"
                            data-editing={editing || undefined}
                            data-dragging={dragged || undefined}
                            style={dragged ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : undefined}
                            aria-label={editing ? t("home.arrange_app", { app: name }) : name}
                            onOpen={() => {
                                if (!editing) void clientRuntime.openApp(zone.did, entry.instance);
                            }}
                            onContextMenu={(event) => {
                                event.preventDefault();
                                onMenu(entry, { x: event.clientX, y: event.clientY });
                            }}
                            onPointerDown={(event) => {
                                if (editing && event.button === 0) {
                                    press.current = { id: entry.instance, pointer: event.pointerId, x: event.clientX, y: event.clientY };
                                }
                            }}
                            onPointerMove={editing ? onPointerMove : undefined}
                            onPointerUp={end}
                            onPointerCancel={end}
                            onKeyDown={(event) => {
                                if (!editing) return;
                                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                                    event.preventDefault();
                                    onMove(entry, entries[index + (event.key === "ArrowRight" ? 1 : -1)]);
                                } else if (event.key === "Delete" || event.key === "Backspace") {
                                    onRemove(entry);
                                }
                            }}
                        />
                        {editing && !dragged ? (
                            <button
                                type="button"
                                className="shortcut-remove"
                                aria-label={t("home.remove_app", { app: name })}
                                title={t("apps.remove_home")}
                                onClick={() => onRemove(entry)}
                            >
                                <X size={12} strokeWidth={2.6} aria-hidden="true" />
                            </button>
                        ) : null}
                    </div>
                );
            })}
            {onAdd ? (
                <button type="button" className="app-tile shortcut-add" onClick={onAdd} data-testid="add-shortcut">
                    <span className="app-tile-icon">
                        <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span className="app-tile-name">{t("home.add_app")}</span>
                </button>
            ) : null}
        </div>
    );
};

const AddAppDialog: React.FC<{
    zone: ZoneView;
    catalog: AppCatalog;
    shown: ReadonlySet<string>;
    onAdd: (entry: AppEntry) => void;
    onClose: () => void;
}> = ({ zone, catalog, shown, onAdd, onClose }) => {
    const { t, contentLocale } = useI18n();
    const [search, setSearch] = React.useState("");
    const entries = launcherEntries(catalog, contentLocale, search);
    return (
        <Dialog
            open
            title={t("home.add_app_title")}
            onClose={onClose}
            testId="add-app-dialog"
            actions={
                <Button variant="primary" onClick={onClose}>
                    {t("common.actions.done")}
                </Button>
            }
        >
            <SearchInput value={search} onChange={setSearch} label={t("apps.search")} />
            <div className="add-app-list ui-scroll">
                {entries.map((entry) => {
                    const added = shown.has(entry.instance);
                    return (
                        <button key={entry.instance} type="button" className="ui-row" disabled={added} onClick={() => onAdd(entry)}>
                            <AppIcon zone={zone} entry={entry} size={30} />
                            <span className="ui-row-text">
                                <span className="ui-row-title">{appName(entry, contentLocale)}</span>
                            </span>
                            <span className="ui-row-value">{added ? t("home.added") : <Plus size={16} aria-hidden="true" />}</span>
                        </button>
                    );
                })}
                {entries.length === 0 ? <Empty text={t("apps.no_match")} /> : null}
            </div>
        </Dialog>
    );
};
