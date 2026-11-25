import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Copy, KeyRound, LogOut, RefreshCw, Trash2, Unlink } from "lucide-react";
import { PageHeader } from "../../app/PageHeader";
import { Button, IconButton } from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { Switch } from "../../components/ui/Field";
import { Card, Row, Section } from "../../components/ui/Rows";
import { StateText } from "../../components/ui/States";
import { clientRuntime } from "../../features/content/clientRuntime";
import { AccentPicker } from "../../features/zone/AccentPicker";
import { updateZone } from "../../features/zone/api";
import { LineNotice } from "../../features/zone/LineNotice";
import { LineSection } from "../../features/zone/LineSection";
import { SessionNotice } from "../../features/zone/SessionNotice";
import { sessionLabelKey, sessionTone } from "../../features/zone/sessionView";
import { UnbindZoneDialog } from "../../features/zone/UnbindZoneDialog";
import { useZoneActions } from "../../features/zone/useZoneActions";
import { useZones } from "../../features/zone/ZoneContext";
import { zoneTitle, type ZoneView } from "../../features/zone/types";
import { ZoneMark } from "../../features/zone/ZoneMark";
import { useI18n } from "../../i18n";

const LIST = "/main/setting/zones";

const ZoneDetail: React.FC = () => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { zone: param } = useParams();
    const { zones, loading } = useZones();
    const did = param ? decodeURIComponent(param) : "";
    const zone = zones.find((candidate) => candidate.did === did);

    React.useEffect(() => {
        if (!loading && !zone) navigate(LIST, { replace: true });
    }, [loading, zone, navigate]);

    return (
        <div className="shell-page">
            <PageHeader title={t("zones.one")} back={LIST} />
            {zone ? <ZoneSettings key={zone.did} zone={zone} /> : null}
        </div>
    );
};

const ZoneSettings: React.FC<{ zone: ZoneView }> = ({ zone }) => {
    const { t } = useI18n();
    const { current } = useZones();
    const { busy, switchTo, signIn, reconnect, signOut, remove } = useZoneActions();
    const [confirm, setConfirm] = React.useState<"sign_out" | "remove" | null>(null);
    const [unbinding, setUnbinding] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const signedIn = zone.session.state === "signed_in";
    const working = busy === zone.did;

    React.useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timer);
    }, [copied]);

    const leave = async (work: (zone: ZoneView) => Promise<boolean | undefined>) => {
        setConfirm(null);
        await work(zone).catch((error) => console.error("[Zone] failed", error));
    };

    return (
        <div className="shell-page-body ui-scroll" data-testid="zone-detail">
            <div className="zone-head">
                <ZoneMark zone={zone} size={48} />
                <span className="zone-head-text">
                    <strong>{zoneTitle(zone)}</strong>
                    <StateText tone={sessionTone(zone)}>{t(sessionLabelKey(zone))}</StateText>
                </span>
                {zone.did === current?.did ? null : (
                    <Button size="sm" onClick={() => void switchTo(zone.did)}>
                        {t("zones.switch")}
                    </Button>
                )}
            </div>
            <SessionNotice zone={zone} />
            <LineNotice zone={zone} />
            <Section>
                <Card>
                    <Row title={t("zones.host")} sub={<span className="selectable">{zone.host}</span>} wrapSub />
                    <Row
                        title="DID"
                        sub={<span className="selectable">{zone.did}</span>}
                        wrapSub
                        end={
                            <IconButton
                                label={t(copied ? "ui.copied" : "ui.copy")}
                                onClick={() => {
                                    void navigator.clipboard?.writeText(zone.did).then(
                                        () => setCopied(true),
                                        () => undefined
                                    );
                                }}
                            >
                                <Copy size={15} />
                            </IconButton>
                        }
                    />
                    <Row title={t("zones.user")} value={zone.session.identity?.user_id ?? zone.session.username ?? "–"} />
                    <Row title={t("zones.source")} value={t(`zones.source_${zone.source}`)} />
                </Card>
            </Section>
            <Section title={t("zones.accent")} note={t("zones.accent_note")}>
                <Card>
                    {signedIn ? <AccentPicker zone={zone} /> : <Row title={t("zones.accent_sign_in")} />}
                </Card>
            </Section>
            <Section title={t("prefs.notifications")}>
                <Card>
                    <Row
                        title={t("prefs.notify_zone")}
                        end={
                            <Switch
                                label={t("prefs.notify_zone")}
                                checked={zone.notify}
                                testId="zone-notify"
                                onChange={(notify) => void updateZone(zone.did, { notify }).catch((error) => console.error("[Zone] notify", error))}
                            />
                        }
                    />
                </Card>
            </Section>
            <LineSection zone={zone} />
            <Section title={t("zones.account")} note={zone.source === "owner" ? t("zones.unbind_note") : undefined}>
                <Card>
                    <Row
                        icon={<KeyRound size={17} strokeWidth={1.8} />}
                        title={t(signedIn ? "zones.sign_in_again" : "zones.sign_in")}
                        onClick={() => (signedIn ? clientRuntime.askSignIn(zone.did) : void signIn(zone))}
                        chevron={false}
                        disabled={working}
                    />
                    <Row
                        icon={<RefreshCw size={17} strokeWidth={1.8} />}
                        title={t("zones.reconnect")}
                        onClick={() => void reconnect(zone)}
                        chevron={false}
                        disabled={working}
                    />
                    {zone.session.state === "signed_out" ? null : (
                        <Row
                            icon={<LogOut size={17} strokeWidth={1.8} />}
                            title={t("zones.sign_out")}
                            onClick={() => setConfirm("sign_out")}
                            chevron={false}
                            disabled={working}
                        />
                    )}
                    <Row
                        icon={<Trash2 size={17} strokeWidth={1.8} />}
                        title={t("zones.remove")}
                        tone="danger"
                        onClick={() => setConfirm("remove")}
                        chevron={false}
                        disabled={working}
                    />
                    {zone.source === "owner" ? (
                        <Row
                            icon={<Unlink size={17} strokeWidth={1.8} />}
                            title={t("zones.unbind")}
                            tone="danger"
                            onClick={() => setUnbinding(true)}
                            chevron={false}
                            disabled={working}
                        />
                    ) : null}
                </Card>
            </Section>
            <ConfirmDialog
                open={confirm === "sign_out"}
                title={t("zones.sign_out_title", { zone: zoneTitle(zone) })}
                message={t("zones.sign_out_text")}
                confirmText={t("zones.sign_out")}
                cancelText={t("common.actions.cancel")}
                onConfirm={() => void leave(signOut)}
                onCancel={() => setConfirm(null)}
            />
            <ConfirmDialog
                open={confirm === "remove"}
                title={t("zones.remove_title", { zone: zoneTitle(zone) })}
                message={t(zone.source === "owner" ? "zones.remove_text_owner" : "zones.remove_text")}
                confirmText={t("zones.remove")}
                cancelText={t("common.actions.cancel")}
                confirmVariant="danger"
                onConfirm={() => void leave(remove)}
                onCancel={() => setConfirm(null)}
            />
            {unbinding ? <UnbindZoneDialog zone={zone} onClose={() => setUnbinding(false)} /> : null}
        </div>
    );
};

export default ZoneDetail;
