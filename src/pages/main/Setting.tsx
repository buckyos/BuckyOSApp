import React from "react";
import { useNavigate } from "react-router-dom";
import { AppWindow, HardDrive, Info, Monitor, Power, Settings2, ShieldCheck, Trash2, Users } from "lucide-react";
import { PageHeader } from "../../app/PageHeader";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import { Segmented, Select, Switch } from "../../components/ui/Field";
import InputDialog from "../../components/ui/InputDialog";
import { Card, Row, Section } from "../../components/ui/Rows";
import { CommandErrorCodes } from "../../constants/commandErrorCodes";
import { clientRuntime } from "../../features/content/clientRuntime";
import { deleteDid, listDids, revealMnemonic } from "../../features/did/api";
import { useDidContext } from "../../features/did/DidContext";
import { getIdentityDisplayName } from "../../features/did/identityView";
import { autostartEnabled, setAutostart } from "../../features/tray/autostart";
import { isTrayCapable, useTrayEnabledPreference } from "../../features/tray/trayConfig";
import { useZones } from "../../features/zone/ZoneContext";
import { zoneTitle } from "../../features/zone/types";
import { useI18n } from "../../i18n";
import { getLocaleOptions, type Locale } from "../../i18n/config";
import { getThemePreference, setThemePreference, subscribeTheme, type ThemePreference } from "../../theme";
import { parseCommandError } from "../../utils/commandError";
import { isMobileShell } from "../../utils/platform";
import { openEmbeddedPage } from "../../utils/webview";
import { NotifySection } from "./NotifySection";

const icon = { size: 17, strokeWidth: 1.8, "aria-hidden": true } as const;

