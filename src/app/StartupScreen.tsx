import appIcon from "../assets/app-icon.png";
import { useI18n } from "../i18n";
import "./StartupScreen.css";

export default function StartupScreen() {
    const { t } = useI18n();
    return (
        <div className="startup-screen" role="status" aria-live="polite">
            <img src={appIcon} width={64} height={64} alt="" />
            <strong>BuckyOS</strong>
            <span>{t("common.starting")}</span>
        </div>
    );
}
