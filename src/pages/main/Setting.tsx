import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import MobileHeader from "../../components/ui/MobileHeader";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import "./Setting.css";
import { useI18n } from "../../i18n";

const Setting: React.FC = () => {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [open, setOpen] = React.useState(false);

  const handleDelete = async () => {
    try {
      await invoke("delete_wallet");
      setOpen(false);
      navigate("/", { replace: true });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MobileHeader title={t("settings.title")} />
      <div style={{ padding: 12 }}>
        <div className="settings-list">
          <button className="settings-item" onClick={() => navigate("/main/setting/language")}> 
            <span className="label">{t("settings.language")}</span>
            <span className="right">
              <span>{locale === "zh" ? t("common.language.zh") : t("common.language.en")}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </button>

          <button className="settings-item danger" onClick={() => setOpen(true)}>
            <span className="label">{t("settings.delete_account")}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={open}
        title={t("settings.delete_title")}
        message={t("settings.delete_confirm")}
        cancelText={t("common.actions.cancel", { _: "Cancel" })}
        confirmText={t("common.actions.delete", { _: "Delete" })}
        onCancel={() => setOpen(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default Setting;
