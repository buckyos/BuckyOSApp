import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import { useI18n } from "../../i18n";
import appIcon from "../../assets/app-icon.png";
import "./AboutApp.css";

const APP_VERSION = "1.0.0(Beta)";

const AboutApp: React.FC = () => {
    const { t } = useI18n();

    return (
        <div className="App about-app-page">
            <MobileHeader title={t("settings.about_title")} showBack />

            <div className="about-app-content">
                <div className="about-app-logo-wrap">
                    <img src={appIcon} alt="BuckyOSApp logo" className="about-app-logo" />
                </div>
                <div className="about-app-version-label">{t("settings.about_version")}</div>
                <div className="about-app-version">{APP_VERSION}</div>
            </div>
        </div>
    );
};

export default AboutApp;
