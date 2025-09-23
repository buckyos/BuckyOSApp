import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../../i18n";
import ShowMnemonic from "../did/ShowMnemonic";
import ConfirmMnemonic from "../did/ConfirmMnemonic";
import "../../features/did/DidFlowRoutes.css";

interface BackupState {
  mnemonic?: string[];
}

const BackupIdentity: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const state = location.state as BackupState | undefined;
  const mnemonic = state?.mnemonic;

  const [stage, setStage] = React.useState<"show" | "confirm">("show");
  const [confirmedMnemonic, setConfirmedMnemonic] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!mnemonic || mnemonic.length === 0) {
      navigate("/main/setting", { replace: true });
    }
  }, [mnemonic, navigate]);

  React.useEffect(() => {
    // reset state whenever we re-enter with a different mnemonic
    setStage("show");
    setConfirmedMnemonic([]);
  }, [mnemonic?.join(" ")]);

  if (!mnemonic || mnemonic.length === 0) {
    return null;
  }

  if (stage === "show") {
    return (
      <ShowMnemonic
        mnemonic={mnemonic}
        onNext={() => setStage("confirm")}
        onBack={() => navigate("/main/setting", { replace: true })}
      />
    );
  }

  return (
    <ConfirmMnemonic
      mnemonic={mnemonic}
      confirmedMnemonic={confirmedMnemonic}
      setConfirmedMnemonic={setConfirmedMnemonic}
      onConfirm={() => {
        setConfirmedMnemonic([]);
        navigate("/main/home", { replace: true });
      }}
      error=""
      confirmLabel={t("settings.backup_confirm")}
      onBack={() => {
        setConfirmedMnemonic([]);
        setStage("show");
      }}
    />
  );
};

export default BackupIdentity;