const Setting: React.FC = () => {
    const navigate = useNavigate();
    const { t, locale, setLocale } = useI18n();
    const { activeDid } = useDidContext();
    const { zones, current } = useZones();
    const theme = React.useSyncExternalStore(subscribeTheme, getThemePreference);
    const [dialog, setDialog] = React.useState<"delete" | "backup" | null>(null);
    const showDebugTools = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEBUG_TOOLS === "true";
    const identity = getIdentityDisplayName(activeDid);

    return (
        <div className="shell-page">
            <PageHeader title={t("settings.title")} />
            <div className="shell-page-body ui-scroll" data-testid="settings-page">
                <Section title={t("prefs.general")}>
                    <Card>
                        <Row
                            title={t("settings.language")}
                            end={
                                <Select aria-label={t("settings.language")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
                                    {getLocaleOptions().map((option) => (
                                        <option key={option.code} value={option.code}>
                                            {option.label}
                                        </option>
                                    ))}
                                </Select>
                            }
                        />
                        <Row
                            title={t("settings.theme")}
                            end={
                                <Segmented<ThemePreference>
                                    label={t("settings.theme")}
                                    value={theme}
                                    onChange={setThemePreference}
                                    options={[
                                        { value: "system", label: t("prefs.theme_system") },
                                        { value: "light", label: t("settings.theme_light") },
                                        { value: "dark", label: t("settings.theme_dark") },
                                    ]}
                                />
                            }
                        />
                    </Card>
                </Section>

                <Section title={t("zones.title")}>
                    <Card>
                        <Row
                            icon={<HardDrive {...icon} />}
                            title={t("zones.manage")}
                            value={String(zones.length)}
                            onClick={() => navigate("/main/setting/zones")}
                            testId="manage-zones"
                        />
                        {current ? (
                            <Row
                                icon={<Settings2 {...icon} />}
                                title={t("prefs.zone_settings", { zone: zoneTitle(current) })}
                                sub={isMobileShell() ? undefined : t("prefs.zone_settings_sub")}
                                onClick={() => void clientRuntime.openApp(current.did, "settings")}
                                disabled={current.session.state !== "signed_in"}
                                testId="zone-settings"
                            />
                        ) : null}
                    </Card>
                </Section>

                <NotifySection />
                {isTrayCapable() ? <StartupSection /> : null}

                <Section title={t("prefs.identity")}>
                    <Card>
                        <Row
                            icon={<Users {...icon} />}
                            title={t("settings.switch_identity")}
                            value={identity}
                            onClick={() => navigate("/main/setting/identities")}
                        />
                        <Row icon={<ShieldCheck {...icon} />} title={t("settings.backup_identity")} onClick={() => setDialog("backup")} />
                        <Row
                            icon={<Trash2 {...icon} />}
                            title={t("settings.delete_account")}
                            tone="danger"
                            chevron={false}
                            onClick={() => setDialog("delete")}
                        />
                    </Card>
                </Section>

                <Section>
                    <Card>
                        <Row icon={<Info {...icon} />} title={t("settings.about_app")} onClick={() => navigate("/main/setting/about")} />
                        {showDebugTools ? (
                            <Row
                                icon={<Monitor {...icon} />}
                                title={t("settings.embedded_webview")}
                                onClick={() => openEmbeddedPage("/test_api.html", t("settings.embedded_webview_title"))}
                            />
                        ) : null}
                    </Card>
                </Section>
            </div>
            {dialog === "delete" ? <DeleteIdentity onClose={() => setDialog(null)} /> : null}
            {dialog === "backup" ? <BackupPassword onClose={() => setDialog(null)} /> : null}
        </div>
    );
};

/** What the client does on this computer by itself. */
const StartupSection: React.FC = () => {
    const { t } = useI18n();
    const [trayEnabled, setTrayEnabled] = useTrayEnabledPreference();
    const [autostart, setAutostartShown] = React.useState<boolean | null>(null);

    React.useEffect(() => {
        let stopped = false;
        autostartEnabled()
            .then((enabled) => {
                if (!stopped) setAutostartShown(enabled);
            })
            .catch((error) => console.warn("[Settings] reading the login item failed", error));
        return () => {
            stopped = true;
        };
    }, []);

    const change = async (next: boolean) => {
        setAutostartShown(next);
        try {
            await setAutostart(next);
        } catch (error) {
            console.error("[Settings] changing the login item failed", error);
            setAutostartShown(!next);
        }
    };

    return (
        <Section title={t("prefs.startup")} note={trayEnabled ? t("prefs.tray_note") : t("prefs.tray_off_note")}>
            <Card>
                <Row
                    icon={<Power {...icon} />}
                    title={t("prefs.autostart")}
                    end={
                        <Switch
                            label={t("prefs.autostart")}
                            checked={autostart ?? false}
                            disabled={autostart === null}
                            testId="autostart"
                            onChange={(next) => void change(next)}
                        />
                    }
                />
                <Row
                    icon={<AppWindow {...icon} />}
                    title={t("settings.tray_enable")}
                    end={<Switch label={t("settings.tray_enable")} checked={trayEnabled} testId="tray-enabled" onChange={setTrayEnabled} />}
                />
            </Card>
        </Section>
    );
};

const DeleteIdentity: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { activeDid, refresh } = useDidContext();
    const [confirmed, setConfirmed] = React.useState(false);
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const name = getIdentityDisplayName(activeDid);

    const remove = async () => {
        if (!password.trim()) {
            setError(t("settings.delete_password_required"));
            return;
        }
        if (!activeDid) {
            setError(t("settings.delete_error_missing"));
            return;
        }
        setError("");
        setBusy(true);
        try {
            // The password first: nothing closes for a wrong one.
            await revealMnemonic(password, activeDid.id);
            if (!(await clientRuntime.closeAll(undefined, "logout"))) {
                onClose();
                return;
            }
            await deleteDid(password, activeDid.id);
            const remaining = await listDids();
            await refresh();
            onClose();
            navigate(remaining.length > 0 ? "/main/setting/identities" : "/", { replace: true });
        } catch (failure) {
            const { code, message } = parseCommandError(failure);
            if (code === CommandErrorCodes.InvalidPassword || message.includes("invalid_password")) {
                setError(t("settings.delete_error_invalid"));
            } else if (message === "wallet_not_found") {
                setError(t("settings.delete_error_missing"));
            } else {
                setError(t("settings.delete_error_generic", { message }));
            }
            setBusy(false);
        }
    };

    return confirmed ? (
        <InputDialog
            open
            title={t("settings.delete_title")}
            message={name ? t("settings.delete_password_message_named", { nickname: name }) : t("settings.delete_password_message")}
            value={password}
            onChange={setPassword}
            inputType="password"
            placeholder={t("settings.delete_password_placeholder")}
            confirmText={t(busy ? "settings.delete_loading" : "common.actions.delete")}
            cancelText={t("common.actions.cancel")}
            onConfirm={() => void remove()}
            onCancel={onClose}
            loading={busy}
            error={error}
        />
    ) : (
        <ConfirmDialog
            open
            title={t("settings.delete_title")}
            message={name ? t("settings.delete_warning_named", { nickname: name }) : t("settings.delete_warning")}
            cancelText={t("common.actions.cancel")}
            confirmText={t("settings.delete_continue")}
            confirmVariant="danger"
            onCancel={onClose}
            onConfirm={() => setConfirmed(true)}
        />
    );
};

const BackupPassword: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useI18n();
    const navigate = useNavigate();
    const { activeDid } = useDidContext();
    const [password, setPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [busy, setBusy] = React.useState(false);

    const reveal = async () => {
        if (!password.trim()) {
            setError(t("settings.backup_password_required"));
            return;
        }
        if (!activeDid) {
            setError(t("settings.backup_error_missing"));
            return;
        }
        setError("");
        setBusy(true);
        try {
            const mnemonic = await revealMnemonic(password, activeDid.id);
            onClose();
            navigate("/main/setting/backup", { state: { mnemonic } });
        } catch (failure) {
            const { code, message } = parseCommandError(failure);
            if (code === CommandErrorCodes.InvalidPassword || message.includes("invalid_password")) {
                setError(t("settings.backup_error_invalid"));
            } else if (message === "wallet_not_found") {
                setError(t("settings.backup_error_missing"));
            } else {
                setError(t("settings.backup_error_generic", { message }));
            }
            setBusy(false);
        }
    };

    return (
        <InputDialog
            open
            title={t("settings.backup_title")}
            message={t("settings.backup_subtitle")}
            value={password}
            onChange={setPassword}
            inputType="password"
            placeholder={t("settings.backup_password_placeholder")}
            confirmText={t(busy ? "settings.backup_loading" : "settings.backup_submit")}
            cancelText={t("common.actions.cancel")}
            onConfirm={() => void reveal()}
            onCancel={onClose}
            loading={busy}
            error={error}
        />
    );
};

export default Setting;
