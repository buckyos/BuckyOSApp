import React from "react";
import { invoke } from "@tauri-apps/api/core";
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
    const [mnemonicWordError, setMnemonicWordError] = React.useState("");
    const validationSeq = React.useRef(0);
    const lastValidated = React.useRef("");

    const validateCompletedWords = React.useCallback(async (value: string) => {
        const endsWithSpace = /\s$/.test(value);
        const words = value.trim().split(/\s+/).filter(Boolean);
        const completedWords = endsWithSpace ? words : words.slice(0, -1);

        if (completedWords.length === 0) {
            setMnemonicWordError("");
            lastValidated.current = "";
            return;
        }

        const validationKey = completedWords.join(" ");
        if (validationKey === lastValidated.current) {
            return;
        }
        lastValidated.current = validationKey;

        const seq = ++validationSeq.current;
        try {
            const invalidWord = await invoke<string | null>("validate_mnemonic_words", {
                words: completedWords,
            });
            if (seq !== validationSeq.current) return;
            if (invalidWord) {
                setMnemonicWordError(
                    t("import.error.invalid_mnemonic_word", { word: invalidWord })
                );
            } else {
                setMnemonicWordError("");
            }
        } catch (err) {
            console.warn("[DID] validate mnemonic words failed", err);
            if (seq === validationSeq.current) {
                setMnemonicWordError("");
            }
        }
    }, [t]);

    const handleSubmit = () => {
        const trimmedMnemonic = mnemonicInput.trim();
        if (!trimmedMnemonic) {
            setLocalError(t("import.error.mnemonic_required"));
            return;
        }
        const trimmedNickname = nickname.trim();
        if (!trimmedNickname) {
            setLocalError(t("import.error.nickname_required"));
            return;
        }
        if (trimmedNickname.length < 5 || trimmedNickname.length > 20) {
            setLocalError(t("import.error.nickname_length"));
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
        onImport({ nickname: trimmedNickname, password, mnemonicWords });
    };

    const displayedError = localError || mnemonicWordError || error;

    return (
        <div className="did-container" style={{ position: "relative", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MobileHeader title={t("import.title")} showBack onBack={onBack} />
            </div>
            <div className="page-content" style={{ marginTop: -8 }}>
                <p style={{ color: "var(--muted-text)", margin: 0 }}>{t("import.subtitle")}</p>
            </div>

            <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>
                        {t("import.mnemonic_label")}
                    </label>
                    <textarea
                        value={mnemonicInput}
                        onChange={(event) => {
                            const { value } = event.target;
                            setMnemonicInput(value);
                            setLocalError("");
                            validateCompletedWords(value);
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
                    <p className="error" style={{ margin: 0, color: "#d64545" }}>
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
