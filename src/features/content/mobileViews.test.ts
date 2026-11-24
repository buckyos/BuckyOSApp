import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<[string, unknown]> = [];
let failNext: Error | null = null;
let pressBack: (() => void) | null = null;

vi.mock("@tauri-apps/api/core", () => ({
    invoke: async (name: string, args: unknown) => {
        calls.push([name, args]);
        if (failNext) {
            const error = failNext;
            failNext = null;
            throw error;
        }
        return null;
    },
}));
vi.mock("@tauri-apps/api/app", () => ({
    onBackButtonPress: async (handler: () => void) => {
        pressBack = handler;
        return { unregister: async () => void (pressBack = null) };
    },
}));

const { BackStack, Overlays, ViewStage, frontChanged, hideViews, layoutView } = await import("./mobileViews");
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const element = (value: ReturnType<typeof rect>) => ({ getBoundingClientRect: () => value as DOMRect });

beforeEach(async () => {
    await hideViews().catch(() => undefined);
    calls.length = 0;
});

describe("layout", () => {
    it("says a place once", async () => {
        await layoutView("a", rect(0, 96, 360, 640));
        await layoutView("a", rect(0, 96, 360, 640));
        expect(calls).toEqual([["content_layout", { layout: { view: "a", rect: rect(0, 96, 360, 640) } }]]);
        await layoutView("a", rect(0, 96, 360, 600), "#101010");
        await hideViews();
        expect(calls.length).toBe(3);
    });

    it("does not take what it said for the place when a view came to the front by itself", async () => {
        await hideViews();
        await hideViews();
        expect(calls.length).toBe(0);
        frontChanged("a");
        await hideViews();
        expect(calls).toEqual([["content_layout", { layout: { view: null } }]]);
        await layoutView("a", rect(0, 0, 1, 1));
        frontChanged("a");
        await layoutView("a", rect(0, 0, 1, 1));
        expect(calls.length).toBe(2);
    });

    it("puts what the stage shows back in front", async () => {
        vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
        vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
        const stage = new ViewStage();
        stage.mount(element(rect(0, 96, 360, 640)) as unknown as Element, "app");
        frontChanged("tab");
        expect(calls.length).toBe(1);
        frontChanged("tab", true);
        expect(calls.map(([, args]) => (args as { layout: { view: string } }).layout.view)).toEqual(["app", "app"]);
        stage.unmount();
        frontChanged("tab", true);
        expect(calls.length).toBe(3);
        vi.unstubAllGlobals();
    });

    it("says it again after a failure", async () => {
        failNext = new Error("no such view");
        await expect(layoutView("gone", rect(0, 0, 1, 1))).rejects.toThrow();
        await layoutView("gone", rect(0, 0, 1, 1));
        expect(calls.length).toBe(2);
    });
});

describe("overlays", () => {
    it("is modal while anything is open", () => {
        const overlays = new Overlays();
        const first = overlays.open();
        const second = overlays.open();
        first();
        first();
        expect(calls.map(([, args]) => (args as { overlay: { modal: boolean } }).overlay.modal)).toEqual([true]);
        second();
        expect(calls.at(-1)).toEqual(["content_overlay", { overlay: { modal: false, blocks: [] } }]);
    });

    it("keeps parts of the place", () => {
        const overlays = new Overlays();
        let at = rect(10.26, 0, 100, 48);
        const release = overlays.block({ getBoundingClientRect: () => at as DOMRect });
        expect(calls.at(-1)).toEqual(["content_overlay", { overlay: { modal: false, blocks: [rect(10.5, 0, 100, 48)] } }]);
        overlays.update();
        expect(calls.length).toBe(1);
        at = rect(10, 20, 100, 48);
        overlays.update();
        expect(calls.length).toBe(2);
        release();
        release();
        expect(calls.length).toBe(3);
        overlays.block(element(rect(0, 0, 1, 1)));
        expect(calls.length).toBe(4);
    });
});

describe("back", () => {
    it("asks the newest handler first and falls back at the root", async () => {
        const stack = new BackStack();
        const asked: string[] = [];
        stack.push(() => (asked.push("page"), true));
        const release = stack.push(async () => (asked.push("dialog"), true));
        stack.push(() => (asked.push("idle"), false));
        let left = 0;
        const leave = () => void (left += 1);
        await stack.back(leave);
        expect(asked).toEqual(["idle", "dialog"]);
        release();
        await stack.back(leave);
        expect(asked.slice(2)).toEqual(["idle", "page"]);
        expect(left).toBe(0);
        await new BackStack().back(leave);
        expect(left).toBe(1);
    });

    it("answers one press at a time", async () => {
        const stack = new BackStack();
        let finish: (value: boolean) => void = () => undefined;
        let asked = 0;
        stack.push(() => {
            asked += 1;
            return new Promise<boolean>((resolve) => (finish = resolve));
        });
        const first = stack.back(() => undefined);
        expect(await stack.back(() => undefined)).toBe(false);
        finish(true);
        expect(await first).toBe(true);
        expect(asked).toBe(1);
    });

    it("takes the button until it stops", async () => {
        let left = 0;
        const stop = await new BackStack().start(() => void (left += 1));
        pressBack?.();
        await Promise.resolve();
        expect(left).toBe(1);
        stop();
        expect(pressBack).toBeNull();
    });
});
