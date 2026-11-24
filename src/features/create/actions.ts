// The phone's “＋”: where each kind of new thing is made. The content handlers have no `create`
// intent to take them from yet, so this list is the one place to change (TODO U6, §6.2).
import { findApp, type AppCatalog, type AppEntry } from "../apps/catalog";

export type CreateKind = "message" | "post" | "note" | "photo";

export interface CreateAction {
    kind: CreateKind;
    /** `OpenAppRequest.app` and `path`. */
    app: string;
    path?: string;
}

export const CREATE_ACTIONS: readonly CreateAction[] = [
    { kind: "message", app: "messagehub" },
    { kind: "post", app: "homestation", path: "/?new=post" },
    // No app makes notes yet: a new document in AI Workspace.
    { kind: "note", app: "aiworkspace" },
    { kind: "photo", app: "files", path: "/upload" },
];

/** The actions with the app of this Zone that does them; null where the Zone has none. */
export function createTargets(catalog: AppCatalog | undefined, userId?: string | null): { action: CreateAction; entry: AppEntry | null }[] {
    return CREATE_ACTIONS.map((action) => ({ action, entry: (catalog && findApp(catalog, action.app, userId)) ?? null }));
}
