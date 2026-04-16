import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import DidFlowRoutes from "../features/did/DidFlowRoutes";
import MainRoutes from "./MainRoutes";
import WebContainer from "../pages/WebContainer";
import { DidProvider } from "../features/did/DidContext";
import { BackNavigationProvider, useBackNavigation } from "./BackNavigationContext";

function InitialGate() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        // Only decide at the root path to avoid interrupting flows
        if (location.pathname === "/" || location.pathname === "") {
            (async () => {
                try {
                    const exists: boolean = await invoke("wallet_exists");
                    if (exists) navigate("/main", { replace: true });
                } catch (_) {
                    // ignore and keep default onboarding
                }
            })();
        }
    }, [location.pathname, navigate]);

    return null;
}

function AndroidBackHandler() {
    const { backHandler } = useBackNavigation();

    useEffect(() => {
        if (!/Android/i.test(window.navigator.userAgent)) {
            return;
        }

        let unlisten: (() => void) | undefined;

        const setup = async () => {
            unlisten = await getCurrentWindow().onCloseRequested((event) => {
                if (backHandler) {
                    event.preventDefault();
                    backHandler();
                }
            });
        };

        void setup();

        return () => {
            unlisten?.();
        };
    }, [backHandler]);

    return null;
}

export default function AppRoutes() {
    return (
        <Router>
            <BackNavigationProvider>
                <div className="container">
                    <InitialGate />
                    <AndroidBackHandler />
                    <Routes>
                        <Route
                            path="/main/*"
                            element={(
                                <DidProvider>
                                    <MainRoutes />
                                </DidProvider>
                            )}
                        />
                        <Route
                            path="/web-container"
                            element={(
                                <DidProvider>
                                    <WebContainer />
                                </DidProvider>
                            )}
                        />
                        <Route path="/*" element={<DidFlowRoutes />} />
                    </Routes>
                </div>
            </BackNavigationProvider>
        </Router>
    );
}
