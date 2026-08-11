import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";
import { useI18n } from "../../i18n";
import { checkSnActiveCode, checkSnUsername, isLocallyValidEmail } from "../../services/sn_client";
import { isLocallyValidSnUsername, normalizeSnUsername } from "../../features/sn/snUsername";
import type { RegistrationMaterial, RegistrationPhase } from "../../features/did/types";
import { avatarDisplayUrl } from "../../features/did/ownerDocument";

interface BindSnProps {
    snName: string;
    setSnName: (value: string) => void;
    fullName: string;
    setFullName: (value: string) => void;
    email: string;
    setEmail: (value: string) => void;
    avatarSeed: string;
    setAvatarSeed: (value: string) => void;
    registrationMaterial: RegistrationMaterial | null;
    registrationPhase: RegistrationPhase;
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

const Field: React.FC<React.PropsWithChildren<{ label: string }>> = ({ label, children }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 14, color: "var(--muted-text)" }}>{label}</label>
        {children}
    </div>
);

const BindSn: React.FC<BindSnProps> = ({
    snName,
    setSnName,
    fullName,
    setFullName,
    email,
    setEmail,
    avatarSeed,
    setAvatarSeed,
    registrationMaterial,
    registrationPhase,
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
    const [avatarOptions] = React.useState(() => [
        avatarSeed,
        `${avatarSeed}-aurora`,
        `${avatarSeed}-forest`,
        `${avatarSeed}-violet`,
    ]);

    React.useEffect(() => {
        const normalized = normalizeSnUsername(snName);
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
                const result = await checkSnUsername(normalized);
                setNameValid(result.valid);
                if (result.valid && result.normalized_name && result.normalized_name !== snName) {
                    setSnName(result.normalized_name);
                }
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
    }, [snName, setSnName, t]);

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
    }, [activeCode, t]);

    const trimmedEmail = email.trim();
    const canSubmit =
        !loading &&
        nameValid === true &&
        activeCodeValid === true &&
        fullName.trim().length > 0 &&
        isLocallyValidEmail(trimmedEmail) &&
        Boolean(registrationMaterial?.evm_address) &&
        password.length >= 6 &&
        confirmPassword.length >= 6 &&
        password === confirmPassword;

    return (
        <div className="did-container" style={{ position: "relative" }}>
            <MobileHeader
                title={t("sn.identity_title")}
                showBack
                rightSlot={
                    <button type="button" className="icon-help-button" onClick={onShowSnInfo} aria-label={t("sn.learn_more")}>
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

            <div className="page-content identity-form">
                <p className="identity-form-intro">{t("sn.identity_subtitle")}</p>

                <Field label={t("sn.username_label")}>
                    <input
                        type="text"
                        value={snName}
                        onChange={(event) => setSnName(event.target.value.toLowerCase())}
                        placeholder={t("sn.username_placeholder")}
                        disabled={loading}
                    />
                    {checkingName ? (
                        <p className="field-hint">{t("sn.username_checking")}</p>
                    ) : nameValid === true ? (
                        <p
                            className="field-success"
                            style={{ overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.6 }}
                        >
                            {t("sn.username_ok", { username: normalizeSnUsername(snName) })}
                        </p>
                    ) : nameValid === false ? (
                        <ErrorHint message={t("sn.username_taken")} />
                    ) : usernameError ? (
                        <ErrorHint message={usernameError} />
                    ) : null}
                </Field>

                <Field label={t("sn.full_name_label")}>
                    <input
                        type="text"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        placeholder={t("sn.full_name_placeholder")}
                        maxLength={256}
                        autoComplete="name"
                        disabled={loading}
                    />
                </Field>

                <Field label={t("sn.email_label")}>
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder={t("sn.email_placeholder")}
                        maxLength={320}
                        autoComplete="email"
                        disabled={loading}
                    />
                    <p className="field-hint">{t("sn.email_privacy_hint")}</p>
                    {trimmedEmail && !isLocallyValidEmail(trimmedEmail) ? <ErrorHint message={t("sn.error.invalid_email")} /> : null}
                </Field>

                <Field label={t("sn.avatar_label")}>
                    <div className="avatar-picker" role="radiogroup" aria-label={t("sn.avatar_label")}>
                        {avatarOptions.map((seed) => {
                            const source = avatarDisplayUrl(`dicebear:${seed}`);
                            const selected = avatarSeed === seed;
                            return (
                                <button
                                    type="button"
                                    className={`avatar-choice${selected ? " selected" : ""}`}
                                    key={seed}
                                    onClick={() => setAvatarSeed(seed)}
                                    role="radio"
                                    aria-checked={selected}
                                    disabled={loading}
                                >
                                    {source ? <img src={source} alt="" /> : <span>{seed.slice(0, 2).toUpperCase()}</span>}
                                </button>
                            );
                        })}
                    </div>
                </Field>

                <Field label={t("sn.evm_owner_label")}>
                    <div className="evm-owner-card">
                        <code>{registrationMaterial?.evm_address ?? t("sn.evm_owner_preparing")}</code>
                        <span>{t("sn.evm_owner_hint")}</span>
                    </div>
                </Field>

                <Field label={t("create.password_label")}>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={t("create.password_placeholder")}
                        autoComplete="new-password"
                        disabled={loading}
                    />
                    {password.length > 0 && password.length < 6 ? <ErrorHint message={t("common.error.password_too_short")} /> : null}
                </Field>

                <Field label={t("create.confirm_label")}>
                    <input
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder={t("create.confirm_password_placeholder")}
                        autoComplete="new-password"
                        disabled={loading}
                    />
                    {confirmPassword.length > 0 && password !== confirmPassword ? <ErrorHint message={t("common.error.passwords_mismatch")} /> : null}
                </Field>

                <Field label={t("sn.invite_label")}>
                    <input
                        type="text"
                        value={activeCode}
                        onChange={(event) => setActiveCode(event.target.value)}
                        placeholder={t("sn.invite_placeholder")}
                        disabled={loading}
                    />
                    {checkingCode ? (
                        <p className="field-hint">{t("sn.invite_checking")}</p>
                    ) : activeCodeValid === true ? (
                        <p className="field-success">{t("sn.invite_ok")}</p>
                    ) : activeCodeValid === false ? (
                        <ErrorHint message={t("sn.invite_bad")} />
                    ) : inviteError ? (
                        <ErrorHint message={inviteError} />
                    ) : null}
                </Field>

                {registrationPhase === "submitting" ? (
                    <div className="registration-progress" role="status">{t("sn.submitting_hint")}</div>
                ) : null}
                {error ? <ErrorHint message={error} /> : null}
            </div>

            <div className="actions page-content">
                <GradientButton onClick={onSubmit} disabled={!canSubmit}>
                    {t("sn.register_identity_confirm")}
                </GradientButton>
            </div>
        </div>
    );
};

export default BindSn;
