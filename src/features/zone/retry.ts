import { onLineBack } from "./lineEvents";

// Reading again what could not be read: sooner at first, and at once when the page is looked at or
// the network is back. A Zone that cannot be reached at all shows as its session (`offline`); this
// is for the rest, such as a service that was just starting.
const STEPS_MS = [3_000, 6_000, 12_000, 30_000];

export interface RetryEnvironment {
    visible: () => boolean;
    /** Calls back when the page may have become usable again. */
    onWake: (listener: () => void) => () => void;
    setTimer: (work: () => void, ms: number) => number;
    clearTimer: (timer: number) => void;
}

export const pageEnvironment: RetryEnvironment = {
    visible: () => document.visibilityState === "visible",
    onWake: (listener) => {
        document.addEventListener("visibilitychange", listener);
        window.addEventListener("online", listener);
        window.addEventListener("focus", listener);
        const stopLine = onLineBack(listener);
        return () => {
            stopLine();
            document.removeEventListener("visibilitychange", listener);
            window.removeEventListener("online", listener);
            window.removeEventListener("focus", listener);
        };
    },
    setTimer: (work, ms) => window.setTimeout(work, ms),
    clearTimer: (timer) => window.clearTimeout(timer),
};

export interface Retry {
    /** The last read failed: `again` is called later. */
    failed: () => void;
    succeeded: () => void;
    stop: () => void;
}

export function createRetry(again: () => void, environment: RetryEnvironment = pageEnvironment): Retry {
    let failures = 0;
    let waiting = false;
    let timer: number | undefined;
    const clear = () => {
        if (timer !== undefined) environment.clearTimer(timer);
        timer = undefined;
    };
    const run = () => {
        if (!waiting || !environment.visible()) return;
        waiting = false;
        clear();
        again();
    };
    const unlisten = environment.onWake(run);
    return {
        failed: () => {
            clear();
            waiting = true;
            timer = environment.setTimer(run, STEPS_MS[Math.min(failures, STEPS_MS.length - 1)]);
            failures += 1;
        },
        succeeded: () => {
            clear();
            waiting = false;
            failures = 0;
        },
        stop: () => {
            clear();
            waiting = false;
            unlisten();
        },
    };
}
