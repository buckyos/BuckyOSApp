import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import { useI18n } from "../../i18n";

const SnIntro: React.FC = () => {
  const { t } = useI18n();
  return (
    <div className="did-container" style={{ position: "relative" }}>
      <MobileHeader title={t("sn.title")} showBack />
      <div className="page-content" style={{ fontSize: 16, lineHeight: 1.8 }}>
        {t("sn.content")}
      </div>
    </div>
  );
};

export default SnIntro;

