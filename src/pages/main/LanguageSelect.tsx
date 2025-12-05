import React, { useState } from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import "./LanguageSelect.css";
import { useI18n } from "../../i18n";
import { useNavigate } from "react-router-dom";

const LanguageSelect: React.FC = () => {
    const { locale, setLocale, t } = useI18n();
    const [selected, setSelected] = useState(locale);
    const navigate = useNavigate();

    const save = () => {
        if (selected !== locale) setLocale(selected);
        navigate(-1);
    };

    const Item: React.FC<{ code: "en" | "zh"; label: string }> = ({ code, label }) => (
        <button className="lang-item" onClick={() => setSelected(code)}>
            <span style={{ fontSize: 16 }}>{label}</span>
            <span className="lang-check">
                {selected === code && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                )}
            </span>
        </button>
    );

    return (
        <div className="App" style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <MobileHeader title={t("settings.languages_title")} showBack />
                </div>
                <button
                    onClick={save}
                    className="soft-btn"
                    style={{
                        height: 36,
                        padding: "0 16px",
                        borderRadius: 18,
                        border: "none",
                        color: "var(--app-text)",
                        marginTop: 0,
                        whiteSpace: "nowrap",
                    }}
                >
                    {t("common.actions.save")}
                </button>
            </div>

            <div className="lang-list">
                <Item code="zh" label={t("common.language.zh")} />
                <Item code="en" label={t("common.language.en")} />
            </div>
        </div>
    );
};

export default LanguageSelect;
