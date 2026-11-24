import React from "react";
import { Sun, Moon } from "lucide-react";
import { useI18n } from "../../i18n";
import GradientButton from "../../components/ui/GradientButton";
import { Select } from "../../components/ui/Field";
import { getTheme, toggleTheme, initTheme } from "../../theme";
import appIcon from "../../assets/app-icon.png";
import { getLocaleOptions, type Locale } from "../../i18n/config";

interface WelcomeProps {
    onStart: () => void;
    onImport: () => void;
}

const Welcome: React.FC<WelcomeProps> = ({ onStart, onImport }) => {
    const { t, locale, setLocale } = useI18n();
    const localeOptions = getLocaleOptions();
    React.useEffect(() => {
        // ensure theme applied on first load of welcome page
        initTheme();
    }, []);
    const [theme, setTheme] = React.useState<string>(getTheme());
    return (
        <div className="did-container" style={{ position: "relative", paddingTop: 12 }}>
            <div style={{ position: "absolute", top: "calc(var(--mobile-system-top) + 12px)", left: 0, zIndex: 2 }}>
                <Select
                    aria-label={t("common.language.switch_label")}
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as Locale)}
                >
                    {localeOptions.map((option) => (
                        <option key={option.code} value={option.code}>
                            {option.label}
                        </option>
                    ))}
                </Select>
            </div>
            <button
                onClick={() => setTheme(toggleTheme())}
                aria-label={t("settings.theme")}
                className="ui-icon-button"
                style={{
                    position: "absolute",
                    top: "calc(var(--mobile-system-top) + 10px)",
                    right: 0,
                    width: 36,
                    height: 36,
                    zIndex: 3,
                }}
            >
                {theme === 'dark' ? (
                    <Moon size={18} aria-hidden="true" />
                ) : (
                    <Sun size={18} aria-hidden="true" />
                )}
            </button>

            <div className="page-content" style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: 24,
            }}>
                <div style={{
                    width: 96,
                    height: 96,
                    borderRadius: 24,
                    overflow: "hidden",
                }}>
                    <img
                        src={appIcon}
                        alt="BuckyOS icon"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                </div>
                <div className="page-header" style={{ margin: 0 }}>
                    <div className="page-title">{t("welcome.app_name")}</div>
                    <div className="page-subtitle">{t("welcome.subtitle")}</div>
                </div>
            </div>

            <div className="actions" style={{ gap: 14, display: "flex", flexDirection: "column" }}>
                <GradientButton onClick={onStart} variant="primary">
                    {t("welcome.create_account")}
                </GradientButton>
                <GradientButton variant="secondary" onClick={onImport}>
                    {t("welcome.import_did")}
                </GradientButton>
            </div>
        </div>
    );
};

export default Welcome;
