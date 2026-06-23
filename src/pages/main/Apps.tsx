import React from "react";
import { PanelsTopLeft } from "lucide-react";
import { useI18n } from "../../i18n";
import "./Apps.css";

const Apps: React.FC = () => {
    const { t } = useI18n();

    return (
        <div className="apps-page">
            <div className="apps-state">
                <PanelsTopLeft className="apps-state-icon" size={22} strokeWidth={1.8} aria-hidden="true" />
                <span>{t("appsPage.empty")}</span>
            </div>
        </div>
    );
};

export default Apps;
