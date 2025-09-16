import React, { createContext, useContext, useMemo, useState } from "react";
import en from "./translations/en";
import zh from "./translations/zh";

type Locale = "en" | "zh";

type Dict = typeof en;

const dictionaries: Record<Locale, Dict> = {
    en,
    zh,
};

type Params = Record<string, string | number | boolean>;

function getByPath(obj: any, path: string): any {
    return path.split(".").reduce((acc, key) => (acc ? acc[key] : undefined), obj);
}

function interpolate(input: string, params?: Params): string {
    if (!params) return input;
    return input.replace(/\{\{(.*?)\}\}/g, (_, key) => {
        const trimmed = String(key).trim();
        const v = params[trimmed];
        return v === undefined || v === null ? "" : String(v);
    });
}

interface I18nContextValue {
    locale: Locale;
    setLocale: (l: Locale) => void;
    t: (key: string, params?: Params) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function detectInitialLocale(): Locale {
    const lang = (navigator.language || navigator.languages?.[0] || "en").toLowerCase();
    if (lang.startsWith("zh")) return "zh";
    return "en";
}

export const I18nProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [locale, setLocaleState] = useState<Locale>(detectInitialLocale());

    const setLocale = (l: Locale) => {
        setLocaleState(l);
    };

    const dict = dictionaries[locale] as Dict;

    const t = useMemo(() => {
        return (key: string, params?: Params) => {
            const val = getByPath(dict, key);
            if (typeof val === "string") return interpolate(val, params);
            // Fallback to key if not found
            return key;
        };
    }, [dict]);

    const value: I18nContextValue = { locale, setLocale, t };

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error("useI18n must be used within I18nProvider");
    return ctx;
}
