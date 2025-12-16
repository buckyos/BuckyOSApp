import React from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../../i18n";
import GradientButton from "../../../components/ui/GradientButton";
import oodIllustration from "../../../assets/ood.png";

const BindOod: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();

    return (
        <section className="did-section bind-ood-section">
            <header className="home-header">
                <div>
                    <h1>{t("ood.activate_title")}</h1>
                    <p>{t("ood.activate_subtitle")}</p>
                </div>
            </header>

            <div className="ood-info-card bind-ood-info">
                <p>{t("ood.activate_desc_inline")}</p>
            </div>

            <div className="bind-ood-image-wrapper">
                <img src={oodIllustration} alt="OOD illustration" className="bind-ood-image" />
            </div>

            <div className="bind-ood-flex-spacer" />

            <div className="sn-page-actions bind-ood-actions">
                <GradientButton
                    fullWidth
                    onClick={() => navigate("/main/home/ood-scan")}
                >
                    {t("ood.scan_local_button")}
                </GradientButton>
                <GradientButton
                    fullWidth
                    variant="secondary"
                    disabled
                    title={t("ood.manual_url_hint")}
                >
                    {t("ood.manual_url_button")}
                </GradientButton>
            </div>
        </section>
    );
};

export default BindOod;
