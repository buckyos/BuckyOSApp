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
    const accountName = didInfo?.nickname?.trim() || t("common.account.unnamed");

    return (
        <div className="did-container" style={{ position: "relative", overflow: "hidden" }}>
            <div
                className="page-content"
                style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    gap: 20,
                }}
            >
                <div
                    aria-hidden="true"
                    style={{
                        width: 88,
                        height: 88,
                        borderRadius: 999,
                        background: "rgba(79,70,229,0.1)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#4f46e5"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <circle cx="12" cy="12" r="9" />
                        <path d="m8.5 12.5 2.3 2.3 4.7-5.1" />
                    </svg>
                </div>

                <div className="page-header" style={{ margin: 0 }}>
                    <div className="page-title">{t("success.title")}</div>
                    <div
                        className="page-subtitle"
                        style={{
                            maxWidth: 328,
                            whiteSpace: "pre-line",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            marginTop: 18,
                        }}
                    >
                        <span>{t("success.desc_primary", { name: accountName })}</span>
                        <span>{t("success.desc_next_step")}</span>
                        <span>{t("success.desc_secondary")}</span>
                    </div>
                </div>

            </div>

            <div className="actions page-content">
                <GradientButton onClick={onDone}>{t("success.bind_ood")}</GradientButton>
            </div>
        </div>
    );
};

export default Success;
