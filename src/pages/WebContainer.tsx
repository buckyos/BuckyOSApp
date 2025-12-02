import React from "react";
import { useSearchParams } from "react-router-dom";
import { useIframeBridge, useBuckyIframeActions } from "../bridges/iframeBridge";

const DEFAULT_URL = "http://localhost:1420/test_api.html";

const WebContainer: React.FC = () => {
    const [searchParams] = useSearchParams();
    const target = decodeURIComponent(searchParams.get("src") || DEFAULT_URL);
    const title = searchParams.get("title") || "External Page";

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
                style={{ width: "100%", height: "100%", border: "none" }}
            />
        </div>
    );
};

export default WebContainer;
