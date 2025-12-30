import React from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../../i18n";
import GradientButton from "../../../components/ui/GradientButton";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import { checkBuckyUsername, checkSnActiveCode } from "../../../services/sn";
import {
    fetchSnStatus,
    getCachedSnStatus,
    registerSnAccount,
} from "../../../features/sn/snStatusManager";
import type { DidInfo } from "../../../features/did/types";

const SN_USERNAME_MIN_LEN = 5;
const SN_USERNAME_MAX_LEN = 20;
const SN_USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function normalizeSnInput(value: string): string {
    return value.toLowerCase();
}

function isValidSnUsername(raw: string): boolean {
    const name = raw.trim().toLowerCase();
    if (name.length < SN_USERNAME_MIN_LEN || name.length > SN_USERNAME_MAX_LEN) return false;
    return SN_USERNAME_REGEX.test(name);
}

export interface SnStatusSummary {
    initializing: boolean;
    registered: boolean;
    checking: boolean;
    queryFailed: boolean;
    oodBound: boolean;
}

interface BindSnProps {
    activeDid: DidInfo | null | undefined;
    onStatusChange?: (summary: SnStatusSummary) => void;
}

const BindSn: React.FC<BindSnProps> = ({ activeDid, onStatusChange }) => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const [snChecking, setSnChecking] = React.useState(false);
    const [, setSnError] = React.useState<string>("");
    const [snRegistered, setSnRegistered] = React.useState(false);
    const [snInfo, setSnInfo] = React.useState<any>(null);
    const [snUsername, setSnUsername] = React.useState<string>("");
    const [snInvite, setSnInvite] = React.useState<string>("");
    const [snUserValid, setSnUserValid] = React.useState<boolean | null>(null);
    const [snInviteValid, setSnInviteValid] = React.useState<boolean | null>(null);
    const [checkingUser, setCheckingUser] = React.useState(false);
    const [checkingInvite, setCheckingInvite] = React.useState(false);
    const [bindLoading, setBindLoading] = React.useState(false);
    const [bindError, setBindError] = React.useState("");
    const [successDialogOpen, setSuccessDialogOpen] = React.useState(false);
    const [successDialogUsername, setSuccessDialogUsername] = React.useState("");
    const [pendingSuccessDialog, setPendingSuccessDialog] = React.useState(false);
    const [holdRegisteredUi, setHoldRegisteredUi] = React.useState(false);
    const [failureDialogOpen, setFailureDialogOpen] = React.useState(false);
    const [userCheckError, setUserCheckError] = React.useState<string>("");
    const [inviteCheckError, setInviteCheckError] = React.useState<string>("");
    const [snQueryFailed, setSnQueryFailed] = React.useState(false);
    const [initializing, setInitializing] = React.useState<boolean>(true);
    const lastUserCheckedRef = React.useRef<string>("");
    const lastInviteCheckedRef = React.useRef<string>("");
    const snBound = Boolean(snInfo?.user_name);
    const oodBound =
        typeof snInfo?.zone_config === "string" && snInfo.zone_config.trim().length > 0;

    const uiRegistered = snBound && !holdRegisteredUi;
    const formVisible = !snChecking && !snQueryFailed && !uiRegistered;

    React.useEffect(() => {
        onStatusChange?.({
            initializing,
            registered: uiRegistered,
            checking: snChecking,
            queryFailed: snQueryFailed,
            oodBound,
        });
    }, [initializing, uiRegistered, snChecking, snQueryFailed, oodBound, onStatusChange]);

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
                    setSnUsername(normalizeSnInput(cached.username));
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
                    setSnUsername(normalizeSnInput(record.username));
                } else if (!record.registered) {
                    setSnUsername(normalizeSnInput((activeDid.nickname || "").trim()));
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
                    setSnUsername(normalizeSnInput(cached.username));
                } else {
                    setSnUsername(normalizeSnInput((activeDid.nickname || "").trim()));
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
            setUserCheckError("");
            lastUserCheckedRef.current = "";
            setCheckingUser(false);
            return;
        }
        if (!isValidSnUsername(name)) {
            setSnUserValid(null);
            setUserCheckError(t("sn.username_format_hint"));
            lastUserCheckedRef.current = "";
            setCheckingUser(false);
            return;
        }
        const normalized = name.toLowerCase();
        if (normalized === lastUserCheckedRef.current) {
            setCheckingUser(false);
            return;
        }
        setUserCheckError("");
        setCheckingUser(true);
        const timer = setTimeout(async () => {
            try {
                const valid = await checkBuckyUsername(normalized);
                setSnUserValid(valid);
                lastUserCheckedRef.current = normalized;
            } catch (_) {
                setSnUserValid(null);
                setUserCheckError(t("sn.error.check_username_failed"));
            } finally {
                setCheckingUser(false);
            }
        }, 800);
        return () => {
            clearTimeout(timer);
            setCheckingUser(false);
        };
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
        if (bindLoading) return;
        setBindError("");
        setBindLoading(true);
        try {
            const didId = activeDid.id;
            const jwk = JSON.stringify(activeDid.bucky_wallets[0].public_key as any);
            const normalizedUsername = snUsername.trim().toLowerCase();
            const record = await registerSnAccount({
                didId,
                username: normalizedUsername,
                inviteCode: snInvite.trim(),
                publicKeyJwk: jwk,
            });
            setSnRegistered(true);
            setSnInfo(record.info);
            if (record.username) {
                setSnUsername(normalizeSnInput(record.username));
            } else {
                setSnUsername(normalizedUsername);
            }
            const displayUsername = record.username || normalizedUsername;
            setSuccessDialogUsername(displayUsername);
            setHoldRegisteredUi(true);
            setPendingSuccessDialog(true);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (msg === "register_sn_user_failed") {
                setBindError(t("sn.error.register_failed"));
            } else if (msg === "sn_bind_timeout") {
                setBindError(t("sn.error.poll_timeout"));
            } else {
                setBindError(t("sn.error.bind_failed", { message: msg }));
            }
            setFailureDialogOpen(true);
        } finally {
            setBindLoading(false);
        }
    }, [activeDid, bindLoading, snUsername, snInvite, t]);

    React.useEffect(() => {
        if (!pendingSuccessDialog) return;
        if (snRegistered && !snChecking && !snQueryFailed) {
            setSuccessDialogOpen(true);
            setPendingSuccessDialog(false);
        }
    }, [pendingSuccessDialog, snRegistered, snChecking, snQueryFailed]);

    if (!activeDid) {
        return (
            <div className="home-placeholder">{t("sn.no_did_hint")}</div>
        );
    }

    if (uiRegistered && !snChecking && !snQueryFailed && !successDialogOpen && !failureDialogOpen) {
        return null;
    }

    return (
        <>
            <section className="did-section" style={{ marginBottom: 12 }}>
            <header className="home-header">
                <div>
                    <h1>{t("sn.bind_title")}</h1>
                    <p>{t("sn.bind_subtitle") || t("sn.header_desc")}</p>
                </div>
            </header>
            {/* SN 引导暂时隐藏 learn more 链接，避免误导 */}
            {!uiRegistered && (
                <div className="sn-info-card">
                    <div className="sn-info-desc">{t("sn.about_desc")}</div>
                </div>
            )}
            {snChecking && !uiRegistered && (
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
            {!uiRegistered && !snQueryFailed && !snChecking && (
                <>
                    <div className="sn-status" style={{ marginBottom: 8 }}>{t("sn.status_unregistered")}</div>
                    <div className="sn-form">
                        <div>
                            <label style={{ fontSize: 14, color: "var(--app-text)" }}>{t("sn.username_label")}</label>
                            <input
                                type="text"
                                value={snUsername}
                                onChange={(e) => setSnUsername(normalizeSnInput(e.target.value))}
                                placeholder={t("sn.username_placeholder")}
                                style={{ marginTop: 6 }}
                            />
                            {checkingUser && (
                                <div style={{ color: "var(--muted-text)", fontSize: 13, marginTop: 4 }}>{t("sn.username_checking")}</div>
                            )}
                            {!checkingUser && snUserValid === true && (
                                <div style={{ color: "#10b981", fontSize: 13, marginTop: 4 }}>
                                    {t("sn.username_ok", { username: snUsername.trim() || snUsername })}
                                </div>
                            )}
                            {!checkingUser && snUserValid === false && (
                                <div style={{ color: "#ef4444", fontSize: 13, marginTop: 4 }}>{t("sn.username_taken")}</div>
                            )}
                            {userCheckError && (
                                <div style={{ color: "#ef4444", fontSize: 13, marginTop: 4 }}>{userCheckError}</div>
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
                                <div style={{ color: "var(--muted-text)", fontSize: 13, marginTop: 4 }}>{t("sn.invite_checking")}</div>
                            )}
                            {!checkingInvite && snInviteValid === true && (
                                <div style={{ color: "#10b981", fontSize: 13, marginTop: 4 }}>{t("sn.invite_ok")}</div>
                            )}
                            {!checkingInvite && snInviteValid === false && (
                                <div style={{ color: "#ef4444", fontSize: 13, marginTop: 4 }}>{t("sn.invite_bad")}</div>
                            )}
                            {inviteCheckError && (
                                <div style={{ color: "#ef4444", fontSize: 13, marginTop: 4 }}>{inviteCheckError}</div>
                            )}
                        </div>
                    </div>
                    <div className="sn-page-actions">
                        <GradientButton
                            onClick={doBind}
                            disabled={!canBind || checkingUser || checkingInvite || bindLoading}
                        >
                            {t("sn.bind_confirm")}
                        </GradientButton>
                        {bindError && (
                            <div style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{bindError}</div>
                        )}
                    </div>
                </>
            )}
            </section>
            <ConfirmDialog
                open={successDialogOpen}
                title={t("sn.dialog.title")}
                message={t("sn.dialog.register_success_message", { username: successDialogUsername })}
                confirmText={t("sn.dialog.confirm")}
                showCancel={false}
                onConfirm={() => {
                    setSuccessDialogOpen(false);
                    setHoldRegisteredUi(false);
                    navigate("/main/home/ood-activate");
                }}
                onCancel={() => setSuccessDialogOpen(false)}
            />
            <ConfirmDialog
                open={failureDialogOpen}
                title={t("sn.dialog.title")}
                message={t("sn.dialog.register_failed_message")}
                confirmText={t("sn.dialog.confirm")}
                showCancel={false}
                onConfirm={() => setFailureDialogOpen(false)}
                onCancel={() => setFailureDialogOpen(false)}
            />
        </>
    );
};

export default BindSn;
