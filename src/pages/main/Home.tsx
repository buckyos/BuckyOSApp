import React from "react";
import "./Home.css";
import { useDidContext } from "../../features/did/DidContext";
import InputDialog from "../../components/ui/InputDialog";
import { useI18n } from "../../i18n";
import { invoke } from "@tauri-apps/api/core";
import { checkBuckyUsername, checkSnActiveCode, getUserByPublicKey, registerSnUser } from "../../services/sn";
import GradientButton from "../../components/ui/GradientButton";
import BindOod from "./components/BindOod";

// In-memory cache for SN status per DID to avoid repeated queries
const snStatusCache: Record<string, { registered: boolean; info: any } | undefined> = {};

const Home: React.FC = () => {
    const { activeDid } = useDidContext();
    const { t } = useI18n();

    // SN registration/checking
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
    const SN_BIND_TAG = "[SN-BIND]";
    const formVisible = !snChecking && !snQueryFailed && !snRegistered;
    const [initializing, setInitializing] = React.useState<boolean>(true);
    // OOD activation scanning state
    const [scanningOod, setScanningOod] = React.useState(false);
    const [scanHint, setScanHint] = React.useState("");
    const lastUserCheckedRef = React.useRef<string>("");
    const lastInviteCheckedRef = React.useRef<string>("");

    const refetchSn = React.useCallback(async (force = false) => {
        if (!activeDid || !activeDid.bucky_wallets || activeDid.bucky_wallets.length === 0) return;
        const didId = activeDid.id;
        const jwk = activeDid.bucky_wallets[0]?.public_key as any;
        const cached = !force ? snStatusCache[didId] : undefined;
        if (cached) {
            setSnError("");
            setSnQueryFailed(false);
            setSnRegistered(cached.registered);
            setSnInfo(cached.info);
            setSnChecking(false);
            setInitializing(false);
            return;
        }
        try {
            setSnChecking(true);
            setSnError("");
            setSnQueryFailed(false);
            const { ok, raw } = await getUserByPublicKey(JSON.stringify(jwk));
            if (ok) {
                setSnRegistered(true);
                setSnInfo(raw);
                snStatusCache[didId] = { registered: true, info: raw };
            } else {
                setSnRegistered(false);
                setSnInfo(null);
                snStatusCache[didId] = { registered: false, info: null };
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
    }, [activeDid?.id, t]);

    // Reset SN UI when active DID changes
    React.useEffect(() => {
        setSnError("");
        setSnRegistered(false);
        setSnQueryFailed(false);
        setSnInfo(null);
        setSnInvite("");
        setSnInviteValid(null);
        setSnUserValid(null);
        setCheckingUser(false);
        setCheckingInvite(false);
        setSnChecking(true); // show loading
        setInitializing(!!activeDid); // full-screen loading only when DID exists
        if (activeDid) {
            setSnUsername((activeDid.nickname || "").trim());
        } else {
            setSnUsername("");
        }
    }, [activeDid?.id]);

    // Removed immediate username checks to avoid flicker; debounced check handles first render

    // Query SN registration on first load and when active DID changes
    React.useEffect(() => {
        const run = async () => { await refetchSn(false); };
        run();
    }, [activeDid?.id, refetchSn]);

    // removed blur-based validation in favor of debounced checks

    // Debounced validation: username changes → 800ms later check availability
    React.useEffect(() => {
        if (!formVisible) return;
        const name = snUsername.trim();
        if (!name) {
            setSnUserValid(null);
            return;
        }
        if (name === lastUserCheckedRef.current) return;
        setUserCheckError("");
        // Show checking immediately while waiting for debounce
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

    // Debounced validation: invite code changes → 800ms later check validity
    React.useEffect(() => {
        if (!formVisible) return;
        const code = snInvite.trim();
        if (!code) {
            setSnInviteValid(null);
            return;
        }
        if (code === lastInviteCheckedRef.current) return;
        setInviteCheckError("");
        // Show checking immediately while waiting for debounce
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

    // Removed first-visible auto-check; debounced check covers it

    const canBind = React.useMemo(() => {
        return !snRegistered && snUserValid === true && snInviteValid === true;
    }, [snRegistered, snUserValid, snInviteValid]);

    const showOodBind = !initializing && !snChecking && !snQueryFailed && snRegistered;
    const showBindForm = !initializing && !snChecking && !snQueryFailed && !snRegistered;

    const handleOodScan = React.useCallback(async () => {
        setScanHint("");
        setScanningOod(true);
        try {
            await new Promise((r) => setTimeout(r, 1600));
            setScanHint(t("ood.scan_not_found"));
        } finally {
            setScanningOod(false);
        }
    }, [t]);

    const doBind = React.useCallback(async () => {
        if (!activeDid) return;
        setBindErr("");
        setBindLoading(true);
        try {
            const didId = activeDid.id;
            const maskedInvite = (() => {
                const s = snInvite.trim();
                if (!s) return "<empty>";
                if (s.length <= 6) return `${s[0]}***${s[s.length - 1]}(${s.length})`;
                return `${s.slice(0, 2)}***${s.slice(-2)}(${s.length})`;
            })();
            console.debug(SN_BIND_TAG, "start", {
                didId,
                username: snUsername.trim(),
                invite: maskedInvite,
            });
            let jwt: string;
            try {
                console.debug(SN_BIND_TAG, "generate_zone_boot_config_jwt: invoking");
                jwt = await invoke("generate_zone_boot_config_jwt", {
                    password: bindPwd,
                    didId,
                    sn: snUsername.trim(),
                    oodName: "ood1",
                });
                console.debug(SN_BIND_TAG, "generate_zone_boot_config_jwt: success", { jwtLen: typeof jwt === "string" ? jwt.length : -1 });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(SN_BIND_TAG, "generate_zone_boot_config_jwt: error", { msg, err: e });
                setBindErr(t("sn.error.zone_config_failed", { message: msg }));
                return;
            }
            const jwk = JSON.stringify(activeDid.bucky_wallets[0].public_key as any);
            try {
                console.debug(SN_BIND_TAG, "registerSnUser: start");
                const reg = await registerSnUser({
                    userName: snUsername.trim(),
                    activeCode: snInvite.trim(),
                    publicKeyJwk: jwk,
                    zoneConfigJwt: jwt,
                });
                console.debug(SN_BIND_TAG, "registerSnUser: done", { ok: reg.ok, code: (reg as any)?.code });
                if (!reg.ok) {
                    throw new Error("register_sn_user_failed");
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (msg === "register_sn_user_failed") {
                    console.error(SN_BIND_TAG, "registerSnUser: failed");
                    setBindErr(t("sn.error.register_failed"));
                } else {
                    console.error(SN_BIND_TAG, "registerSnUser: error", { msg, err: e });
                    setBindErr(t("sn.error.register_failed_with_reason", { message: msg }));
                }
                return;
            }
            // polling
            let tries = 0;
            let ok = false;
            let info: any = null;
            while (tries < 20) {
                tries += 1;
                try {
                    console.debug(SN_BIND_TAG, "poll", { attempt: tries });
                    const { ok: found, raw } = await getUserByPublicKey(jwk);
                    console.debug(SN_BIND_TAG, "poll result", { attempt: tries, ok: found, hasRaw: !!raw });
                    if (found) {
                        ok = true;
                        info = raw;
                        break;
                    }
                } catch (e) {
                    console.error(SN_BIND_TAG, "poll error", { attempt: tries, err: e });
                }
                await new Promise((r) => setTimeout(r, 2000));
            }
            if (ok) {
                console.debug(SN_BIND_TAG, "bind success");
                setSnRegistered(true);
                setSnInfo(info);
                setBindPwd("");
                setBindPwdOpen(false);
                try {
                    const didId2 = activeDid.id;
                    snStatusCache[didId2] = { registered: true, info };
                } catch (_) { }
            } else {
                console.error(SN_BIND_TAG, "bind timeout: SN user not visible after polling");
                setBindErr(t("sn.error.poll_timeout"));
                return;
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(SN_BIND_TAG, "bind exception", { msg, err: e });
            setBindErr(t("sn.error.bind_failed", { message: msg }));
        } finally {
            setBindLoading(false);
            console.debug(SN_BIND_TAG, "end");
        }
    }, [activeDid?.id, bindPwd, snUsername, snInvite]);

    return (
        <div className="home-wrapper">
            {initializing && (
                <div className="sn-full-loading" role="status" aria-live="polite">
                    <div className="sn-full-spinner" aria-hidden />
                    <div className="sn-full-title">{t("sn.header")}</div>
                    <div className="sn-full-desc">{t("sn.fetching")}</div>
                </div>
            )}
            {!initializing && (
                <>
                    <header className="home-header">
                        <div>
                            <h1>{snRegistered ? t("ood.activate_title") : t("sn.bind_title")}</h1>
                            <p>{snRegistered ? t("ood.activate_subtitle") : t("sn.bind_subtitle")}</p>
                        </div>
                    </header>

                    {!snRegistered && (
                        <div className="sn-info-card">
                            <div className="sn-info-desc">{t("sn.about_desc")}</div>
                            <div className="sn-info-link"><a href="#/sn">{t("sn.learn_more")}</a></div>
                        </div>
                    )}
                </>
            )}
            {!initializing && activeDid ? (
                <section className="did-section" style={{ marginBottom: 12 }}>
                    {/* snChecking handled by loading card below */}
                    {!snChecking && snQueryFailed && (
                        <div style={{ marginTop: 8 }}>
                            <div className="error" style={{ color: "#ef4444", marginBottom: 8 }}>{t("sn.fetch_failed")}</div>
                            <button className="home-refresh" onClick={() => refetchSn(true)}>{t("sn.retry")}</button>
                        </div>
                    )}
                    {!initializing && snChecking && !snRegistered && (
                        <div className="sn-loading-card" role="status" aria-live="polite">
                            <div className="sn-spinner" aria-hidden />
                            <div className="sn-loading-text">{t("sn.fetching")}</div>
                        </div>
                    )}
                    {showOodBind && (
                        <BindOod
                            scanning={scanningOod}
                            scanHint={scanHint}
                            onScan={handleOodScan}
                            t={t}
                        />
                    )}
                    {showBindForm && (
                        <div className="sn-status" style={{ marginBottom: 8 }}>{t("sn.status_unregistered")}</div>
                    )}
                    {showBindForm && (
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
                            {/* Bottom action moved to page footer to avoid overlapping tab bar */}
                        </div>
                    )}
                </section>
            ) : (!initializing ? (
                <div className="home-placeholder">{t("sn.no_did_hint")}</div>
            ) : null)}

            {showBindForm && (
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
        </div>
    );
};

export default Home;
