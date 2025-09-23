import React from "react";
import { useI18n } from "../../i18n";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";

interface ShowMnemonicProps {
    mnemonic: string[];
    onNext: () => void;
    onBack?: () => void;
}

const ShowMnemonic: React.FC<ShowMnemonicProps> = ({ mnemonic, onNext, onBack }) => {
    const { t } = useI18n();
    return (
        <div className="did-container" style={{ position: "relative" }}>
            {/* back with label, lighter footprint */}
            <div style={{ position: "absolute", top: 6, left: 6, zIndex: 2 }}>
                <MobileHeader title="" showBack onBack={onBack} />
            </div>

            {/* background circle textures removed for a cleaner look */}

            {/* titles only (icon removed to save vertical space) */}
            <div className="page-header">
                <div className="page-title">{t("showMnemonic.title")}</div>
                <div className="page-subtitle">{t("showMnemonic.subtitle")}</div>
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
