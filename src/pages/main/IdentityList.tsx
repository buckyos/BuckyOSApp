import React from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { PageHeader } from "../../app/PageHeader";
import { Avatar } from "../../components/ui/Avatar";
import { Card } from "../../components/ui/Rows";
import InputDialog from "../../components/ui/InputDialog";
import BottomSheetActions from "../../components/ui/BottomSheetActions";
import GradientButton from "../../components/ui/GradientButton";
import { useI18n } from "../../i18n";
import { clientRuntime } from "../../features/content/clientRuntime";
import { useDidContext } from "../../features/did/DidContext";
import { revealMnemonic } from "../../features/did/api";
import { parseCommandError } from "../../utils/commandError";
import { CommandErrorCodes } from "../../constants/commandErrorCodes";
import { getIdentityAvatar, getIdentityBnsName, getIdentityDid, getIdentityDisplayName } from "../../features/did/identityView";
import { avatarDisplayUrl } from "../../features/did/ownerDocument";

const IdentityList: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { dids, activeDid, setActiveDid } = useDidContext();
    const forceSelection = !activeDid && dids.length > 0;

    const [targetId, setTargetId] = React.useState<string | null>(null);
    const [targetName, setTargetName] = React.useState<string>("");
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(false);

    const openPasswordDialog = (didId: string) => {
        if (activeDid?.id === didId) return; // clicking current does nothing
        const did = dids.find((d) => d.id === didId);
        const name = getIdentityDisplayName(did) || t("common.account.unnamed");
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
            // The windows are this identity's; its apps may have something to save.
            if (!(await clientRuntime.closeAll(undefined, "logout"))) {
                closePasswordDialog();
                return;
            }
            await setActiveDid(targetId);
            navigate("/main/setting", { replace: true });
            closePasswordDialog();
        } catch (err) {
            const { code, message } = parseCommandError(err);
            if (code === CommandErrorCodes.InvalidPassword || message.includes("invalid_password")) {
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
        <div className="shell-page">
            <PageHeader title={t("identities.title")} back={forceSelection ? false : "/main/setting"} />
            <div className="shell-page-body ui-scroll">
                <Card>
                    {dids.map((did) => {
                        const name = getIdentityDisplayName(did) || t("common.account.unnamed");
                        const bnsName = getIdentityBnsName(did);
                        return (
                            <button key={did.id} type="button" onClick={() => openPasswordDialog(did.id)} className="ui-row">
                                <Avatar src={avatarDisplayUrl(getIdentityAvatar(did))} name={name} id={getIdentityDid(did)} size={34} />
                                <span className="ui-row-text">
                                    <span className="ui-row-title">{name}</span>
                                    {bnsName ? <span className="ui-row-sub">{bnsName}</span> : null}
                                </span>
                                {activeDid?.id === did.id ? <Check size={16} aria-label={t("identities.current_badge")} /> : null}
                            </button>
                        );
                    })}
                </Card>
                <GradientButton variant="secondary" onClick={addIdentity}>
                    {t("identities.add_identity")}
                </GradientButton>
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

            <BottomSheetActions
                open={addOpen}
                title={t("identities.add_identity")}
                onClose={() => setAddOpen(false)}
                actions={[
                    { label: t("create.title_new"), onClick: goCreate, variant: "primary" },
                    { label: t("welcome.import_did"), onClick: goImport, variant: "secondary" },
                    { label: t("common.actions.cancel"), onClick: () => { }, variant: "ghost" },
                ]}
            />
        </div>
    );
};

export default IdentityList;
