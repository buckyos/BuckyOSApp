import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import { useI18n } from "../../i18n";
import { useIframeBridge, useBuckyIframeActions } from "../../bridges/iframeBridge";

const EmbeddedWebView: React.FC = () => {
    const { t } = useI18n();
    const { iframeRef, defaultActionHandlers } = useBuckyIframeActions();

    useIframeBridge({ iframeRef, handlers: defaultActionHandlers });

    return (
        <div className="App" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <MobileHeader title={t("settings.embedded_webview_title")} showBack />
            <div style={{ flex: 1, minHeight: 0, paddingBottom: "calc(16px + var(--keyboard-inset-bottom))" }}>
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
                        src="/test_api.html"
                        style={{ width: "100%", height: "100%", border: "none" }}
                    />
                </div>
            </div>
        </div>
    );
};

export default EmbeddedWebView;
