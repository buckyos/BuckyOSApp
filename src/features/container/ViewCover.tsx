import React from "react";
import { ContentStatusView } from "../../windows/ContentStatus";
import { clientRuntime } from "../content/clientRuntime";
import { retryView, type MobileView } from "../content/mobileViews";
import { useBlock } from "../content/useOverlay";
import "../../windows/windows.css";
import "./container.css";

/** In the place of a view whose page is on its way or could not be opened. */
export const ViewCover: React.FC<{ view: MobileView }> = ({ view }) => {
    const ref = React.useRef<HTMLDivElement | null>(null);
    const covered = view.status !== "ready";
    useBlock(ref, covered);
    if (view.status === "ready") return null;
    return (
        <div ref={ref} className="view-cover" data-testid="view-cover" data-status={view.status}>
            <ContentStatusView
                state={view.status}
                detail={view.detail}
                onRetry={() => retryView(view.id)}
                onSignIn={async () => clientRuntime.askSignIn(view.zone)}
            />
        </div>
    );
};
