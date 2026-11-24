import { describe, expect, it } from "vitest";
import { payloadText } from "./payload";

describe("what is signed, on screen", () => {
    it("is indented JSON", () => {
        expect(payloadText({ op: "bind", zone: "did:bns:a" })).toBe('{\n  "op": "bind",\n  "zone": "did:bns:a"\n}');
    });

    it("shows characters that would hide or reorder text", () => {
        expect(payloadText({ to: `alice${String.fromCharCode(0x202e)}ecila` })).toContain("alice\\u202eecila");
        expect(payloadText(`a${String.fromCharCode(0x200b)}b`)).toBe('"a\\u200bb"');
        expect(payloadText("中文 ok")).toBe('"中文 ok"');
    });
});
