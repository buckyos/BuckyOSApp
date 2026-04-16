import React from "react";
import { useSearchParams } from "react-router-dom";
import { useIframeBridge, useBuckyIframeActions } from "../bridges/iframeBridge";
import MobileHeader from "../components/ui/MobileHeader";

const DEFAULT_URL = "http://localhost:1420/test_api.html";

const WebContainer: React.FC = () => {
    const [searchParams] = useSearchParams();
    const target = decodeURIComponent(searchParams.get("src") || DEFAULT_URL);
    const windowLabel = searchParams.get("label") || "webview_external";
    const title = searchParams.get("title") || windowLabel;
    const embedded = searchParams.get("embedded") === "1";

    const { iframeRef, defaultActionHandlers } = useBuckyIframeActions();
    useIframeBridge({ iframeRef, handlers: defaultActionHandlers });

    return (
        <div
            className="App"
            style={{
                width: "100vw",
                height: "100vh",
                margin: 0,
                padding: embedded ? "0 16px 16px" : 0,
                display: "flex",
                flexDirection: "column",
            }}
        >
            {embedded ? <MobileHeader title={title} showBack /> : null}
            <iframe
                ref={iframeRef}
                title={title}
                src={target}
                style={{ width: "100%", height: "100%", border: "none", flex: 1, minHeight: 0 }}
            />
        </div>
    );
};

export default WebContainer;
