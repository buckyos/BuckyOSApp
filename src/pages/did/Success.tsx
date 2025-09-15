import React from "react";
import type { DidInfo } from "../../features/did/useDidFlow";
import { useI18n } from "../../i18n";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";

interface SuccessProps {
    didInfo: DidInfo | null;
    onDone: () => void;
}

const Success: React.FC<SuccessProps> = ({ didInfo, onDone }) => {
    const { t } = useI18n();
    return (
        <div className="did-container">
            <MobileHeader title={t("success.title")} />
            <p>{t("success.desc")}</p>
            {didInfo && (
                <div className="did-info">
                    <p>
                        <strong>{t("success.nickname")}</strong> {didInfo.nickname}
                    </p>
                    <p>
                        <strong>{t("success.btc")}</strong> {didInfo.btc_address}
                    </p>
                    <p>
                        <strong>{t("success.eth")}</strong> {didInfo.eth_address}
                    </p>
                </div>
            )}
            <div className="actions">
                <GradientButton onClick={onDone}>{t("common.actions.done")}</GradientButton>
            </div>
        </div>
    );
};

export default Success;
