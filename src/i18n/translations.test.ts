import { describe, expect, it } from "vitest";
import de from "./translations/de";
import en from "./translations/en";
import es from "./translations/es";
import fr from "./translations/fr";
import ja from "./translations/ja";
import ko from "./translations/ko";
import ru from "./translations/ru";
import zh from "./translations/zh";
import zhTW from "./translations/zhTW";

type Dict = { [key: string]: string | Dict };

function flat(dict: Dict, prefix = ""): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(dict)) {
        if (typeof value === "string") out.set(prefix + key, value);
        else for (const [inner, text] of flat(value, `${prefix}${key}.`)) out.set(inner, text);
    }
    return out;
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(.*?)\}\}/g)].map((match) => match[1].trim()).sort();
const english = flat(en as Dict);
/** The tray menu of the local services is only there in English and Chinese; elsewhere it falls back to English. */
const inSections = (key: string) => !/^tray\.(?!popover_all$|menu\.notifications$)/.test(key);

describe.each(Object.entries({ zh, "zh-TW": zhTW, es, fr, de, ko, ja, ru }))("%s", (_locale, dict) => {
    const texts = flat(dict as Dict);

    it("has every text of the client's pages", () => {
        expect([...english.keys()].filter((key) => inSections(key) && !texts.has(key))).toEqual([]);
    });

    it("fills in the same values", () => {
        for (const [key, text] of texts) {
            if (inSections(key) && english.has(key)) expect([key, placeholders(text)]).toEqual([key, placeholders(english.get(key) ?? "")]);
        }
    });

    it("has no empty text", () => {
        expect([...texts].filter(([key, text]) => inSections(key) && !text.trim() && english.get(key)?.trim()).map(([key]) => key)).toEqual([]);
    });
});

describe("the texts the pages use", () => {
    it("exist in English", async () => {
        const sources = import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
        const missing = new Set<string>();
        for (const [file, source] of Object.entries(sources)) {
            if (file.includes("translations") || file.endsWith(".test.ts")) continue;
            for (const match of source.matchAll(/\bt\(\s*(?:[a-zA-Z.&|! ()]+ \? )?"([a-z_]+(?:\.[a-zA-Z_]+)+)"(?: : "([a-z_]+(?:\.[a-zA-Z_]+)+)")?/g)) {
                for (const key of [match[1], match[2]]) if (key && !english.has(key)) missing.add(`${file}: ${key}`);
            }
        }
        expect([...missing]).toEqual([]);
    });
});
