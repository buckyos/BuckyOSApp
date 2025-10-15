import React from "react";
import type { DidInfo } from "../../features/did/useDidFlow";
import { useI18n } from "../../i18n";
import GradientButton from "../../components/ui/GradientButton";

interface SuccessProps {
    didInfo: DidInfo | null;
    onDone: () => void;
}

const Success: React.FC<SuccessProps> = ({ didInfo, onDone }) => {
    const { t } = useI18n();
    return (
        <div className="did-container">
            <div className="page-header">
                <div className="page-title">{t("success.title")}</div>
                <div className="page-subtitle">{t("success.desc")}</div>
            </div>
            {didInfo && (
                <div className="did-info">
                    <p>
                        <strong>{t("success.nickname")}</strong> {didInfo.nickname}
                    </p>
                    {didInfo.buckyos_identity?.did && (
                        <p>
                            <strong>{t("success.did")}</strong> {didInfo.buckyos_identity.did}
                        </p>
                    )}
                    {didInfo.btc_addresses.map((item) => (
                        <p key={`btc-${item.address_type}-${item.index}`}>
                            <strong>{t("success.btc")}</strong> [{item.address_type}] #{item.index} {item.address}
                        </p>
                    ))}
                    {didInfo.eth_addresses.map((item) => (
                        <p key={`eth-${item.index}`}>
                            <strong>{t("success.eth")}</strong> #{item.index} {item.address}
                        </p>
                    ))}
                </div>
            )}
            <div className="actions">
                <GradientButton onClick={onDone}>{t("common.actions.done")}</GradientButton>
            </div>
        </div>
    );
};

export default Success;
