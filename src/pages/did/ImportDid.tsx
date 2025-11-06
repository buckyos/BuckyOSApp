import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";
import { useI18n } from "../../i18n";

interface ImportDidProps {
    loading: boolean;
    error: string;
    onImport: (payload: { nickname: string; password: string; mnemonicWords: string[] }) => void;
    onBack: () => void;
}

const ImportDid: React.FC<ImportDidProps> = ({ loading, error, onImport, onBack }) => {
    const { t } = useI18n();
    const [nickname, setNickname] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [confirmPassword, setConfirmPassword] = React.useState("");
    const [mnemonicInput, setMnemonicInput] = React.useState("");
    const [localError, setLocalError] = React.useState("");

    const handleSubmit = () => {
        const trimmedMnemonic = mnemonicInput.trim();
        if (!trimmedMnemonic) {
            setLocalError(t("import.error.mnemonic_required"));
            return;
        }
        if (!nickname.trim()) {
            setLocalError(t("import.error.nickname_required"));
            return;
        }
        if (password !== confirmPassword) {
            setLocalError(t("common.error.passwords_mismatch"));
            return;
        }
        if (password.length < 6) {
            setLocalError(t("common.error.password_too_short"));
            return;
        }
        const mnemonicWords = trimmedMnemonic.split(/\s+/).filter(Boolean);
        setLocalError("");
        onImport({ nickname: nickname.trim(), password, mnemonicWords });
    };

    const displayedError = localError || error;

    return (
        <div className="did-container" style={{ position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 6, left: 6, zIndex: 2 }}>
                <MobileHeader title="" showBack onBack={onBack} />
            </div>

            <div className="page-header">
                <div className="page-title">{t("import.title")}</div>
                <div className="page-subtitle">{t("import.subtitle")}</div>
            </div>

            <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>
                        {t("import.mnemonic_label")}
                    </label>
                    <textarea
                        value={mnemonicInput}
                        onChange={(event) => {
                            setMnemonicInput(event.target.value);
                            setLocalError("");
                        }}
                        placeholder={t("import.mnemonic_placeholder")}
                        style={{
                            width: "100%",
                            minHeight: 140,
                            borderRadius: 16,
                            border: "1px solid var(--input-border)",
                            background: "var(--card-bg)",
                            color: "var(--app-text)",
                            padding: "12px 14px",
                            resize: "vertical",                            fontSize: 14,
                            lineHeight: 1.45,
                        }}
                        disabled={loading}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>
                        {t("import.nickname_label")}
                    </label>
                    <input
                        type="text"
                        value={nickname}
                        onChange={(event) => {
                            setNickname(event.target.value);
                            setLocalError("");
                        }}
                        placeholder={t("create.nickname_placeholder")}
                        disabled={loading}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>
                        {t("import.password_label")}
                    </label>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => {
                            setPassword(event.target.value);
                            setLocalError("");
                        }}
                        placeholder={t("create.password_placeholder")}
                        disabled={loading}
                    />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>
                        {t("import.confirm_password_label")}
                    </label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => {
                            setConfirmPassword(event.target.value);
                            setLocalError("");
                        }}
                        placeholder={t("create.confirm_password_placeholder")}
                        disabled={loading}
                    />
                </div>

                {displayedError && (
                    <p className="error" style={{ margin: 0 }}>
                        {displayedError}
                    </p>
                )}
            </div>

            <div className="actions page-content">
                <GradientButton onClick={handleSubmit} disabled={loading}>
                    {t("import.submit")}
                </GradientButton>
            </div>
        </div>
    );
};

export default ImportDid;
