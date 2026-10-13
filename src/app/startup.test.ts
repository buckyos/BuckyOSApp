import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkStartupWallet } from "./startup";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("startup wallet check", () => {
    it("shares concurrent StrictMode reads and rechecks after account deletion", async () => {
        let complete!: (value: boolean) => void;
        vi.mocked(invoke).mockReset().mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
        const first = checkStartupWallet();
        const replay = checkStartupWallet();
        expect(first).toBe(replay);
        expect(invoke).toHaveBeenCalledTimes(1);
        complete(true);
        await expect(first).resolves.toBe(true);
        vi.mocked(invoke).mockResolvedValueOnce(false);
        await expect(checkStartupWallet()).resolves.toBe(false);
        expect(invoke).toHaveBeenCalledTimes(2);
    });

    it("clears a failed read so a later startup can retry", async () => {
        vi.mocked(invoke).mockReset().mockRejectedValueOnce(new Error("store unavailable"));
        await expect(checkStartupWallet()).rejects.toThrow("store unavailable");
        vi.mocked(invoke).mockResolvedValueOnce(true);
        await expect(checkStartupWallet()).resolves.toBe(true);
    });
});
