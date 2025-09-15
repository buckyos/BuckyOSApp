import React from "react";
import { useI18n } from "../../i18n";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";

interface ShowMnemonicProps {
    mnemonic: string[];
    onNext: () => void;
}

const ShowMnemonic: React.FC<ShowMnemonicProps> = ({ mnemonic, onNext }) => {
    const { t } = useI18n();
    return (
        <div className="did-container" style={{ position: "relative" }}>
            {/* back with label, lighter footprint */}
            <div style={{ position: "absolute", top: 6, left: 6, zIndex: 2 }}>
                <MobileHeader title="" showBack />
            </div>

            {/* background circle textures removed for a cleaner look */}

            {/* center icon + titles */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 12 }}>
                <div style={{
                    width: 64,
                    height: 64,
                    borderRadius: 16,
                    background: "linear-gradient(180deg, #6b6ff3 0%, #7871f3 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    boxShadow: "0 14px 24px rgba(104,108,243,0.18), 0 6px 16px rgba(0,0,0,0.06)",
                }}>
                    {/* document icon */}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <path d="M14 2v6h6"/>
                        <path d="M16 13H8"/>
                        <path d="M16 17H8"/>
                        <path d="M10 9H8"/>
                    </svg>
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--app-text)" }}>{t("showMnemonic.title", "您的助记词")}</div>
                <div style={{ fontSize: 13, color: "var(--muted-text)" }}>{t("showMnemonic.subtitle", "请按准确顺序抄写这些单词")}</div>
            </div>

            {/* mnemonic grid wrapped in soft container */}
            <div className="page-content" style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: 18,
                padding: 10,
                marginTop: 10,
            }}>
                <div
                    className="mnemonic-grid"
                    style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: 10, margin: 0 }}
                >
                    {mnemonic.map((word, index) => (
                        <div key={index} style={{
                            background: "#ffffff80",
                            border: "1px solid var(--border)",
                            borderRadius: 12,
                            height: 44,
                            display: "flex",
                            alignItems: "center",
                            padding: "0 10px",
                            gap: 8,
                            backdropFilter: "saturate(120%) blur(0px)",
                        }}>
                            <span style={{
                                minWidth: 20,
                                height: 24,
                                borderRadius: 999,
                                background: "#eef0fb",
                                color: "#6b6ff3",
                                fontSize: 11,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "0 6px",
                            }}>{index + 1}</span>
                            <span style={{ color: "var(--app-text)", fontWeight: "normal" }}>{word}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* info box */}
            <div className="page-content" style={{
                background: "#f5f6ff",
                color: "#5960a9",
                padding: "10px 12px",
                borderRadius: 14,
                marginTop: 12,
                textAlign: "center",
                fontSize: 13,
                lineHeight: 1.45,
            }}>
                {t("showMnemonic.tips")}
            </div>

            <div className="actions page-content">
                <GradientButton onClick={onNext}>{t("common.actions.backed_up")}</GradientButton>
            </div>
        </div>
    );
};

export default ShowMnemonic;
