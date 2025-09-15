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
        <div className="did-container">
            <MobileHeader title={t("showMnemonic.title")} showBack />
            <p>{t("showMnemonic.tips")}</p>
            <div className="mnemonic-grid">
                {mnemonic.map((word, index) => (
                    <div key={index} className="mnemonic-word">{word}</div>
                ))}
            </div>
            <div className="actions">
                <GradientButton onClick={onNext}>{t("common.actions.backed_up")}</GradientButton>
            </div>
        </div>
    );
};

export default ShowMnemonic;
