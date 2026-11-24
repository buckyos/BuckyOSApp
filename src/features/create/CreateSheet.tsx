import React from "react";
import { Image, MessageCirclePlus, NotebookPen, SquarePen } from "lucide-react";
import { Sheet } from "../../components/ui/Sheet";
import { useI18n } from "../../i18n";
import { useCatalog } from "../apps/useCatalog";
import { clientRuntime } from "../content/clientRuntime";
import { zoneTitle, type ZoneView } from "../zone/types";
import { createTargets, type CreateKind } from "./actions";

const ICONS: Record<CreateKind, typeof Image> = { message: MessageCirclePlus, post: SquarePen, note: NotebookPen, photo: Image };

/** Makes something new in the current Zone. */
export const CreateSheet: React.FC<{ open: boolean; zone: ZoneView; onClose: () => void }> = ({ open, zone, onClose }) => {
    const { t } = useI18n();
    const { catalog } = useCatalog(open ? zone : null);
    return (
        <Sheet open={open} title={t("create_menu.title", { zone: zoneTitle(zone) })} onClose={onClose} testId="create-sheet">
            <div className="create-list">
                {createTargets(catalog, zone.session.identity?.user_id).map(({ action, entry }) => {
                    const Icon = ICONS[action.kind];
                    const missing = Boolean(catalog) && !entry;
                    return (
                        <button
                            key={action.kind}
                            type="button"
                            className="create-item"
                            data-create={action.kind}
                            disabled={missing}
                            onClick={() => {
                                onClose();
                                void clientRuntime.openApp(zone.did, action.app, action.path);
                            }}
                        >
                            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                            <span className="ui-row-text">
                                <span className="ui-row-title">{t(`create_menu.${action.kind}`)}</span>
                                {missing ? <span className="ui-row-sub">{t("create_menu.missing")}</span> : null}
                            </span>
                        </button>
                    );
                })}
            </div>
        </Sheet>
    );
};
