import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("window", { navigator: { userAgent: "iPhone" } });
const { failureText, openErrorOf } = await import("./openFailure");
const { OpenError } = await import("./types");

const t = (key: string, params?: Record<string, string>) => `${key} ${JSON.stringify(params ?? {})}`;
const names = { zone: "bob", app: "files" };

describe("what could not be opened", () => {
    it("keeps the reason there is", () => {
        const error = new OpenError("app_not_found", "did:web:bob", "files");
        expect(openErrorOf(error)).toBe(error);
        expect(failureText(t, error, names)).toBe('open.failure.app_not_found {"zone":"bob","app":"files"}');
    });

    it("tells what this platform has not from what went wrong", () => {
        expect(failureText(t, openErrorOf({ code: 1501, message: "Not supported here: view" }), names)).toBe('open.failure.not_here {"platform":"iOS"}');
        expect(failureText(t, openErrorOf({ code: 1999, message: "view: no memory" }), names)).toBe('open.failure.failed_because {"reason":"view: no memory"}');
        expect(openErrorOf({ code: 1402, message: "offline" }).reason).toBe("unreachable");
        expect(openErrorOf({ code: 1401, message: "" }).reason).toBe("need_login");
    });

    it("says what it can", () => {
        expect(failureText(t, { reason: "failed" }, names)).toBe('open.failure.failed {"zone":"bob","app":"files"}');
    });
});
