export const LOCALE_OPTIONS = [
    {
        code: "zh",
        label: "中文",
        aliases: ["zh", "zh-cn", "zh-sg"],
    },
    {
        code: "zh-TW",
        label: "繁体中文",
        aliases: ["zh-tw", "zh-hk", "zh-mo", "zh-hant"],
    },
    {
        code: "en",
        label: "English",
        aliases: ["en", "en-us", "en-gb", "en-ca", "en-au"],
    },
    {
        code: "es",
        label: "Español",
        aliases: ["es", "es-es", "es-mx", "es-419"],
    },
    {
        code: "fr",
        label: "Français",
        aliases: ["fr", "fr-fr", "fr-ca", "fr-be", "fr-ch"],
    },
    {
        code: "de",
        label: "Deutsch",
        aliases: ["de", "de-de", "de-at", "de-ch"],
    },
    {
        code: "ko",
        label: "한국어",
        aliases: ["ko", "ko-kr"],
    },
    {
        code: "ja",
        label: "日本語",
        aliases: ["ja", "ja-jp"],
    },
    {
        code: "ru",
        label: "Русский",
        aliases: ["ru", "ru-ru"],
    },
] as const;

export type Locale = (typeof LOCALE_OPTIONS)[number]["code"];
export type LocaleOption = (typeof LOCALE_OPTIONS)[number];

function getLocaleOption(locale?: string | null): LocaleOption | undefined {
    if (!locale) return undefined;

    const normalized = locale.toLowerCase();

    const exactMatch = LOCALE_OPTIONS.find(
        (option) =>
            option.code.toLowerCase() === normalized ||
            option.aliases.some((alias) => alias === normalized)
    );
    if (exactMatch) return exactMatch;

    return LOCALE_OPTIONS.find((option) => normalized.startsWith(`${option.code.toLowerCase()}-`));
}

export function normalizeLocale(locale?: string | null): Locale {
    return getLocaleOption(locale)?.code ?? "en";
}

export function getLocaleOptions(): readonly LocaleOption[] {
    return LOCALE_OPTIONS;
}

export function getLocaleLabel(locale: string): string {
    return getLocaleOption(locale)?.label ?? locale;
}

export function detectLocale(): Locale {
    if (typeof navigator === "undefined") return "en";

    const candidates = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
    for (const candidate of candidates) {
        const matched = getLocaleOption(candidate);
        if (matched) return matched.code;
    }

    return "en";
}
