import React from "react";
import { useI18n } from "../i18n";
import { getLocaleOptions, type Locale } from "../i18n/config";

const LanguageSwitcher: React.FC = () => {
    const { locale, setLocale, t } = useI18n();
    const localeOptions = getLocaleOptions();

    return (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>{t("common.language.switch_label")}:</span>
            <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                style={{ padding: "4px 8px" }}
            >
                {localeOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
};

export default LanguageSwitcher;
