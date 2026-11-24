import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ onBackButtonPress: vi.fn() }));
const { endingAudio } = await import("./audioLeave");

const views = [
    { id: "m", zone: "a", title: "Music", app: "music" },
    { id: "r", zone: "a", title: "", app: "recorder" },
    { id: "x", zone: "b", title: "Radio", app: "radio" },
];

describe("leaving a Zone while something plays", () => {
    it("names what stops, of that Zone only", () => {
        expect(endingAudio({ playing: ["m", "x"], recording: null }, views, "a")).toEqual({ playing: ["Music"], recording: null });
        expect(endingAudio({ playing: ["x"], recording: null }, views, "a")).toBeNull();
        expect(endingAudio({ playing: [], recording: { view: "r", zone: "a", app: "recorder" } }, views, "a")).toEqual({ playing: [], recording: "recorder" });
        expect(endingAudio({ playing: [], recording: { view: "gone", zone: "a", app: "voice" } }, views, "a")).toEqual({ playing: [], recording: "voice" });
        expect(endingAudio({ playing: [], recording: { view: "r", zone: "b", app: "recorder" } }, views, "a")).toBeNull();
    });
});
