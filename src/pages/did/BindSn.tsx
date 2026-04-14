import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";
import { useI18n } from "../../i18n";
import { checkBuckyUsername, checkSnActiveCode } from "../../services/sn";

const SN_USERNAME_REGEX = /^[a-z0-9.-]+$/;

interface BindSnProps {
    snName: string;
    setSnName: (value: string) => void;
    password: string;
    setPassword: (value: string) => void;
    confirmPassword: string;
    setConfirmPassword: (value: string) => void;
    activeCode: string;
    setActiveCode: (value: string) => void;
    loading: boolean;
    error: string;
    onSubmit: () => void;
    onShowSnInfo: () => void;
}

function normalizeSnInput(value: string): string {
    return value.toLowerCase();
}

function isLocallyValidSnUsername(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized.length >= 7 && SN_USERNAME_REGEX.test(normalized) && !normalized.includes("..");
}

const errorHintStyle: React.CSSProperties = {
    margin: 0,
    color: "#ef4444",
    fontSize: 13,
    display: "flex",
    alignItems: "center",
    gap: 6,
};

const ErrorHint: React.FC<{ message: string }> = ({ message }) => (
    <p className="error" style={errorHintStyle}>
        <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            style={{ flex: "0 0 auto" }}
        >
            <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 5.5v5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="10" cy="13.8" r="1" fill="currentColor" />
        </svg>
        <span>{message}</span>
    </p>
);

const BindSn: React.FC<BindSnProps> = ({
    snName,
    setSnName,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    activeCode,
    setActiveCode,
    loading,
    error,
    onSubmit,
    onShowSnInfo,
}) => {
    const { t } = useI18n();
    const [nameValid, setNameValid] = React.useState<boolean | null>(null);
    const [activeCodeValid, setActiveCodeValid] = React.useState<boolean | null>(null);
    const [checkingName, setCheckingName] = React.useState(false);
    const [checkingCode, setCheckingCode] = React.useState(false);
    const [usernameError, setUsernameError] = React.useState("");
    const [inviteError, setInviteError] = React.useState("");

    React.useEffect(() => {
        const normalized = snName.trim().toLowerCase();
        if (!normalized) {
            setNameValid(null);
            setUsernameError("");
            return;
        }
        if (!isLocallyValidSnUsername(normalized)) {
            setNameValid(null);
            setUsernameError(t("sn.username_format_hint"));
            return;
        }

        setUsernameError("");
        setCheckingName(true);
        const timer = setTimeout(async () => {
            try {
                setNameValid(await checkBuckyUsername(normalized));
            } catch (err) {
                setNameValid(null);
                const message = err instanceof Error ? err.message : String(err);
                setUsernameError(message === "sn_check_timeout" ? t("sn.error.check_timeout") : t("sn.error.check_username_failed"));
            } finally {
                setCheckingName(false);
            }
        }, 500);

        return () => {
            clearTimeout(timer);
            setCheckingName(false);
        };
    }, [snName, t]);

    React.useEffect(() => {
        const code = activeCode.trim();
        if (!code) {
            setActiveCodeValid(null);
            setInviteError("");
            return;
        }

        setInviteError("");
        setCheckingCode(true);
        const timer = setTimeout(async () => {
            try {
                setActiveCodeValid(await checkSnActiveCode(code));
            } catch (err) {
                setActiveCodeValid(null);
                const message = err instanceof Error ? err.message : String(err);
                setInviteError(message === "sn_check_timeout" ? t("sn.error.check_timeout") : t("sn.error.check_invite_failed"));
            } finally {
                setCheckingCode(false);
            }
        }, 500);

        return () => {
            clearTimeout(timer);
            setCheckingCode(false);
        };
    }, [activeCode]);

    const canSubmit =
        !loading &&
        nameValid === true &&
        activeCodeValid === true &&
        password.length >= 6 &&
        confirmPassword.length >= 6 &&
        password === confirmPassword;

    const displayedError = error;

    return (
        <div className="did-container" style={{ position: "relative", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <MobileHeader
                    title={t("sn.bind_title")}
                    showBack
                    rightSlot={
                        <button
                            type="button"
                            aria-label={t("sn.learn_more")}
                            onClick={onShowSnInfo}
                            style={{
                                width: 28,
                                height: 28,
                                borderRadius: 999,
                                border: "1px solid var(--border)",
                                background: "var(--card-bg)",
                                color: "var(--muted-text)",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: 0,
                                cursor: "pointer",
                                boxShadow: "none",
                            }}
                        >
                            <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                            >
                                <circle cx="12" cy="12" r="9" />
                                <path d="M9.09 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
                                <path d="M12 17h.01" />
                            </svg>
                        </button>
                    }
                />
            </div>

            <div className="page-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>{t("sn.username_label")}</label>
                    <input
                        type="text"
                        value={snName}
                        onChange={(event) => setSnName(normalizeSnInput(event.target.value))}
                        placeholder={t("sn.username_placeholder")}
                        disabled={loading}
                    />
                    {checkingName ? (
                        <p style={{ margin: 0, color: "var(--muted-text)", fontSize: 13 }}>{t("sn.username_checking")}</p>
                    ) : nameValid === true ? (
                        <p style={{ margin: 0, color: "#16a34a", fontSize: 13 }}>{t("sn.username_ok", { username: snName.trim().toLowerCase() })}</p>
                    ) : nameValid === false ? (
                        <ErrorHint message={t("sn.username_taken")} />
                    ) : usernameError ? (
                        <ErrorHint message={usernameError} />
                    ) : null}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>{t("create.password_label")}</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={t("create.password_placeholder")}
                        disabled={loading}
                    />
                    {password.length > 0 && password.length < 6 ? <ErrorHint message={t("common.error.password_too_short")} /> : null}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>{t("create.confirm_label")}</label>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder={t("create.confirm_password_placeholder")}
                        disabled={loading}
                    />
                    {confirmPassword.length > 0 && password !== confirmPassword ? <ErrorHint message={t("common.error.passwords_mismatch")} /> : null}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <label style={{ fontSize: 14, color: "var(--muted-text)" }}>{t("sn.invite_label")}</label>
                    <input
                        type="text"
                        value={activeCode}
                        onChange={(event) => setActiveCode(event.target.value)}
                        placeholder={t("sn.invite_placeholder")}
                        disabled={loading}
                    />
                    {checkingCode ? (
                        <p style={{ margin: 0, color: "var(--muted-text)", fontSize: 13 }}>{t("sn.invite_checking")}</p>
                    ) : activeCodeValid === true ? (
                        <p style={{ margin: 0, color: "#16a34a", fontSize: 13 }}>{t("sn.invite_ok")}</p>
                    ) : activeCodeValid === false ? (
                        <ErrorHint message={t("sn.invite_bad")} />
                    ) : inviteError ? (
                        <ErrorHint message={inviteError} />
                    ) : null}
                </div>

                {displayedError ? <ErrorHint message={displayedError} /> : null}
            </div>

            <div className="actions page-content">
                <GradientButton onClick={onSubmit} disabled={!canSubmit}>
                    {t("sn.bind_confirm")}
                </GradientButton>
            </div>
        </div>
    );
};

export default BindSn;
