import React from "react";
import { useI18n } from "../../i18n";
import GradientButton from "../../components/ui/GradientButton";

interface WelcomeProps {
    onStart: () => void;
}

const Welcome: React.FC<WelcomeProps> = ({ onStart }) => {
    const { t } = useI18n();
    const { locale, setLocale } = useI18n();
    const isZh = locale === "zh";
    return (
        <div className="did-container" style={{ position: "relative", paddingTop: 12 }}>
            <div style={{ position: "absolute", top: 8, left: 8, zIndex: 2 }}>
                <button
                    onClick={() => setLocale(isZh ? "en" : "zh")}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        borderRadius: 18,
                        background: "#f3f5ff",
                        border: "1px solid #eef0ff",
                        color: "#0f172a",
                    }}
                >
                    <span>🌐</span>
                    <span>{isZh ? t("common.language.zh") : t("common.language.en")}</span>
                </button>
            </div>

            <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                padding: 24,
            }}>
                <div style={{
                    width: 88,
                    height: 88,
                    borderRadius: 24,
                    background: "#6a6ff3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 36,
                }}>B</div>
                <div style={{ fontSize: 32, fontWeight: 700, color: "#0f172a" }}>{t("welcome.app_name")}</div>
                {/* <div style={{ fontSize: 16, color: "#6b7280" }}>{t("welcome.subtitle")}</div> */}
            </div>

            <div className="actions" style={{ gap: 12, display: "flex", flexDirection: "column" }}>
                <GradientButton onClick={onStart} variant="primary">
                    {t("common.actions.create_did")}
                </GradientButton>
                <GradientButton variant="secondary" onClick={() => alert("Coming soon")}>
                    {t("welcome.import_did")}
                </GradientButton>
            </div>
        </div>
    );
};

export default Welcome;
