import { describe, expect, it, vi } from "vitest";
import { createRetry, type RetryEnvironment } from "./retry";

function page() {
    const state = { visible: true, wake: () => undefined as void, timers: new Map<number, { work: () => void; ms: number }>(), next: 1, listening: true };
    const environment: RetryEnvironment = {
        visible: () => state.visible,
        onWake: (listener) => {
            state.wake = listener;
            return () => {
                state.listening = false;
            };
        },
        setTimer: (work, ms) => {
            state.timers.set(state.next, { work, ms });
            return state.next++;
        },
        clearTimer: (timer) => void state.timers.delete(timer),
    };
    const fire = () => {
        const [id, timer] = [...state.timers][0];
        state.timers.delete(id);
        timer.work();
        return timer.ms;
    };
    return { state, environment, fire };
}

describe("reading again after a failure", () => {
    it("waits longer each time and starts over after a success", () => {
        const { environment, fire } = page();
        const again = vi.fn();
        const retry = createRetry(again, environment);
        const waits: number[] = [];
        for (let count = 0; count < 5; count += 1) {
            retry.failed();
            waits.push(fire());
        }
        expect(waits).toEqual([3_000, 6_000, 12_000, 30_000, 30_000]);
        expect(again).toHaveBeenCalledTimes(5);
        retry.succeeded();
        retry.failed();
        expect(fire()).toBe(3_000);
    });

    it("does not read behind a page nobody looks at, and does when it is looked at again", () => {
        const { state, environment, fire } = page();
        const again = vi.fn();
        const retry = createRetry(again, environment);
        state.visible = false;
        retry.failed();
        fire();
        state.wake();
        expect(again).not.toHaveBeenCalled();
        state.visible = true;
        state.wake();
        state.wake();
        expect(again).toHaveBeenCalledTimes(1);
    });

    it("has one timer, and none after a success or the end", () => {
        const { state, environment } = page();
        const again = vi.fn();
        const retry = createRetry(again, environment);
        retry.failed();
        retry.failed();
        expect(state.timers.size).toBe(1);
        retry.succeeded();
        expect(state.timers.size).toBe(0);
        retry.failed();
        retry.stop();
        state.wake();
        expect(state.timers.size).toBe(0);
        expect(state.listening).toBe(false);
        expect(again).not.toHaveBeenCalled();
    });
});
