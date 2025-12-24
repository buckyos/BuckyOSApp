import React from "react";
import { useI18n } from "../../../i18n";
import InputDialog from "../../../components/ui/InputDialog";
import GradientButton from "../../../components/ui/GradientButton";
import { checkBuckyUsername, checkSnActiveCode } from "../../../services/sn";
import {
    fetchSnStatus,
    getCachedSnStatus,
    registerSnAccount,
} from "../../../features/sn/snStatusManager";
import type { DidInfo } from "../../../features/did/types";

const SN_BIND_TAG = "[BindSn]";

export interface SnStatusSummary {
    initializing: boolean;
    registered: boolean;
    checking: boolean;
    queryFailed: boolean;
}

interface BindSnProps {
    activeDid: DidInfo | null | undefined;
    onStatusChange?: (summary: SnStatusSummary) => void;
}

const BindSn: React.FC<BindSnProps> = ({ activeDid, onStatusChange }) => {
    const { t } = useI18n();
    const [snChecking, setSnChecking] = React.useState(false);
    const [, setSnError] = React.useState<string>("");
    const [snRegistered, setSnRegistered] = React.useState(false);
    const [, setSnInfo] = React.useState<any>(null);
    const [snUsername, setSnUsername] = React.useState<string>("");
    const [snInvite, setSnInvite] = React.useState<string>("");
    const [snUserValid, setSnUserValid] = React.useState<boolean | null>(null);
    const [snInviteValid, setSnInviteValid] = React.useState<boolean | null>(null);
    const [checkingUser, setCheckingUser] = React.useState(false);
    const [checkingInvite, setCheckingInvite] = React.useState(false);
    const [bindPwdOpen, setBindPwdOpen] = React.useState(false);
    const [bindPwd, setBindPwd] = React.useState("");
    const [bindLoading, setBindLoading] = React.useState(false);
    const [bindErr, setBindErr] = React.useState("");
    const [userCheckError, setUserCheckError] = React.useState<string>("");
    const [inviteCheckError, setInviteCheckError] = React.useState<string>("");
    const [snQueryFailed, setSnQueryFailed] = React.useState(false);
    const [initializing, setInitializing] = React.useState<boolean>(true);
    const lastUserCheckedRef = React.useRef<string>("");
    const lastInviteCheckedRef = React.useRef<string>("");

    const formVisible = !snChecking && !snQueryFailed && !snRegistered;

    React.useEffect(() => {
        onStatusChange?.({
            initializing,
            registered: snRegistered,
            checking: snChecking,
            queryFailed: snQueryFailed,
        });
    }, [initializing, snRegistered, snChecking, snQueryFailed, onStatusChange]);

    const refetchSn = React.useCallback(
        async (force = false) => {
            if (!activeDid || !activeDid.bucky_wallets || activeDid.bucky_wallets.length === 0) return;
            const didId = activeDid.id;
            const jwk = JSON.stringify(activeDid.bucky_wallets[0]?.public_key as any);
            const cached = !force ? await getCachedSnStatus(didId) : undefined;
            if (cached) {
                setSnError("");
                setSnQueryFailed(false);
                setSnRegistered(cached.registered);
                setSnInfo(cached.info);
                if (cached.registered && cached.username) {
                    setSnUsername(cached.username);
                }
                setSnChecking(false);
                setInitializing(false);
                return;
            }
            try {
                setSnChecking(true);
                setSnError("");
                setSnQueryFailed(false);
                const record = await fetchSnStatus(didId, jwk);
                setSnRegistered(record.registered);
                setSnInfo(record.info);
                if (record.registered && record.username) {
                    setSnUsername(record.username);
                } else if (!record.registered) {
                    setSnUsername((activeDid.nickname || "").trim());
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setSnError(t("sn.error.query_failed", { message: msg }));
                setSnRegistered(false);
                setSnQueryFailed(true);
            } finally {
                setSnChecking(false);
                setInitializing(false);
            }
        },
        [activeDid, t]
    );

    React.useEffect(() => {
        let cancelled = false;
        const run = async () => {
            setSnError("");
            setSnRegistered(false);
            setSnQueryFailed(false);
            setSnInfo(null);
            setSnInvite("");
            setSnInviteValid(null);
            setSnUserValid(null);
            setCheckingUser(false);
            setCheckingInvite(false);
            setSnChecking(true);
            setInitializing(!!activeDid);
            if (activeDid) {
                const cached = await getCachedSnStatus(activeDid.id);
                if (cancelled) return;
                if (cached?.registered && cached.username) {
                    setSnUsername(cached.username);
                } else {
                    setSnUsername((activeDid.nickname || "").trim());
                }
            } else {
                setSnUsername("");
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [activeDid]);

    React.useEffect(() => {
        const run = async () => {
            await refetchSn(false);
        };
        run();
    }, [activeDid?.id, refetchSn]);

    React.useEffect(() => {
        if (!formVisible) return;
        const name = snUsername.trim();
        if (!name) {
            setSnUserValid(null);
            return;
        }
        if (name === lastUserCheckedRef.current) return;
        setUserCheckError("");
        setCheckingUser(true);
        const timer = setTimeout(async () => {
            try {
                const valid = await checkBuckyUsername(name);
                setSnUserValid(valid);
                lastUserCheckedRef.current = name;
            } catch (_) {
                setSnUserValid(null);
                setUserCheckError(t("sn.error.check_username_failed"));
            } finally {
                setCheckingUser(false);
            }
        }, 800);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snUsername, formVisible]);

    React.useEffect(() => {
        if (!formVisible) return;
        const code = snInvite.trim();
        if (!code) {
            setSnInviteValid(null);
            return;
        }
        if (code === lastInviteCheckedRef.current) return;
        setInviteCheckError("");
        setCheckingInvite(true);
        const timer = setTimeout(async () => {
            try {
                const valid = await checkSnActiveCode(code);
                setSnInviteValid(valid);
                lastInviteCheckedRef.current = code;
            } catch (_) {
                setSnInviteValid(null);
                setInviteCheckError(t("sn.error.check_invite_failed"));
            } finally {
                setCheckingInvite(false);
            }
        }, 800);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snInvite, formVisible]);

    const canBind = React.useMemo(() => {
        return !snRegistered && snUserValid === true && snInviteValid === true;
    }, [snRegistered, snUserValid, snInviteValid]);

    const doBind = React.useCallback(async () => {
        if (!activeDid) return;
        setBindErr("");
        setBindLoading(true);
        try {
            const didId = activeDid.id;
            const jwk = JSON.stringify(activeDid.bucky_wallets[0].public_key as any);
            const record = await registerSnAccount({
                didId,
                password: bindPwd,
                username: snUsername.trim(),
                inviteCode: snInvite.trim(),
                publicKeyJwk: jwk,
            });
            setSnRegistered(true);
            setSnInfo(record.info);
            if (record.username) {
                setSnUsername(record.username);
            }
            setBindPwd("");
            setBindPwdOpen(false);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg.startsWith("zone_config_failed::")) {
                const detail = msg.split("::")[1] ?? msg;
                setBindErr(t("sn.error.zone_config_failed", { message: detail }));
            } else if (msg === "register_sn_user_failed") {
                setBindErr(t("sn.error.register_failed"));
            } else if (msg === "sn_bind_timeout") {
                setBindErr(t("sn.error.poll_timeout"));
            } else {
                setBindErr(t("sn.error.bind_failed", { message: msg }));
            }
        } finally {
            setBindLoading(false);
        }
    }, [activeDid, bindPwd, snUsername, snInvite, t]);

    if (!activeDid) {
        return (
            <div className="home-placeholder">{t("sn.no_did_hint")}</div>
        );
    }

    if (snRegistered && !snChecking && !snQueryFailed) {
        return null;
    }

    return (
        <section className="did-section" style={{ marginBottom: 12 }}>
            <header className="home-header">
                <div>
                    <h1>{t("sn.bind_title")}</h1>
                    <p>{t("sn.bind_subtitle") || t("sn.header_desc")}</p>
                </div>
            </header>
            {!snRegistered && (
                <div className="sn-info-card">
                    <div className="sn-info-desc">{t("sn.about_desc")}</div>
                    <div className="sn-info-link"><a href="#/sn">{t("sn.learn_more")}</a></div>
                </div>
            )}
            {snChecking && !snRegistered && (
                <div className="sn-loading-card" role="status" aria-live="polite">
                    <div className="sn-spinner" aria-hidden />
                    <div className="sn-loading-text">{t("sn.fetching")}</div>
                </div>
            )}
            {!snChecking && snQueryFailed && (
                <div className="sn-retry-wrapper">
                    <div className="sn-retry-message">
                        <p>{t("sn.fetch_failed")}</p>
                        <p>{t("sn.retry_hint")}</p>
                    </div>
                    <div className="sn-retry-actions">
                        <GradientButton onClick={() => refetchSn(true)}>
                            {t("sn.retry")}
                        </GradientButton>
                    </div>
                </div>
            )}
            {!snRegistered && !snQueryFailed && !snChecking && (
                <>
                    <div className="sn-status" style={{ marginBottom: 8 }}>{t("sn.status_unregistered")}</div>
                    <div className="sn-form">
                        <div>
                            <label style={{ fontSize: 14, color: "var(--app-text)" }}>{t("sn.username_label")}</label>
                            <input
                                type="text"
                                value={snUsername}
                                onChange={(e) => setSnUsername(e.target.value)}
                                placeholder={t("sn.username_placeholder")}
                                style={{ marginTop: 6 }}
                            />
                            {checkingUser && (
                                <div style={{ color: "var(--muted-text)", fontSize: 12, marginTop: 4 }}>{t("sn.username_checking")}</div>
                            )}
                            {!checkingUser && snUserValid === true && (
                                <div style={{ color: "#10b981", fontSize: 12, marginTop: 4 }}>
                                    {t("sn.username_ok", { username: snUsername.trim() || snUsername })}
                                </div>
                            )}
                            {!checkingUser && snUserValid === false && (
                                <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{t("sn.username_taken")}</div>
                            )}
                            {userCheckError && (
                                <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{userCheckError}</div>
                            )}
                        </div>
                        <div>
                            <label style={{ fontSize: 14, color: "var(--app-text)" }}>{t("sn.invite_label")}</label>
                            <input
                                type="text"
                                value={snInvite}
                                onChange={(e) => setSnInvite(e.target.value)}
                                placeholder={t("sn.invite_help")}
                                style={{ marginTop: 6 }}
                            />
                            {checkingInvite && (
                                <div style={{ color: "var(--muted-text)", fontSize: 12, marginTop: 4 }}>{t("sn.invite_checking")}</div>
                            )}
                            {!checkingInvite && snInviteValid === true && (
                                <div style={{ color: "#10b981", fontSize: 12, marginTop: 4 }}>{t("sn.invite_ok")}</div>
                            )}
                            {!checkingInvite && snInviteValid === false && (
                                <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{t("sn.invite_bad")}</div>
                            )}
                            {inviteCheckError && (
                                <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>{inviteCheckError}</div>
                            )}
                        </div>
                    </div>
                    <div className="sn-page-actions">
                        <GradientButton
                            onClick={() => {
                                console.debug(SN_BIND_TAG, "open password dialog");
                                setBindPwd("");
                                setBindErr("");
                                setBindPwdOpen(true);
                            }}
                            disabled={!canBind || checkingUser || checkingInvite}
                        >
                            {t("sn.bind_confirm")}
                        </GradientButton>
                    </div>
                </>
            )}

            <InputDialog
                open={bindPwdOpen}
                title={t("sn.bind_password_title")}
                message={t("sn.bind_password_message")}
                value={bindPwd}
                onChange={setBindPwd}
                inputType="password"
                placeholder={t("sn.bind_password_placeholder")}
                confirmText={t("sn.bind_confirm")}
                cancelText={t("common.actions.cancel")}
                onConfirm={doBind}
                onCancel={() => { if (!bindLoading) { setBindPwdOpen(false); setBindPwd(""); } }}
                loading={bindLoading}
                error={bindErr}
            />
        </section>
    );
};

export default BindSn;
