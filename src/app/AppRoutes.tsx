import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { DidProvider } from "../features/did/DidContext";
import StartupScreen from "./StartupScreen";
import { checkStartupWallet } from "./startup";

const DidFlowRoutes = lazy(() => import("../features/did/DidFlowRoutes"));
const MainRoutes = lazy(() => import("./MainRoutes"));
const WebContainer = lazy(() => import("../pages/WebContainer"));

function InitialGate({ children }: { children: ReactNode }) {
    const navigate = useNavigate();
    const location = useLocation();
    const atRoot = location.pathname === "/" || location.pathname === "";
    const [checking, setChecking] = useState(atRoot);

    useEffect(() => {
        // Only decide at the root path to avoid interrupting flows
        let cancelled = false;
        if (atRoot) {
            setChecking(true);
            (async () => {
                try {
                    const exists = await checkStartupWallet();
                    if (!cancelled) {
                        if (exists) navigate("/main/home", { replace: true });
                        else setChecking(false);
                    }
                } catch (_) {
                    // ignore and keep default onboarding
                    if (!cancelled) setChecking(false);
                }
            })();
        }
        return () => { cancelled = true; };
    }, [atRoot, navigate]);

    return atRoot && checking ? <StartupScreen /> : children;
}

export default function AppRoutes() {
    return (
        <Router>
            <div className="container">
                <InitialGate>
                    <Suspense fallback={<StartupScreen />}>
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
                    </Suspense>
                </InitialGate>
            </div>
        </Router>
    );
}
