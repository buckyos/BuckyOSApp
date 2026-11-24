import React from "react";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import InputDialog from "../../components/ui/InputDialog";
import { CommandErrorCodes } from "../../constants/commandErrorCodes";
import { useI18n } from "../../i18n";
import { parseCommandError } from "../../utils/commandError";
import { useDidContext } from "../did/DidContext";
import { unbindOwnerZone } from "../did/unbindZone";
import { clientRuntime } from "../content/clientRuntime";
import { zoneTitle, type ZoneView } from "./types";
import { useZones } from "./ZoneContext";

type Step = { kind: "confirm" } | { kind: "password" } | { kind: "result"; ok: boolean; message: string };

/** Unbinds one of the owner's Zones: a warning, the wallet password, the result. */
export const UnbindZoneDialog: React.FC<{ zone: ZoneView; onClose: (unbound: boolean) => void }> = ({ zone, onClose }) => {
    const { t } = useI18n();
    const { activeDid, syncOwnerDocument } = useDidContext();
    const { syncOwner } = useZones();
    const [step, setStep] = React.useState<Step>({ kind: "confirm" });
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);

    const fail = (message: string) => setStep({ kind: "result", ok: false, message });

    const unbind = async () => {
        const value = password.trim();
        if (!value) {
            setError(t("ood.unbind_password_required"));
            return;
        }
        if (!activeDid) {
            fail(t("ood.unbind_no_identity"));
            return;
        }
        setBusy(true);
        setError("");
        try {
            await unbindOwnerZone(activeDid, zone.did, value, syncOwnerDocument);
            setPassword("");
            await syncOwner().catch((failure) => console.warn("[Zone] reading the owner's Zones failed", failure));
            setStep({ kind: "result", ok: true, message: t("ood.unbind_result_success_message") });
        } catch (failure) {
            const { code, message } = parseCommandError(failure);
            if (code === CommandErrorCodes.InvalidPassword || message.includes("invalid_password")) {
                setError(t("ood.unbind_password_invalid"));
            } else if (message === "unbind_missing_username") {
                fail(t("ood.unbind_missing_username"));
            } else if (message === "sn_unbind_timeout") {
                fail(t("ood.unbind_result_timeout_message"));
            } else {
                fail(t("ood.unbind_result_failed_message", { message }));
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <ConfirmDialog
                open={step.kind === "confirm"}
                title={t("ood.unbind_confirm_title")}
                message={`${t("ood.unbind_confirm_message")}\n\n${zoneTitle(zone)} (${zone.did})`}
                confirmText={t("ood.unbind_continue")}
                cancelText={t("common.actions.cancel")}
                confirmVariant="danger"
                onConfirm={() => {
                    // Its windows end with it; what is unsaved in them is asked for first.
                    void clientRuntime.closeAll(zone.did, "logout").then((closed) => {
                        if (closed) setStep({ kind: "password" });
                        else onClose(false);
                    });
                }}
                onCancel={() => onClose(false)}
            />
            <InputDialog
                open={step.kind === "password"}
                title={t("ood.unbind_password_title")}
                message={t("ood.unbind_password_message")}
                value={password}
                onChange={(value) => {
                    setPassword(value);
                    setError("");
                }}
                inputType="password"
                placeholder={t("ood.unbind_password_placeholder")}
                confirmText={t(busy ? "ood.unbind_loading" : "ood.unbind_continue")}
                cancelText={t("common.actions.cancel")}
                onConfirm={() => void unbind()}
                onCancel={() => onClose(false)}
                loading={busy}
                error={error}
            />
            <ConfirmDialog
                open={step.kind === "result"}
                title={t(step.kind === "result" && step.ok ? "ood.unbind_result_success_title" : "ood.unbind_result_failed_title")}
                message={step.kind === "result" ? step.message : ""}
                confirmText={t("common.actions.done")}
                showCancel={false}
                onConfirm={() => onClose(step.kind === "result" && step.ok)}
                onCancel={() => onClose(step.kind === "result" && step.ok)}
            />
        </>
    );
};
