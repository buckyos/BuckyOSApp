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
                        <div key={index} className="mnemonic-item">
                            <span className="mnemonic-index">{index + 1}</span>
                            <span style={{ color: "var(--app-text)", fontWeight: "normal" }}>{word}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* info box */}
            <div className="page-content mnemonic-info">
                {t("showMnemonic.tips")}
            </div>

            <div className="actions page-content">
                <GradientButton onClick={onNext}>{t("common.actions.backed_up")}</GradientButton>
            </div>
        </div>
    );
};

export default ShowMnemonic;
