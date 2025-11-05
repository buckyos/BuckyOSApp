import React from "react";
import { useNavigate } from "react-router-dom";
import MobileHeader from "../../components/ui/MobileHeader";
import "./Setting.css";
import InputDialog from "../../components/ui/InputDialog";
import { useI18n } from "../../i18n";
import { useDidContext } from "../../features/did/DidContext";
import { revealMnemonic } from "../../features/did/api";

const IdentityList: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { dids, activeDid, setActiveDid } = useDidContext();

  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [targetName, setTargetName] = React.useState<string>("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const openPasswordDialog = (didId: string) => {
    if (activeDid?.id === didId) return; // clicking current does nothing
    const did = dids.find((d) => d.id === didId);
    const name = (did?.nickname?.trim()?.length ?? 0) > 0 ? did!.nickname : t("common.account.unnamed");
    setTargetId(didId);
    setTargetName(name);
    setPassword("");
    setError("");
  };

  const closePasswordDialog = () => {
    if (loading) return;
    setTargetId(null);
    setTargetName("");
    setPassword("");
    setError("");
  };

  const handleSwitch = async () => {
    if (!targetId) return;
    if (!password.trim()) {
      setError(t("identities.password_required"));
      return;
    }
    setError("");
    setLoading(true);
    try {
      // Use revealMnemonic as a password check for the target identity
      await revealMnemonic(password, targetId);
      await setActiveDid(targetId);
      closePasswordDialog();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("invalid password")) {
        setError(t("identities.error_invalid"));
      } else if (message === "wallet_not_found") {
        setError(t("identities.error_missing"));
      } else {
        setError(t("identities.error_generic", { message }));
      }
    } finally {
      setLoading(false);
    }
  };

  const addIdentity = () => {
    // Open choice sheet: create new or import existing
    setAddOpen(true);
  };

  const [addOpen, setAddOpen] = React.useState(false);
  const goCreate = () => { setAddOpen(false); navigate("/create"); };
  const goImport = () => { setAddOpen(false); navigate("/import"); };

  return (
    <div className="App" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MobileHeader title={t("identities.title")} showBack />
      <div style={{ padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="settings-list">
        {dids.map((did) => {
          const name = did.nickname?.trim()?.length ? did.nickname : t("common.account.unnamed");
          const isActive = activeDid?.id === did.id;
          return (
            <button
              key={did.id}
              onClick={() => openPasswordDialog(did.id)}
              className="settings-item"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
            >
              <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span
                  className="account-avatar"
                  aria-hidden
                  style={{ width: 30, height: 30, borderRadius: 15, fontSize: 14 }}
                >
                  {name.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <span style={{ textAlign: "left", fontWeight: 600 }}>{name}</span>
              </span>
              {isActive ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              )}
            </button>
          );
        })}
        </div>

        <div style={{ height: 12 }} />
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            className="soft-btn"
            onClick={addIdentity}
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 20,
              border: "none",
              color: "#fff",
              background: "linear-gradient(90deg, #6366f1 0%, #6c5ce7 100%)",
            }}
          >
            {t("identities.add_identity")}
          </button>
        </div>
      </div>

      <InputDialog
        open={!!targetId}
        title={t("identities.prompt_password_title")}
        message={t("identities.prompt_password_message", { nickname: targetName })}
        value={password}
        onChange={setPassword}
        inputType="password"
        placeholder={t("identities.password_placeholder")}
        confirmText={loading ? t("identities.loading") : t("identities.confirm")}
        cancelText={t("common.actions.cancel")}
        onConfirm={handleSwitch}
        onCancel={closePasswordDialog}
        loading={loading}
        error={error}
      />

      {addOpen && (
        <div
          role="dialog"
          aria-modal
          onClick={() => setAddOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 440,
              background: "var(--app-bg)",
              color: "var(--app-text)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 16,
              boxShadow: "none",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
              {t("identities.add_identity")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={goCreate}
                style={{
                  height: 44,
                  borderRadius: 12,
                  border: "none",
                  color: "#fff",
                  background: "linear-gradient(90deg, #6366f1 0%, #6c5ce7 100%)",
                }}
              >
                {t("create.title_new")}
              </button>
              <button
                onClick={goImport}
                style={{
                  height: 44,
                  borderRadius: 12,
                  background: "var(--header-btn-bg)",
                  border: "1px solid var(--header-btn-border)",
                  color: "var(--app-text)",
                  fontWeight: 600,
                }}
              >
                {t("welcome.import_did")}
              </button>
              <button
                onClick={() => setAddOpen(false)}
                style={{
                  height: 40,
                  borderRadius: 12,
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--app-text)",
                  fontWeight: 600,
                }}
              >
                {t("common.actions.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IdentityList;
