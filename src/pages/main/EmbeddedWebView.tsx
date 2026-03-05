import React from "react";
import { useSearchParams } from "react-router-dom";
import MobileHeader from "../../components/ui/MobileHeader";
import { useI18n } from "../../i18n";
import { useIframeBridge, useBuckyIframeActions } from "../../bridges/iframeBridge";

const EmbeddedWebView: React.FC = () => {
    const { t } = useI18n();
    const [searchParams] = useSearchParams();
    const { iframeRef, defaultActionHandlers } = useBuckyIframeActions();
    const testPageUrl = React.useMemo(() => {
        const rawSrc = searchParams.get("src")?.trim();
        if (!rawSrc) return `${window.location.origin}/test_api.html`;
        if (rawSrc.startsWith("/")) return `${window.location.origin}${rawSrc}`;
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawSrc)) return rawSrc;
        return `${window.location.origin}/${rawSrc.replace(/^\/+/, "")}`;
    }, [searchParams]);

    useIframeBridge({ iframeRef, handlers: defaultActionHandlers });

    return (
        <div className="App" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <MobileHeader title={t("settings.embedded_webview_title")} showBack />
            <div style={{ flex: 1, paddingBottom: 16 }}>
                <div
                    style={{
                        width: "100%",
                        height: "100%",
                        borderRadius: 16,
                        border: "1px solid var(--border)",
                        overflow: "hidden",
                        background: "#fff",
                    }}
                >
                    <iframe
                        ref={iframeRef}
                        title="embedded-webview"
                        src={testPageUrl}
                        style={{ width: "100%", height: "100%", border: "none" }}
                    />
                </div>
            </div>
        </div>
    );
};

export default EmbeddedWebView;
