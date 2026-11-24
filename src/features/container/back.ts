import { clientRuntime } from "../content/clientRuntime";
import { viewBack } from "../content/mobileViews";

/** An app that does not answer does not hold the back button. */
const ANSWER_MS = 1500;

/** One step back inside a view: the app's own, else its history. False at its beginning. */
export async function backInView(viewId: string): Promise<boolean> {
    const own = await Promise.race([
        clientRuntime.frames.back(viewId),
        new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), ANSWER_MS)),
    ]);
    return own || viewBack(viewId).catch(() => false);
}

/** `came`: where the user came from goes first, as the page's own back button does. */
export type BackTarget = { to: string; came?: true } | "history" | "background";

/** Where back leads from one of the client's own pages. */
export function backTarget(path: string): BackTarget {
    const page = path.replace(/\/+$/, "") || "/";
    if (page === "/" || page === "/main" || page === "/main/home") return "background";
    if (page.startsWith("/main/setting/zones/")) return { to: "/main/setting/zones", came: true };
    if (page.startsWith("/main/setting/")) return { to: "/main/setting", came: true };
    if (page.startsWith("/main/")) return { to: "/main/home" };
    return "history";
}
