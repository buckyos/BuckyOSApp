import React from "react";
import { useSearchParams } from "react-router-dom";
import { useIframeBridge, useBuckyIframeActions } from "../bridges/iframeBridge";

const DEFAULT_URL = "http://localhost:1420/test_api.html";

const WebContainer: React.FC = () => {
    const [searchParams] = useSearchParams();
    const rawTarget = decodeURIComponent(searchParams.get("src") || DEFAULT_URL);
    const isAndroid = /Android/i.test(navigator.userAgent || "");
    const target = import.meta.env.DEV && isAndroid
        ? rawTarget.replace("http://localhost:1420", "http://10.0.2.2:1420")
        : rawTarget;
    const windowLabel = searchParams.get("label") || "webview_external";
    const title = searchParams.get("title") || windowLabel;

    const { iframeRef, defaultActionHandlers } = useBuckyIframeActions();
    useIframeBridge({ iframeRef, handlers: defaultActionHandlers });

    return (
        <div
            className="App"
            style={{ width: "100vw", height: "100vh", margin: 0, padding: 0 }}
        >
            <iframe
                ref={iframeRef}
                title={title}
                src={target}
                allow="microphone"
                style={{ width: "100%", height: "100%", border: "none" }}
            />
        </div>
    );
};

export default WebContainer;
