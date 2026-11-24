import { beforeEach, describe, expect, it, vi } from "vitest";

const frameBack = vi.fn<(id: string) => Promise<boolean>>();
const viewBack = vi.fn<(id: string) => Promise<boolean>>();
vi.mock("../content/clientRuntime", () => ({ clientRuntime: { frames: { back: frameBack } } }));
vi.mock("../content/mobileViews", () => ({ viewBack }));
vi.stubGlobal("window", globalThis);
const { backInView, backTarget } = await import("./back");

beforeEach(() => {
    frameBack.mockReset();
    viewBack.mockReset();
});

describe("back on a phone", () => {
    it("asks the app, then its history", async () => {
        frameBack.mockResolvedValueOnce(true);
        expect(await backInView("v")).toBe(true);
        expect(viewBack).not.toHaveBeenCalled();
        frameBack.mockResolvedValueOnce(false);
        viewBack.mockResolvedValueOnce(true);
        expect(await backInView("v")).toBe(true);
        frameBack.mockResolvedValueOnce(false);
        viewBack.mockResolvedValueOnce(false);
        expect(await backInView("v")).toBe(false);
        frameBack.mockResolvedValueOnce(false);
        viewBack.mockRejectedValueOnce(new Error("gone"));
        expect(await backInView("v")).toBe(false);
    });

    it("does not wait for an app that does not answer", async () => {
        vi.useFakeTimers();
        frameBack.mockReturnValueOnce(new Promise(() => undefined));
        viewBack.mockResolvedValueOnce(false);
        const answer = backInView("v");
        await vi.advanceTimersByTimeAsync(1600);
        expect(await answer).toBe(false);
        vi.useRealTimers();
    });

    it("leads up, to Home, and out", () => {
        expect(backTarget("/main/setting/zones/did%3Abns%3Aa")).toEqual({ to: "/main/setting/zones", came: true });
        expect(backTarget("/main/setting/zones")).toEqual({ to: "/main/setting", came: true });
        expect(backTarget("/main/setting/about")).toEqual({ to: "/main/setting", came: true });
        expect(backTarget("/main/setting")).toEqual({ to: "/main/home" });
        expect(backTarget("/main/feed")).toEqual({ to: "/main/home" });
        expect(backTarget("/main/home/ood-scan")).toEqual({ to: "/main/home" });
        expect(backTarget("/main/home")).toBe("background");
        expect(backTarget("/")).toBe("background");
        expect(backTarget("/create")).toBe("history");
        expect(backTarget("/web-container")).toBe("history");
    });
});
