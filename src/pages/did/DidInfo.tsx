import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import { useI18n } from "../../i18n";

interface DidInfoProps {
    onBack: () => void;
}

const DidInfo: React.FC<DidInfoProps> = ({ onBack }) => {
    const { t } = useI18n();
    const bullets = [
        { title: t("didInfo.point1Title"), desc: t("didInfo.point1Desc") },
        { title: t("didInfo.point2Title"), desc: t("didInfo.point2Desc") },
        { title: t("didInfo.point3Title"), desc: t("didInfo.point3Desc") },
    ];

    return (
        <div className="did-container" style={{ padding: 16 }}>
            <MobileHeader title={t("didInfo.title")} showBack onBack={onBack} />
            <div className="page-content" style={{ marginTop: 8 }}>
                <p style={{ color: "var(--muted-text)", lineHeight: 1.5 }}>{t("didInfo.intro")}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
                    {bullets.map((item) => (
                        <div
                            key={item.title}
                            style={{
                                borderRadius: 16,
                                border: "1px solid var(--border)",
                                padding: 16,
                                background: "var(--card-bg, rgba(255,255,255,0.9))",
                            }}
                        >
                            <div style={{ fontWeight: 600, marginBottom: 6 }}>{item.title}</div>
                            <div style={{ color: "var(--muted-text)", lineHeight: 1.4 }}>{item.desc}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DidInfo;
