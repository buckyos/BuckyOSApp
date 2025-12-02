import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseCommandError } from "../../utils/commandError";

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
    const [apps, setApps] = useState<AppDoc[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // auto-clear transient errors
    useEffect(() => {
        if (!error) return;
        const timer = setTimeout(() => setError(null), 3000);
        return () => clearTimeout(timer);
    }, [error]);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            try {
                setLoading(true);
                setError(null);
                const result: AppDoc[] = await invoke("get_applist");
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
        load();
        return () => {
            mounted = false;
        };
    }, []);

    const displayCards = useMemo(
        () =>
            apps.map((app, idx) => {
                const pkgName = app.meta?.pkg_name || app.pkg_name || `app-${idx}`;
                return {
                    key: pkgName,
                    title: app.show_name || pkgName,
                    description: app.install_config_tips || app.selector_type || "",
                    icon: app.app_icon_url || undefined,
                    accent: accentPalette[idx % accentPalette.length],
                };
            }),
        [apps]
    );

    return (
        <>
            {/* transient error overlay that doesn't shift layout */}
            {error && (
                <div
                    role="alert"
                    style={{
                        position: "fixed",
                        top: 24,
                        right: 24,
                        zIndex: 20,
                        maxWidth: 320,
                        background: "var(--card-bg)",
                        border: "1px solid var(--border)",
                        boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
                        borderRadius: 12,
                        padding: "12px 14px",
                        color: "var(--error, #ef4444)",
                        fontSize: 14,
                    }}
                >
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>加载失败</div>
                    <div style={{ color: "var(--app-text)" }}>{error}</div>
                </div>
            )}
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    padding: "0 16px 16px",
                }}
            >
                {loading && (
                    <p style={{ margin: 0, color: "var(--muted-text)", fontSize: 14 }}>正在加载应用列表…</p>
                )}
                {!loading && displayCards.length === 0 && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            color: "var(--muted-text)",
                            fontSize: 14,
                            padding: "12px 0",
                        }}
                    >
                        <span aria-hidden="true" style={{ fontSize: 20 }}>
                            🗂️
                        </span>
                        <span>{error ? "加载失败，暂无应用。" : "暂无可用应用。"}</span>
                    </div>
                )}
                {displayCards.map(({ key, title, description, accent, icon }) => (
                    <article
                        key={key}
                        style={{
                            background: "var(--card-bg)",
                            border: "1px solid var(--border)",
                            borderRadius: 16,
                            padding: 18,
                            display: "flex",
                            gap: 16,
                            alignItems: "center",
                            boxShadow: "none",
                        }}
                    >
                        <div
                            style={{
                                width: 56,
                                height: 56,
                                borderRadius: 16,
                                background: accent,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "#fff",
                                fontSize: 22,
                                fontWeight: 600,
                                boxShadow: "none",
                                overflow: "hidden",
                            }}
                            aria-hidden="true"
                        >
                            {icon ? (
                                <img
                                    src={icon}
                                    alt=""
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                            ) : (
                                title.slice(0, 1)
                            )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <h2 style={{ margin: 0, fontSize: 17, color: "var(--app-text)" }}>{title}</h2>
                            <p style={{ margin: 0, fontSize: 14, color: "var(--muted-text)", lineHeight: 1.45 }}>
                                {description || "暂无描述"}
                            </p>
                        </div>
                    </article>
                ))}
            </div>
        </>
    );
};

export default Apps;
