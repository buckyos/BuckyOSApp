import React from "react";
import { useI18n } from "../../i18n";
import MobileHeader from "../../components/ui/MobileHeader";
import GradientButton from "../../components/ui/GradientButton";

interface CreateDidProps {
    nickname: string;
    setNickname: (value: string) => void;
    password: string;
    setPassword: (value: string) => void;
    confirmPassword: string;
    setConfirmPassword: (value: string) => void;
    onNext: () => void;
    error: string;
}

const CreateDid: React.FC<CreateDidProps> = ({
    nickname,
    setNickname,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    onNext,
    error,
}) => {
    const { t } = useI18n();
    const [showPwd, setShowPwd] = React.useState(false);
    const [showPwd2, setShowPwd2] = React.useState(false);
    return (
        <div className="did-container" style={{ position: "relative", overflow: "hidden" }}>
            {/* Header: arrow only, positioned closer to top-left */}
            <div style={{ position: "absolute", top: 6, left: 6, zIndex: 2 }}>
                <MobileHeader title="" showBack />
            </div>

            {/* Page title */}
            <div className="page-content" style={{ textAlign: "center", margin: "36px auto 10px" }}>
                <div className="page-title">{t("create.title_new", "创建新 DID")}</div>
                <div className="page-subtitle">{t("create.subtitle", "Setup your secure DID")}</div>
            </div>

            {/* Nickname */}
            <div className="page-content">
            <label style={{ fontSize: 14, color: "var(--app-text)", marginTop: 6 }}>{t("create.nickname_label", "用户名")}</label>
            <div style={{ position: "relative", marginTop: 6, marginBottom: 12 }}>
                <div style={{ position: "absolute", left: 14, top: 0, bottom: 0, display: "flex", alignItems: "center", color: "var(--muted-text)" }}>
                    {/* user icon */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="3"/>
                    </svg>
                </div>
                <input
                    type="text"
                    placeholder={t("create.nickname_placeholder")}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    style={{ paddingLeft: 40 }}
                />
            </div>

            {/* Password */}
            <label style={{ fontSize: 14, color: "var(--app-text)", marginTop: 6 }}>{t("create.password_label", "密码")}</label>
            <div style={{ position: "relative", marginTop: 6, marginBottom: 12 }}>
                <div style={{ position: "absolute", left: 14, top: 0, bottom: 0, display: "flex", alignItems: "center", color: "var(--muted-text)" }}>
                    {/* lock icon */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="11" width="18" height="10" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                </div>
                <input
                    type={showPwd ? "text" : "password"}
                    placeholder={t("create.password_placeholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ paddingLeft: 40, paddingRight: 40 }}
                />
                <button
                    type="button"
                    aria-label="Toggle password visibility"
                    onClick={() => setShowPwd((v) => !v)}
                    style={{ position: "absolute", right: 6, top: 0, bottom: 0, margin: 0, padding: 8, width: 36, height: 36, background: "transparent", border: "none", boxShadow: "none", color: "var(--muted-text)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                    {showPwd ? (
                        // eye-off
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.11 1 12c.6-1.35 1.46-2.59 2.5-3.68"/>
                            <path d="M10.58 10.58a2 2 0 0 0 2.84 2.84"/>
                            <path d="M23 12c-.62 1.34-1.5 2.57-2.56 3.66"/>
                            <path d="M3 3l18 18"/>
                        </svg>
                    ) : (
                        // eye
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    )}
                </button>
            </div>

            {/* Confirm Password */}
            <label style={{ fontSize: 14, color: "var(--app-text)", marginTop: 6 }}>{t("create.confirm_label", "确认密码")}</label>
            <div style={{ position: "relative", marginTop: 6 }}>
                <div style={{ position: "absolute", left: 14, top: 0, bottom: 0, display: "flex", alignItems: "center", color: "var(--muted-text)" }}>
                    {/* lock icon */}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="3" y="11" width="18" height="10" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                </div>
                <input
                    type={showPwd2 ? "text" : "password"}
                    placeholder={t("create.confirm_password_placeholder")}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    style={{ paddingLeft: 40, paddingRight: 40 }}
                />
                <button
                    type="button"
                    aria-label="Toggle confirm visibility"
                    onClick={() => setShowPwd2((v) => !v)}
                    style={{ position: "absolute", right: 6, top: 0, bottom: 0, margin: 0, padding: 8, width: 36, height: 36, background: "transparent", border: "none", boxShadow: "none", color: "var(--muted-text)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                >
                    {showPwd2 ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.11 1 12c.6-1.35 1.46-2.59 2.5-3.68"/>
                            <path d="M10.58 10.58a2 2 0 0 0 2.84 2.84"/>
                            <path d="M23 12c-.62 1.34-1.5 2.57-2.56 3.66"/>
                            <path d="M3 3l18 18"/>
                        </svg>
                    ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/>
                            <circle cx="12" cy="12" r="3"/>
                        </svg>
                    )}
                </button>
            </div>

            {/* Inline error under inputs */}
            {error && (
                <p className="error" style={{ marginTop: 6 }}>
                    {error}
                </p>
            )}
            </div>

            {/* Bottom actions pinned to page bottom and unified width */}
            <div className="actions page-content">
                <GradientButton onClick={onNext} disabled={!nickname || !password || !confirmPassword}>
                    {t("common.actions.create_did")}
                </GradientButton>
            </div>
        </div>
    );
};

export default CreateDid;
