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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MobileHeader title={t("showMnemonic.title")} showBack onBack={onBack} />
            </div>
            <div className="page-content" style={{ marginTop: -8 }}>
                <p style={{ color: "var(--muted-text)", margin: 0 }}>{t("showMnemonic.subtitle")}</p>
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
