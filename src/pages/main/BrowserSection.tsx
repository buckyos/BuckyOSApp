import React from "react";
import { Copy, Globe } from "lucide-react";
import { IconButton } from "../../components/ui/Button";
import { Switch } from "../../components/ui/Field";
import { Card, Row, Section } from "../../components/ui/Rows";
import { routeStatus, setBrowserRoute, type RouteStatus } from "../../features/route/api";
import { useI18n } from "../../i18n";

/** The way for the system's browser: the user enters an address in the system's settings. */
export const BrowserSection: React.FC = () => {
    const { t } = useI18n();
    const [status, setStatus] = React.useState<RouteStatus | null>(null);
    const [copied, setCopied] = React.useState(false);

    React.useEffect(() => {
        let stopped = false;
        routeStatus()
            .then((next) => {
                if (!stopped) setStatus(next);
            })
            .catch((error) => console.warn("[Settings] no route status", error));
        return () => {
            stopped = true;
        };
    }, []);

    React.useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(timer);
    }, [copied]);

    const change = async (enabled: boolean) => {
        try {
            setStatus(await setBrowserRoute(enabled));
        } catch (error) {
            console.error("[Settings] the browser's way was not changed", error);
        }
    };

    if (!status) return null;
    const { browser } = status;
    const shown = browser.enabled && !browser.error;
    const platform = status.platform === "windows" || status.platform === "macos" ? status.platform : "linux";
    return (
        <Section
            title={t("prefs.browser.title")}
            note={browser.enabled && browser.error ? t("prefs.browser.failed", { port: browser.port, reason: browser.error }) : undefined}
        >
            <Card testId="browser-route">
                <Row
                    icon={<Globe size={17} strokeWidth={1.8} aria-hidden="true" />}
                    title={t("prefs.browser.enable")}
                    sub={t("prefs.browser.enable_sub")}
                    wrapSub
                    end={
                        <Switch
                            label={t("prefs.browser.enable")}
                            checked={browser.enabled}
                            testId="browser-route-enabled"
                            onChange={(next) => void change(next)}
                        />
                    }
                />
                {shown ? (
                    <Row
                        title={t("prefs.browser.address")}
                        sub={<span className="selectable">{browser.address}</span>}
                        wrapSub
                        end={
                            <IconButton
                                label={t(copied ? "ui.copied" : "ui.copy")}
                                onClick={() => {
                                    void navigator.clipboard?.writeText(browser.address).then(
                                        () => setCopied(true),
                                        () => undefined
                                    );
                                }}
                            >
                                <Copy size={15} />
                            </IconButton>
                        }
                    />
                ) : null}
            </Card>
            {shown ? (
                <div className="ui-section-note">
                    <p>{t(`prefs.browser.steps_${platform}`)}</p>
                    <ul>
                        {platform === "macos" ? <li>{t("prefs.browser.limit_network")}</li> : null}
                        <li>{t("prefs.browser.limit_running")}</li>
                        <li>{t("prefs.browser.limit_other")}</li>
                    </ul>
                </div>
            ) : null}
        </Section>
    );
};
