import React from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Select } from "../../components/ui/Field";
import { useI18n } from "../../i18n";
import { useActivation } from "./ActivationContext";
import { findRemoteDevice, normalizeRemoteAddress, type RemoteProtocol } from "./remoteDevice";

export const RemoteDeviceDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { t, locale } = useI18n();
    const activation = useActivation();
    const [protocol, setProtocol] = React.useState<RemoteProtocol>("http://");
    const [address, setAddress] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);

    React.useEffect(() => {
        if (!open) return;
        setProtocol("http://");
        setAddress("");
        setError("");
    }, [open]);

    const submit = async () => {
        const normalized = normalizeRemoteAddress(protocol, address);
        if (!normalized.ok) {
            setError(t(normalized.errorKey));
            return;
        }
        setBusy(true);
        setError("");
        try {
            const device = await findRemoteDevice(normalized, locale);
            await activation?.openActivation(device);
            onClose();
        } catch (failure) {
            console.warn("[Devices] no activation page at the address", address, failure);
            setError(t("ood.remote_url_error_probe_failed"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open={open}
            title={t("ood.remote_url_title")}
            message={t("ood.remote_url_message")}
            onClose={onClose}
            onSubmit={() => void submit()}
            locked={busy}
            actions={
                <>
                    <Button onClick={onClose} disabled={busy}>
                        {t("common.actions.cancel")}
                    </Button>
                    <Button type="submit" variant="primary" busy={busy}>
                        {t("ood.remote_url_confirm")}
                    </Button>
                </>
            }
        >
            <Field label={t("zones.address")} error={error}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ flex: "none" }}>
                        <Select
                            value={protocol}
                            onChange={(event) => setProtocol(event.target.value as RemoteProtocol)}
                            aria-label={t("ood.remote_url_protocol_label")}
                            disabled={busy}
                        >
                            <option value="http://">http://</option>
                            <option value="https://">https://</option>
                        </Select>
                    </span>
                    <input
                        className="ui-input"
                        type="text"
                        value={address}
                        onChange={(event) => {
                            setAddress(event.target.value);
                            setError("");
                        }}
                        placeholder={t("ood.remote_url_placeholder")}
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={busy}
                        data-autofocus
                    />
                </span>
            </Field>
        </Dialog>
    );
};
