import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CircleAlert, LoaderCircle, PanelsTopLeft } from "lucide-react";
import { useI18n } from "../../i18n";
import { parseCommandError } from "../../utils/commandError";
import "./Apps.css";

type AppMeta = {
    pkg_name: string;
    [key: string]: unknown;
};

type AppDoc = {
    meta?: AppMeta;
    pkg_name?: string;
    show_name?: string;
    app_icon_url?: string | null;
    selector_type?: string;
    install_config_tips?: string;
    pkg_list?: string;
    [key: string]: unknown;
};

const accentPalette = [
    "linear-gradient(135deg, #6366f1 0%, #4338ca 100%)",
    "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
    "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
    "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
    "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
];

const Apps: React.FC = () => {
    const { t } = useI18n();
    const [apps, setApps] = useState<AppDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        const load = async () => {
            try {
                setLoading(true);
                setError(null);
                const result = await invoke<AppDoc[]>("get_applist");
                if (mounted) {
                    setApps(result);
                }
            } catch (err) {
                if (mounted) {
                    const { message } = parseCommandError(err);
                    setApps([]);
                    setError(message);
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        void load();
        return () => {
            mounted = false;
        };
    }, []);

    const displayCards = useMemo(
        () =>
            apps.map((app, index) => {
                const pkgName = app.meta?.pkg_name || app.pkg_name || `app-${index}`;
                return {
                    key: pkgName,
                    title: app.show_name || pkgName,
                    description: app.install_config_tips || app.selector_type || "",
                    icon: app.app_icon_url || undefined,
                    accent: accentPalette[index % accentPalette.length],
                };
            }),
        [apps]
    );

    return (
        <div className="apps-page">
            {error && (
                <div className="apps-alert" role="alert">
                    <CircleAlert size={20} strokeWidth={1.8} aria-hidden="true" />
                    <div>
                        <div className="apps-alert-title">{t("appsPage.error_title")}</div>
                        <div className="apps-alert-message">{error}</div>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="apps-state">
                    <LoaderCircle
                        className="apps-state-icon apps-state-spinner"
                        size={22}
                        strokeWidth={1.8}
                        aria-hidden="true"
                    />
                    <span>{t("appsPage.loading")}</span>
                </div>
            ) : displayCards.length === 0 ? (
                <div className="apps-state">
                    <PanelsTopLeft className="apps-state-icon" size={22} strokeWidth={1.8} aria-hidden="true" />
                    <span>{t(error ? "appsPage.empty_after_error" : "appsPage.empty")}</span>
                </div>
            ) : (
                displayCards.map(({ key, title, description, accent, icon }) => (
                    <article className="apps-card" key={key}>
                        <div className="apps-card-icon" style={{ background: accent }} aria-hidden="true">
                            {icon ? <img src={icon} alt="" /> : title.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="apps-card-copy">
                            <h2>{title}</h2>
                            <p>{description || t("appsPage.no_description")}</p>
                        </div>
                    </article>
                ))
            )}
        </div>
    );
};

export default Apps;
