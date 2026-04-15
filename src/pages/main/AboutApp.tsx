import React from "react";
import { getVersion } from "@tauri-apps/api/app";
import MobileHeader from "../../components/ui/MobileHeader";
import { useI18n } from "../../i18n";
import appIcon from "../../assets/app-icon.png";
import "./AboutApp.css";

const AboutApp: React.FC = () => {
    const { t } = useI18n();
    const [appVersion, setAppVersion] = React.useState("Unknown");

    React.useEffect(() => {
        let cancelled = false;

        const loadVersion = async () => {
            try {
                const version = await getVersion();
                if (!cancelled) {
                    setAppVersion(version);
                }
            } catch (err) {
                console.warn("[AboutApp] failed to load app version", err);
            }
        };

        void loadVersion();

        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="App about-app-page">
            <MobileHeader title={t("settings.about_title")} showBack />

            <div className="about-app-content">
                <div className="about-app-logo-wrap">
                    <img src={appIcon} alt="BuckyOSApp logo" className="about-app-logo" />
                </div>
                <div className="about-app-version-label">{t("settings.about_version")}</div>
                <div className="about-app-version">
                    {appVersion === "Unknown" ? appVersion : `${appVersion} (Beta)`}
                </div>
            </div>
        </div>
    );
};

export default AboutApp;
