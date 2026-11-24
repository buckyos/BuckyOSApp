import { describe, expect, it, vi } from "vitest";

vi.mock("../zone/channel", () => ({ zoneChannel: vi.fn() }));
const { readFeed } = await import("./mobileFeed");

describe("what the feed tab shows", () => {
    it("takes only the two it knows", () => {
        expect(readFeed({ mobileFeed: "activity" })).toBe("activity");
        expect(readFeed("homestation")).toBe("homestation");
        expect(readFeed({ mobileFeed: "other" })).toBeNull();
        expect(readFeed({})).toBeNull();
        expect(readFeed(null)).toBeNull();
    });
});
