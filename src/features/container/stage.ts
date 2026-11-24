import React from "react";
import { getTheme, subscribeTheme } from "../../theme";
import { ViewStage } from "../content/mobileViews";

/** The local pages' own ground (`--cp-bg`): shown until a view has painted. */
const GROUND = { light: "#f3f3f2", dark: "#141415" } as const;
/** A view that another place of this page takes over in the next moment does not go out of sight. */
const LEAVE_MS = 60;

// One stage for the tabs and the app container: going from one to the other is a single change of
// place, not a hide and a show.
const stage = new ViewStage(() => GROUND[getTheme()]);
let leaving: number | undefined;
let followsTheme = false;

/** Shows a content view over an element while it is mounted. */
export function useStage(ref: React.RefObject<HTMLElement | null>, viewId: string | null): void {
    React.useLayoutEffect(() => {
        const element = ref.current;
        if (!element || !viewId) return;
        if (!followsTheme) {
            followsTheme = true;
            subscribeTheme(() => stage.update());
        }
        window.clearTimeout(leaving);
        document.documentElement.toggleAttribute("data-content-view", true);
        stage.mount(element, viewId);
        return () => {
            // This page is opaque again at once; only the native side waits.
            document.documentElement.toggleAttribute("data-content-view", false);
            window.clearTimeout(leaving);
            leaving = window.setTimeout(() => stage.unmount(), LEAVE_MS);
        };
    }, [ref, viewId]);
}
