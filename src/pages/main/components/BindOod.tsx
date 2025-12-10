import React from "react";
import GradientButton from "../../../components/ui/GradientButton";
import { useI18n } from "../../../i18n";

type TranslateFn = ReturnType<typeof useI18n>["t"];

interface BindOodProps {
    scanning: boolean;
    scanHint: string;
    onScan: () => Promise<void>;
    t: TranslateFn;
}

const BindOod: React.FC<BindOodProps> = ({ scanning, scanHint, onScan, t }) => {
    return (
        <>
            <div className="sn-loading-card" role="region">
                {!scanning && (
                    <div className="sn-loading-text">{t("ood.activate_desc_inline")}</div>
                )}
                {scanning && (
                    <>
                        <div className="sn-spinner" aria-hidden />
                        <div className="sn-loading-text">{t("ood.scanning")}</div>
                        {!!scanHint && <div className="sn-loading-text">{scanHint}</div>}
                    </>
                )}
            </div>

            <div className="sn-page-actions">
                <GradientButton onClick={onScan} disabled={scanning}>
                    {t("ood.scan_button")}
                </GradientButton>
            </div>
        </>
    );
};

export default BindOod;
