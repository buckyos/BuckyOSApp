import { describe, expect, it } from "vitest";
import { windowKindOf } from "./windowKind";

describe("windows of the client", () => {
    it("only the main window runs the client", () => {
        expect(windowKindOf("main")).toBe("main");
        expect(windowKindOf(undefined)).toBe("main");
        expect(windowKindOf("app_12")).toBe("content");
        expect(windowKindOf("aux_tray")).toBe("tray");
        expect(windowKindOf("aux_sign_3")).toBe("sign");
        expect(windowKindOf("aux_active-ood1-192-168-1-2")).toBe("other");
        expect(windowKindOf("something")).toBe("other");
    });
});
