import { invoke } from "@tauri-apps/api/core";
import type { OpenViewRequest, ViewInfo } from "./types";

export const OPEN_URL_EVENT = "content://open-url";
export const FRAME_EVENT = "content://frame";
export const VIEW_EVENT = "content://view";
export const CLOSE_REQUEST_EVENT = "content://close-request";
export const SIGN_IN_EVENT = "content://sign-in";
export const DOWNLOAD_EVENT = "content://download";

export const openView = (view: OpenViewRequest) => invoke<ViewInfo>("content_open", { view });
export const focusView = (id: string, url?: string) => invoke<ViewInfo>("content_focus", { id, url: url ?? null });
export const closeView = (id: string) => invoke<void>("content_close", { id });
/** Desktop: the app of a window to be closed is being asked. */
export const closingView = (id: string) => invoke<void>("content_closing", { id });
export const listViews = () => invoke<ViewInfo[]>("content_list");
export const emitToView = (id: string, event: string, payload: unknown) =>
    invoke<void>("content_emit", { id, event, payload: payload ?? null });
export const setViewTitle = (id: string, title: string) => invoke<void>("content_set_title", { id, title });
/** Desktop: the window's icon, a base64 PNG. */
export const setViewIcon = (id: string, png: string) => invoke<void>("content_set_icon", { id, png });
