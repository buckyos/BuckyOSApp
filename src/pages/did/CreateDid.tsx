import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";
import { useI18n } from "../../i18n";

interface CreateDidProps {
    onNext: () => void;
    onShowDidInfo: () => void;
    onShowSnInfo: () => void;
    error: string;
}

const cardStyle: React.CSSProperties = {
    background: "var(--card-bg)",
    border: "1px solid var(--border)",
    borderRadius: 18,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 8,
};

const linkButtonStyle: React.CSSProperties = {
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    color: "#2563eb",
    padding: 0,
    marginTop: 4,
    fontSize: 14,
    cursor: "pointer",
};

const CreateDid: React.FC<CreateDidProps> = ({ onNext, onShowDidInfo, onShowSnInfo, error }) => {
    const { t } = useI18n();

    return (
        <div className="did-container" style={{ position: "relative", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MobileHeader title={t("create.title_new")} showBack />
            </div>

            <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <p style={{ color: "var(--muted-text)", margin: 0 }}>
                    {t("create.flow_intro")}
                </p>

                <div style={cardStyle}>
                    <strong style={{ fontSize: 16 }}>{t("create.did_card_title")}</strong>
                    <p style={{ margin: 0, color: "var(--muted-text)", lineHeight: 1.5 }}>
                        {t("create.did_card_desc")}
                    </p>
                    <button type="button" onClick={onShowDidInfo} style={linkButtonStyle}>
                        {t("create.learn_more")}
                    </button>
                </div>

                <div style={cardStyle}>
                    <strong style={{ fontSize: 16 }}>{t("create.sn_card_title")}</strong>
                    <p style={{ margin: 0, color: "var(--muted-text)", lineHeight: 1.5 }}>
                        {t("create.sn_card_desc")}
                    </p>
                    <button type="button" onClick={onShowSnInfo} style={linkButtonStyle}>
                        {t("create.learn_more")}
                    </button>
                </div>

                {error ? <p className="error" style={{ margin: 0 }}>{error}</p> : null}
            </div>

            <div className="actions page-content">
                <GradientButton onClick={onNext}>{t("create.start_button")}</GradientButton>
            </div>
        </div>
    );
};

export default CreateDid;
