import React from "react";
import { useI18n } from "../i18n";

const LanguageSwitcher: React.FC = () => {
  const { locale, setLocale, t } = useI18n();

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{t("common.language.switch_label")}:</span>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as any)}
        style={{ padding: "4px 8px" }}
      >
        <option value="en">{t("common.language.en")}</option>
        <option value="zh">{t("common.language.zh")}</option>
      </select>
    </div>
  );
};

export default LanguageSwitcher;

