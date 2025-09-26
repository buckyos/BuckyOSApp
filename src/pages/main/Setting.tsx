import React from "react";
import { useNavigate } from "react-router-dom";
import InputDialog from "../../components/ui/InputDialog";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import "./Setting.css";
import { useI18n } from "../../i18n";
import { useDidContext } from "../../features/did/DidContext";
import { deleteDid, revealMnemonic } from "../../features/did/api";

const Setting: React.FC = () => {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const { activeDid, refresh } = useDidContext();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deletePassword, setDeletePassword] = React.useState("");
  const [deleteError, setDeleteError] = React.useState("");
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [backupOpen, setBackupOpen] = React.useState(false);
  const [backupPassword, setBackupPassword] = React.useState("");
  const [backupError, setBackupError] = React.useState("");
  const [backupLoading, setBackupLoading] = React.useState(false);

  const handleDelete = async () => {
    if (!deletePassword.trim()) {
      setDeleteError(t("settings.delete_password_required"));
      return;
    }
    setDeleteError("");
    setDeleteLoading(true);
    try {
      if (!activeDid) {
        setDeleteError(t("settings.delete_error_missing"));
        setDeleteLoading(false);
        return;
      }
      await deleteDid(deletePassword, activeDid.id);
      setDeleteLoading(false);
      setDeleteOpen(false);
      setDeletePassword("");
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invalid password")) {
        setDeleteError(t("settings.delete_error_invalid"));
      } else if (message === "wallet_not_found") {
        setDeleteError(t("settings.delete_error_missing"));
      } else {
        setDeleteError(t("settings.delete_error_generic", { message }));
      }
      setDeleteLoading(false);
    }
  };

  const handleBackup = async () => {
    if (!backupPassword.trim()) {
      setBackupError(t("settings.backup_password_required"));
      return;
    }
    setBackupError("");
    setBackupLoading(true);
    try {
      if (!activeDid) {
        setBackupError(t("settings.backup_error_missing"));
        setBackupLoading(false);
        return;
      }
      const words = await revealMnemonic(backupPassword, activeDid.id);
      setBackupLoading(false);
      setBackupOpen(false);
      setBackupPassword("");
      navigate("/main/setting/backup", { state: { mnemonic: words } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invalid password")) {
        setBackupError(t("settings.backup_error_invalid"));
      } else if (message === "wallet_not_found") {
        setBackupError(t("settings.backup_error_missing"));
      } else {
        setBackupError(t("settings.backup_error_generic", { message }));
      }
      setBackupLoading(false);
    }
  };

  const deleteWarning = activeDid?.nickname
    ? t("settings.delete_warning_named", { nickname: activeDid.nickname })
    : t("settings.delete_warning");
  const deletePasswordMessage = activeDid?.nickname
    ? t("settings.delete_password_message_named", { nickname: activeDid.nickname })
    : t("settings.delete_password_message");

  const openBackupDialog = () => {
    setBackupPassword("");
    setBackupError("");
    setBackupOpen(true);
  };

  const closeBackupDialog = () => {
    if (backupLoading) return;
    setBackupOpen(false);
    setBackupPassword("");
    setBackupError("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 16px 16px" }}>
      <div>
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

          <button className="settings-item" onClick={openBackupDialog}>
            <span className="label">{t("settings.backup_identity")}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <button className="settings-item danger" onClick={() => {
            setDeletePassword("");
            setDeleteError("");
            setDeleteConfirmOpen(true);
          }}>
            <span className="label">{t("settings.delete_account")}</span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title={t("settings.delete_title")}
        message={deleteWarning}
        cancelText={t("common.actions.cancel", { _: "Cancel" })}
        confirmText={t("settings.delete_continue")}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          setDeleteOpen(true);
        }}
      />

      <InputDialog
        open={deleteOpen}
        title={t("settings.delete_title")}
        message={deletePasswordMessage}
        value={deletePassword}
        onChange={setDeletePassword}
        inputType="password"
        placeholder={t("settings.delete_password_placeholder")}
        confirmText={deleteLoading ? t("settings.delete_loading") : t("common.actions.delete", { _: "Delete" })}
        cancelText={t("common.actions.cancel", { _: "Cancel" })}
        onConfirm={handleDelete}
        onCancel={() => {
          if (deleteLoading) return;
          setDeleteOpen(false);
          setDeletePassword("");
          setDeleteError("");
        }}
        loading={deleteLoading}
        error={deleteError}
      />
      <InputDialog
        open={backupOpen}
        title={t("settings.backup_title")}
        message={t("settings.backup_subtitle")}
        value={backupPassword}
        onChange={setBackupPassword}
        inputType="password"
        placeholder={t("settings.backup_password_placeholder")}
        confirmText={backupLoading ? t("settings.backup_loading") : t("settings.backup_submit")}
        cancelText={t("common.actions.cancel", { _: "Cancel" })}
        onConfirm={handleBackup}
        onCancel={closeBackupDialog}
        loading={backupLoading}
        error={backupError}
      />
    </div>
  );
};

export default Setting;
