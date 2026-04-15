import React from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../../i18n";
import GradientButton from "../../../components/ui/GradientButton";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import InputDialog from "../../../components/ui/InputDialog";
import oodIllustration from "../../../assets/ood.png";
import { useDidContext } from "../../../features/did/DidContext";
import { signJsonWithActiveDid } from "../../../features/did/api";
import { fetchSnStatus, getCachedSnStatus, setCachedSnStatus } from "../../../features/sn/snStatusManager";
import { unbindZoneConfig } from "../../../services/sn";
import { parseCommandError } from "../../../utils/commandError";
import { CommandErrorCodes } from "../../../constants/commandErrorCodes";

const BindOod: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { activeDid } = useDidContext();
    const [hasBoundOod, setHasBoundOod] = React.useState(false);
    const [confirmUnbindOpen, setConfirmUnbindOpen] = React.useState(false);
    const [passwordDialogOpen, setPasswordDialogOpen] = React.useState(false);
    const [password, setPassword] = React.useState("");
    const [passwordError, setPasswordError] = React.useState("");
    const [unbindLoading, setUnbindLoading] = React.useState(false);
    const [resultDialog, setResultDialog] = React.useState<{ open: boolean; title: string; message: string }>({
        open: false,
        title: "",
        message: "",
    });

    React.useEffect(() => {
        let cancelled = false;

        const loadOodBinding = async () => {
            if (!activeDid?.id || !activeDid.bucky_wallets?.length) {
                if (!cancelled) setHasBoundOod(false);
                return;
            }

            const cached = await getCachedSnStatus(activeDid.id);
            const cachedZoneConfig =
                typeof cached?.zoneConfig === "string" ? cached.zoneConfig.trim() : "";
            if (cachedZoneConfig) {
                if (!cancelled) setHasBoundOod(true);
                return;
            }

            try {
                const publicKeyJwk = JSON.stringify(activeDid.bucky_wallets[0].public_key as any);
                const record = await fetchSnStatus(activeDid.id, publicKeyJwk);
                const fetchedZoneConfig =
                    typeof record.zoneConfig === "string" ? record.zoneConfig.trim() : "";
                if (!cancelled) {
                    setHasBoundOod(Boolean(fetchedZoneConfig));
                }
            } catch (err) {
                console.warn("[OOD] failed to load binding status", err);
                if (!cancelled) {
                    setHasBoundOod(false);
                }
            }
        };

        void loadOodBinding();

        return () => {
            cancelled = true;
        };
    }, [activeDid]);

    const openResultDialog = React.useCallback((title: string, message: string) => {
        setResultDialog({ open: true, title, message });
    }, []);

    const handleStartUnbind = React.useCallback(() => {
        setConfirmUnbindOpen(false);
        setPassword("");
        setPasswordError("");
        setPasswordDialogOpen(true);
    }, []);

    const handleConfirmPassword = React.useCallback(async () => {
        const trimmedPassword = password.trim();
        if (!trimmedPassword) {
            setPasswordError(t("ood.unbind_password_required"));
            return;
        }
        if (!activeDid?.id) {
            setPasswordDialogOpen(false);
            openResultDialog(t("ood.unbind_result_failed_title"), t("ood.unbind_no_identity"));
            return;
        }

        const cached = await getCachedSnStatus(activeDid.id);
        const userName =
            (typeof cached?.username === "string" && cached.username.trim()) ||
            (typeof activeDid.sn_status?.username === "string" && activeDid.sn_status.username.trim()) ||
            "";

        if (!userName) {
            setPasswordDialogOpen(false);
            openResultDialog(t("ood.unbind_result_failed_title"), t("ood.unbind_missing_username"));
            return;
        }

        setUnbindLoading(true);
        setPasswordError("");
        try {
            const now = Math.floor(Date.now() / 1000);
            const [token] = await signJsonWithActiveDid(trimmedPassword, [{
                sub: userName,
                iat: now,
                exp: now + 300,
            }]);
            if (!token) {
                throw new Error("unbind_sign_failed");
            }

            await unbindZoneConfig(userName, token);
            await setCachedSnStatus(activeDid.id, {
                info: {
                    ...(cached?.info ?? {}),
                    user_name: userName,
                    zone_config: "",
                },
                username: userName,
                zoneConfig: null,
            });
            setHasBoundOod(false);
            setPasswordDialogOpen(false);
            setPassword("");
            openResultDialog(t("ood.unbind_result_success_title"), t("ood.unbind_result_success_message"));
        } catch (err) {
            const { code, message } = parseCommandError(err);
            if (code === CommandErrorCodes.InvalidPassword || message.includes("invalid_password")) {
                setPasswordError(t("ood.unbind_password_invalid"));
                return;
            }
            setPasswordDialogOpen(false);
            openResultDialog(
                t("ood.unbind_result_failed_title"),
                message === "sn_unbind_timeout"
                    ? t("ood.unbind_result_timeout_message")
                    : t("ood.unbind_result_failed_message", { message })
            );
        } finally {
            setUnbindLoading(false);
        }
    }, [password, t, activeDid, openResultDialog]);

    return (
        <section className="did-section bind-ood-section">
            <header className="home-header">
                <div>
                    <h1>{hasBoundOod ? t("ood.bound_title") : t("ood.activate_title")}</h1>
                    <p>{hasBoundOod ? t("ood.bound_subtitle") : t("ood.activate_subtitle")}</p>
                </div>
            </header>

            <div className="ood-info-card bind-ood-info">
                <p>{hasBoundOod ? t("ood.bound_desc") : t("ood.activate_desc_inline")}</p>
            </div>

            <div className="bind-ood-image-wrapper">
                <img src={oodIllustration} alt="OOD illustration" className="bind-ood-image" />
            </div>

            <div className="bind-ood-flex-spacer" />

            <div className="sn-page-actions bind-ood-actions">
                {hasBoundOod ? (
                    <>
                        <GradientButton
                            fullWidth
                            onClick={() => navigate("/main/apps")}
                        >
                            {t("tabs.apps")}
                        </GradientButton>
                        <GradientButton
                            fullWidth
                            variant="secondary"
                            onClick={() => setConfirmUnbindOpen(true)}
                        >
                            {t("ood.unbind_button")}
                        </GradientButton>
                    </>
                ) : (
                    <>
                        <GradientButton
                            fullWidth
                            onClick={() => navigate("/main/home/ood-scan")}
                        >
                            {t("ood.scan_local_button")}
                        </GradientButton>
                        <GradientButton
                            fullWidth
                            variant="secondary"
                            disabled
                            title={t("ood.manual_url_hint")}
                        >
                            {t("ood.manual_url_button")}
                        </GradientButton>
                    </>
                )}
            </div>

            <ConfirmDialog
                open={confirmUnbindOpen}
                title={t("ood.unbind_confirm_title")}
                message={t("ood.unbind_confirm_message")}
                confirmText={t("ood.unbind_continue")}
                cancelText={t("common.actions.cancel")}
                confirmVariant="danger"
                onConfirm={handleStartUnbind}
                onCancel={() => setConfirmUnbindOpen(false)}
            />

            <InputDialog
                open={passwordDialogOpen}
                title={t("ood.unbind_password_title")}
                message={t("ood.unbind_password_message")}
                value={password}
                onChange={(value) => {
                    setPassword(value);
                    setPasswordError("");
                }}
                inputType="password"
                placeholder={t("ood.unbind_password_placeholder")}
                confirmText={unbindLoading ? t("ood.unbind_loading") : t("ood.unbind_continue")}
                cancelText={t("common.actions.cancel")}
                onConfirm={handleConfirmPassword}
                onCancel={() => {
                    if (unbindLoading) return;
                    setPasswordDialogOpen(false);
                    setPassword("");
                    setPasswordError("");
                }}
                loading={unbindLoading}
                error={passwordError}
            />

            <ConfirmDialog
                open={resultDialog.open}
                title={resultDialog.title}
                message={resultDialog.message}
                confirmText={t("common.actions.done")}
                showCancel={false}
                onConfirm={() => setResultDialog((prev) => ({ ...prev, open: false }))}
                onCancel={() => setResultDialog((prev) => ({ ...prev, open: false }))}
            />
        </section>
    );
};

export default BindOod;
