import React from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../app/PageHeader";
import { Button } from "../../components/ui/Button";
import { Field, PasswordInput } from "../../components/ui/Field";
import { addZone, listZones, probeZone } from "../../features/zone/api";
import { failureOfReason, zoneFailureOf, type ZoneFailure } from "../../features/zone/errors";
import { zoneTitle, type ZoneProbe } from "../../features/zone/types";
import { useZoneActions } from "../../features/zone/useZoneActions";
import { useI18n } from "../../i18n";

const ADDRESS_FAILURES: ReadonlySet<ZoneFailure> = new Set<ZoneFailure>(["address", "not_zone", "unreachable"]);

/** Signs in to a Zone by its address. Only a Zone that could be signed in to goes on the list. */
const AddZone: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { switchTo } = useZoneActions();
    const [address, setAddress] = React.useState("");
    const [username, setUsername] = React.useState("");
    const [password, setPassword] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [failure, setFailure] = React.useState<ZoneFailure | null>(null);
    const [found, setFound] = React.useState<ZoneProbe | null>(null);

    const complete = Boolean(address.trim() && username.trim() && password);
    const addressFailure = failure && ADDRESS_FAILURES.has(failure) ? failure : null;

    const submit = async () => {
        if (!complete) return;
        setBusy(true);
        setFailure(null);
        let probe: ZoneProbe;
        try {
            probe = await probeZone(address.trim());
            setFound(probe);
        } catch (error) {
            setFound(null);
            setFailure(zoneFailureOf(error));
            setBusy(false);
            return;
        }
        try {
            const zone = await addZone(address.trim(), username.trim(), password);
            await switchTo(zone.did);
            navigate("/main/home", { replace: true });
        } catch (error) {
            // A Zone already on the list keeps the exact reason in its session.
            const reason = await listZones()
                .then((list) => failureOfReason(list.zones.find((zone) => zone.did === probe.did)?.session.reason))
                .catch(() => null);
            setFailure(reason ?? zoneFailureOf(error));
            setBusy(false);
        }
    };

    const clear = () => setFailure(null);

    return (
        <div className="shell-page">
            <PageHeader title={t("zones.add")} back />
            <form
                className="shell-page-body ui-scroll"
                data-testid="add-zone"
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!busy) void submit();
                }}
            >
                <p className="ui-field-hint" style={{ fontSize: 13 }}>
                    {t("zones.add_intro")}
                </p>
                <Field
                    label={t("zones.address")}
                    hint={found ? t("zones.found", { zone: zoneTitle(found) }) : t("zones.address_hint")}
                    error={addressFailure ? t(`zones.failure.${addressFailure}`, { zone: address.trim() }) : undefined}
                >
                    <input
                        className="ui-input"
                        type="text"
                        value={address}
                        onChange={(event) => {
                            setAddress(event.target.value);
                            setFound(null);
                            clear();
                        }}
                        placeholder="example.com"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={busy}
                        autoFocus
                    />
                </Field>
                <Field label={t("zones.username")}>
                    <input
                        className="ui-input"
                        type="text"
                        value={username}
                        onChange={(event) => {
                            setUsername(event.target.value);
                            clear();
                        }}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        disabled={busy}
                    />
                </Field>
                <Field
                    label={t("zones.password")}
                    hint={t("zones.password_hint")}
                    error={failure && !addressFailure ? t(`zones.failure.${failure}`, { zone: found ? zoneTitle(found) : address.trim() }) : undefined}
                >
                    <PasswordInput
                        value={password}
                        onChange={(event) => {
                            setPassword(event.target.value);
                            clear();
                        }}
                        disabled={busy}
                    />
                </Field>
                <Button type="submit" variant="primary" size="lg" fullWidth busy={busy} disabled={!complete}>
                    {t("zones.add_submit")}
                </Button>
            </form>
        </div>
    );
};

export default AddZone;
