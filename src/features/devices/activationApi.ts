import { invoke } from "@tauri-apps/api/core";

/** A device's activation page was closed. */
export const ACTIVATION_CLOSED_EVENT = "activation://closed";

/** The page in a WebView of its own: a window on the desktop, on a phone a view to be laid out. */
export const openActivationPage = (url: string, title: string) => invoke<{ id: string }>("activation_open", { url, title });
export const closeActivationPage = (id: string) => invoke<void>("activation_close", { id });
