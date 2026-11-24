import React from "react";
import { HashRouter as Router, Route, Routes } from "react-router-dom";
import { preventContextMenu } from "../utils/contextMenu";
import type { WindowKind } from "./windowKind";
import "./windows.css";

const ContentStatus = React.lazy(() => import("./ContentStatus"));
const SignPrompt = React.lazy(() => import("./SignPrompt"));
const TrayPopover = React.lazy(() => import("./TrayPopover"));

/** Every window but the main one: one page each, without the client's runtime. */
const SmallWindow: React.FC<{ kind: Exclude<WindowKind, "main"> }> = ({ kind }) => {
    React.useEffect(() => preventContextMenu(), []);
    return (
        <Router>
            <React.Suspense fallback={null}>
                <Routes>
                    {kind === "content" ? <Route path="/content-status" element={<ContentStatus />} /> : null}
                    {kind === "sign" ? <Route path="/prompt/sign" element={<SignPrompt />} /> : null}
                    {kind === "tray" ? <Route path="/tray-popover" element={<TrayPopover />} /> : null}
                    <Route path="*" element={null} />
                </Routes>
            </React.Suspense>
        </Router>
    );
};

export default SmallWindow;
