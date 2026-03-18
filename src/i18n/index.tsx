import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { detectLocale, normalizeLocale, type Locale } from "./config";
import en from "./translations/en";
import zh from "./translations/zh";
import zhTW from "./translations/zhTW";
import es from "./translations/es";
import fr from "./translations/fr";
import de from "./translations/de";
import ko from "./translations/ko";
import ja from "./translations/ja";
import ru from "./translations/ru";

const LOCALE_STORAGE_KEY = "buckyos.locale";

type Dict = typeof en;

const dictionaries: Record<Locale, Dict> = {
    en,
    zh,
    "zh-TW": zhTW,
    es,
    fr,
    de,
    ko,
    ja,
    ru,
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
    try {
        const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
        if (saved) return normalizeLocale(saved);
    } catch {
        // Ignore storage read failures and fall back to system locale.
    }

    return detectLocale();
}

function syncDocumentLanguage(locale: Locale) {
    if (typeof document !== "undefined") {
        document.documentElement.lang = locale;
    }
}

export const I18nProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [locale, setLocaleState] = useState<Locale>(detectInitialLocale());

    const setLocale = (l: Locale) => {
        const normalized = normalizeLocale(l);
        setLocaleState(normalized);
        syncDocumentLanguage(normalized);
        try {
            localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
        } catch {
            // Ignore storage write failures.
        }
    };

    const dict = dictionaries[locale] as Dict;

    useEffect(() => {
        syncDocumentLanguage(locale);
    }, [locale]);

    const t = useMemo(() => {
        return (key: string, params?: Params) => {
            const val = getByPath(dict, key);
            if (typeof val === "string") return interpolate(val, params);

            const fallback = getByPath(en, key);
            if (typeof fallback === "string") return interpolate(fallback, params);

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
