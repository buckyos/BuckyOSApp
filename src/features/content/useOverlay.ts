import React from "react";
import { isMobileShell } from "../../utils/platform";
import { backStack, overlays } from "./mobileViews";

/** The phone's back button while `active`; `handler` answers whether it did something (no answer: it did). */
export function useBack(active: boolean, handler: () => void | boolean | Promise<boolean>): void {
    const latest = React.useRef(handler);
    latest.current = handler;
    React.useEffect(() => {
        if (!active || !isMobileShell()) return;
        return backStack.push(async () => (await latest.current()) !== false);
    }, [active]);
}

/** Something drawn over everything: on a phone a content view below must not get the touches. */
export function useOverlay(active: boolean, onBack: () => void): void {
    React.useEffect(() => {
        if (!active || !isMobileShell()) return;
        return overlays.open();
    }, [active]);
    useBack(active, onBack);
}

/** An element over a content view that keeps its touches while the rest goes through. */
export function useBlock(ref: React.RefObject<Element | null>, active = true): void {
    React.useEffect(() => {
        const element = ref.current;
        if (!element || !active || !isMobileShell()) return;
        const release = overlays.block(element);
        const observer = new ResizeObserver(() => overlays.update());
        observer.observe(element);
        return () => {
            observer.disconnect();
            release();
        };
    }, [ref, active]);
}
