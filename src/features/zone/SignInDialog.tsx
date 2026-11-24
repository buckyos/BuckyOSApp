import React from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, PasswordInput } from "../../components/ui/Field";
import { useI18n } from "../../i18n";
import { useDidContext } from "../did/DidContext";
import { getIdentityBnsName } from "../did/identityView";
import { listZones, loginZone } from "./api";
import { failureOfReason, zoneFailureOf, type ZoneFailure } from "./errors";
import { signInName } from "./sessionView";
import { zoneTitle, type ZoneView } from "./types";
import { ZoneMark } from "./ZoneMark";

/** Asks for the password of one Zone. The Zone's own sign-in page is never shown. */
export const SignInDialog: React.FC<{ zone: ZoneView; onClose: () => void; onSignedIn?: () => void }> = ({ zone, onClose, onSignedIn }) => {
    const { t } = useI18n();
    const { activeDid } = useDidContext();
    const [username, setUsername] = React.useState(() => signInName(zone, getIdentityBnsName(activeDid)));
    const [password, setPassword] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [failure, setFailure] = React.useState<ZoneFailure | null>(null);

    const submit = async () => {
        if (!username.trim() || !password) return;
        setBusy(true);
        setFailure(null);
        try {
            await loginZone(zone.did, username.trim(), password);
            onSignedIn?.();
            onClose();
        } catch (error) {
            // The session keeps the exact reason of a refused sign-in.
            const reason = await listZones()
                .then((list) => failureOfReason(list.zones.find((candidate) => candidate.did === zone.did)?.session.reason))
                .catch(() => null);
            setFailure(reason ?? zoneFailureOf(error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            open
            title={t("zones.sign_in_title", { zone: zoneTitle(zone) })}
            onClose={onClose}
            onSubmit={() => void submit()}
            locked={busy}
            testId="sign-in-dialog"
            actions={
                <>
                    <Button onClick={onClose} disabled={busy}>
                        {t("common.actions.cancel")}
                    </Button>
                    <Button type="submit" variant="primary" busy={busy} disabled={!username.trim() || !password}>
                        {t("zones.sign_in")}
                    </Button>
                </>
            }
        >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <ZoneMark zone={zone} size={32} />
                <span className="ui-row-sub" data-wrap="true">
                    {zone.host}
                </span>
            </div>
            <Field label={t("zones.username")}>
                <input
                    className="ui-input"
                    type="text"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={busy}
                    data-autofocus={username ? undefined : true}
                />
            </Field>
            <Field
                label={t("zones.password")}
                hint={t("zones.password_hint")}
                error={failure ? t(`zones.failure.${failure}`, { zone: zoneTitle(zone) }) : undefined}
            >
                <PasswordInput
                    value={password}
                    onChange={(event) => {
                        setPassword(event.target.value);
                        setFailure(null);
                    }}
                    disabled={busy}
                    data-autofocus={username ? true : undefined}
                />
            </Field>
        </Dialog>
    );
};
