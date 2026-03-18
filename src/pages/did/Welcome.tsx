import React from "react";
import { Sun, Moon, Globe, ChevronDown } from "lucide-react";
import { useI18n } from "../../i18n";
import GradientButton from "../../components/ui/GradientButton";
import { getTheme, toggleTheme, initTheme } from "../../theme";
import appIcon from "../../assets/app-icon.png";
import { getLocaleOptions, type Locale } from "../../i18n/config";

interface WelcomeProps {
    onStart: () => void;
    onImport: () => void;
    onShowDidInfo: () => void;
}

const Welcome: React.FC<WelcomeProps> = ({ onStart, onImport, onShowDidInfo }) => {
    const { t, locale, setLocale } = useI18n();
    const localeOptions = getLocaleOptions();
    React.useEffect(() => {
        // ensure theme applied on first load of welcome page
        initTheme();
    }, []);
    const [theme, setTheme] = React.useState<string>(getTheme());
    return (
        <div className="did-container" style={{ position: "relative", paddingTop: 12, overflow: "hidden" }}>
            {/* Decorations */}
            <div style={{ position: "absolute", top: 14, left: 14, zIndex: 2 }}>
                <div
                    className="soft-btn"
                    style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        width: 160,
                        height: 36,
                        padding: 0,
                        lineHeight: 1,
                        borderRadius: 18,
                        background: undefined,
                        border: "none",
                        color: "var(--header-icon)",
                        margin: 0,
                    }}
                >
                    <Globe
                        size={18}
                        strokeWidth={2}
                        absoluteStrokeWidth
                        style={{ position: "absolute", left: 14, pointerEvents: "none" }}
                    />
                    <select
                        aria-label={t("common.language.switch_label")}
                        value={locale}
                        onChange={(e) => setLocale(e.target.value as Locale)}
                        style={{
                            width: "100%",
                            height: "100%",
                            padding: "0 34px 0 40px",
                            border: "none",
                            background: "transparent",
                            color: "var(--header-icon)",
                            fontSize: 14,
                            appearance: "none",
                            WebkitAppearance: "none",
                            outline: "none",
                            cursor: "pointer",
                        }}
                    >
                        {localeOptions.map((option) => (
                            <option key={option.code} value={option.code}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        size={16}
                        strokeWidth={2}
                        style={{ position: "absolute", right: 12, pointerEvents: "none" }}
                    />
                </div>
            </div>
            <button
                onClick={() => setTheme(toggleTheme())}
                aria-label="Toggle theme"
                className="theme-toggle-btn soft-btn"
                style={{
                    position: "absolute",
                    top: 14,
                    right: 14,
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    lineHeight: 0,
                    background: undefined,
                    border: "none",
                    color: "var(--header-icon)",
                    zIndex: 3,
                    margin: 0,
                }}
            >
                {theme === 'dark' ? (
                    <Moon size={24} strokeWidth={2.25} color="currentColor" style={{ display: "block" }} stroke="currentColor" fill="none" />
                ) : (
                    <Sun size={24} strokeWidth={2.25} color="currentColor" style={{ display: "block" }} stroke="currentColor" fill="none" />
                )}
            </button>

            {/* background circle textures removed for a cleaner look */}

            <div className="page-content" style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: 24,
            }}>
                <div style={{
                    width: 128,
                    height: 128,
                    borderRadius: 36,
                    boxShadow: "0 24px 48px rgba(104,108,243,0.25), 0 14px 28px rgba(0,0,0,0.08)",
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
                    {t("common.actions.create_did")}
                </GradientButton>
                <GradientButton variant="secondary" onClick={onImport}>
                    {t("welcome.import_did")}
                </GradientButton>
                <button
                    type="button"
                    onClick={onShowDidInfo}
                    style={{
                        fontSize: 14,
                        color: "#2563eb",
                        textAlign: "center",
                        marginTop: 4,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        cursor: "pointer",
                        textDecoration: "none",
                    }}
                >
                    {t("welcome.did_help_link")}
                </button>
            </div>
        </div>
    );
};

export default Welcome;
