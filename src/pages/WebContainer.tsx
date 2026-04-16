import React from "react";
import { useSearchParams } from "react-router-dom";
import { useIframeBridge, useBuckyIframeActions } from "../bridges/iframeBridge";
import MobileHeader from "../components/ui/MobileHeader";
import { isMobileShell } from "../utils/platform";

const DEFAULT_URL = "http://localhost:1420/test_api.html";

const WebContainer: React.FC = () => {
    const [searchParams] = useSearchParams();
    const target = decodeURIComponent(searchParams.get("src") || DEFAULT_URL);
    const windowLabel = searchParams.get("label") || "webview_external";
    const title = searchParams.get("title") || windowLabel;
    const embedded = searchParams.get("embedded") === "1";
    const isMobileEmbedded = embedded && isMobileShell();

    const { iframeRef, defaultActionHandlers } = useBuckyIframeActions();
    useIframeBridge({ iframeRef, handlers: defaultActionHandlers });

    return (
        <div
            className="App"
            style={{
                width: isMobileEmbedded ? "100%" : "100vw",
                height: isMobileEmbedded ? "100dvh" : "100vh",
                margin: 0,
                padding: embedded && !isMobileEmbedded ? "0 16px 16px" : 0,
                display: "flex",
                flexDirection: "column",
                overflow: isMobileEmbedded ? "hidden" : undefined,
                background: isMobileEmbedded ? "#fff" : undefined,
            }}
        >
            {isMobileEmbedded ? (
                <div
                    style={{
                        padding: "max(8px, env(safe-area-inset-top, 0px)) 16px 12px",
                        background: "#fff",
                        flexShrink: 0,
                    }}
                >
                    <MobileHeader title={title} showBack />
                </div>
            ) : embedded ? <MobileHeader title={title} showBack /> : null}
            <iframe
                ref={iframeRef}
                title={title}
                src={target}
                style={{
                    width: "100%",
                    height: "100%",
                    border: "none",
                    flex: 1,
                    minHeight: 0,
                    display: isMobileEmbedded ? "block" : undefined,
                    background: isMobileEmbedded ? "#fff" : undefined,
                }}
            />
        </div>
    );
};

export default WebContainer;
