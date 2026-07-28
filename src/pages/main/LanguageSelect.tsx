import React, { useState } from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";
import "./LanguageSelect.css";
import { useI18n } from "../../i18n";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { getLocaleOptions, type Locale } from "../../i18n/config";

const LanguageSelect: React.FC = () => {
    const { locale, setLocale, t } = useI18n();
    const [selected, setSelected] = useState(locale);
    const navigate = useNavigate();
    const localeOptions = getLocaleOptions();

    const save = () => {
        if (selected !== locale) setLocale(selected);
        navigate(-1);
    };

    return (
        <div className="mobile-page">
            <MobileHeader title={t("settings.languages_title")} showBack />

            <div className="lang-panel">
                <div className="lang-field-label">{t("common.language.switch_label")}</div>
                <div className="lang-select-wrap">
                    <select
                        className="lang-select"
                        value={selected}
                        onChange={(e) => setSelected(e.target.value as Locale)}
                    >
                        {localeOptions.map((option) => (
                            <option key={option.code} value={option.code}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown size={18} className="lang-select-icon" />
                </div>
            </div>

            <div className="lang-actions">
                <GradientButton onClick={save}>
                    {t("common.actions.save")}
                </GradientButton>
            </div>
        </div>
    );
};

export default LanguageSelect;
