import React from "react";
import { ArrowUp, ChevronRight, Folder } from "lucide-react";
import { folderPath, parentFolder, type ZoneFolder } from "@buckyos-desktop/music/zoneFolders.ts";
import { Button, IconButton } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Spinner } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { zoneFolders } from "./player";

interface FolderDialogProps {
    zone: { did: string; host: string };
    /** Where it starts; the user's own folder when empty or gone. */
    folder: string;
    onChoose: (folder: string) => void;
    onClose: () => void;
}

type Listing = { path: string; folders: ZoneFolder[] | null; failed: boolean };

/** Chooses a folder of the Zone, starting in the user's own. */
export const FolderDialog: React.FC<FolderDialogProps> = ({ zone, folder, onChoose, onClose }) => {
    const { t } = useI18n();
    // Empty: the user's own folder, not known yet.
    const [path, setPath] = React.useState(folder);
    const [attempt, setAttempt] = React.useState(0);
    const [listing, setListing] = React.useState<Listing | null>(null);
    const start = React.useRef(folder);
    const listRef = React.useRef<HTMLDivElement | null>(null);
    const { did, host } = zone;

    React.useEffect(() => {
        const controller = new AbortController();
        const folders = zoneFolders({ did, host });
        const read = async () => {
            const at = path || (await folders.home());
            if (controller.signal.aborted) return;
            if (at !== path) {
                setPath(at);
                return;
            }
            setListing({ path: at, folders: null, failed: false });
            try {
                const found = await folders.folders(at, controller.signal);
                if (!controller.signal.aborted) setListing({ path: at, folders: found, failed: false });
            } catch (error) {
                if (controller.signal.aborted) return;
                // What was chosen before may be gone.
                if (start.current === at) {
                    start.current = "";
                    setPath("");
                    return;
                }
                throw error;
            }
        };
        read().catch((error) => {
            if (controller.signal.aborted) return;
            console.warn("[Music] listing a folder failed", host, error);
            setListing({ path, folders: null, failed: true });
        });
        return () => controller.abort();
    }, [did, host, path, attempt]);

    const go = (next: string) => {
        start.current = "";
        setPath(next);
        if (!listRef.current) return;
        listRef.current.scrollTop = 0;
        // The row that had the focus goes.
        listRef.current.focus();
    };
    const parent = path ? parentFolder(path) : null;
    const folders = listing && listing.path === path ? listing.folders : null;
    const failed = Boolean(listing && listing.path === path && listing.failed);
    const chosen = folders ? path : "";

    return (
        <Dialog
            open
            title={t("music.choose_title")}
            onClose={onClose}
            onSubmit={() => {
                if (chosen) onChoose(chosen);
            }}
            testId="folder-dialog"
            actions={
                <>
                    <Button onClick={onClose}>{t("common.actions.cancel")}</Button>
                    <Button variant="primary" type="submit" disabled={!chosen}>
                        {t("music.choose_this")}
                    </Button>
                </>
            }
        >
            <div className="folder-path">
                <IconButton label={t("music.up")} disabled={!parent} onClick={() => parent && go(parent)} data-testid="folder-up">
                    <ArrowUp size={16} />
                </IconButton>
                <span title={path ? `cyfs://${folderPath(path)}` : undefined} data-testid="folder-path">
                    {/* Written from the right, so a long path shows its end. */}
                    <bdi>{path ? `cyfs://${folderPath(path)}` : ""}</bdi>
                </span>
            </div>
            <div className="folder-list ui-scroll" ref={listRef} tabIndex={-1} data-testid="folder-list">
                {folders ? (
                    folders.length > 0 ? (
                        folders.map((child) => (
                            <button key={child.path} type="button" className="ui-row" onClick={() => go(child.path)}>
                                <Folder size={18} aria-hidden="true" />
                                <span className="ui-row-text">
                                    <span className="ui-row-title">{child.name}</span>
                                </span>
                                <ChevronRight size={16} aria-hidden="true" />
                            </button>
                        ))
                    ) : (
                        <p className="folder-note">{t("music.no_folders")}</p>
                    )
                ) : failed ? (
                    <div className="folder-note" role="alert">
                        <p>{t("music.folder_failed")}</p>
                        <Button size="sm" onClick={() => setAttempt((count) => count + 1)}>
                            {t("ui.retry")}
                        </Button>
                    </div>
                ) : (
                    <div className="folder-note">
                        <Spinner label={t("ui.loading")} />
                    </div>
                )}
            </div>
        </Dialog>
    );
};
