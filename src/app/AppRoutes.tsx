import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { DidProvider } from "../features/did/DidContext";
import { ActivationProvider } from "../features/devices/ActivationContext";
import { ZoneProvider } from "../features/zone/ZoneContext";
import { AppContainer } from "../features/container/AppContainer";
import { useRuntime } from "../features/content/useRuntime";
import { isMobileShell } from "../utils/platform";
import { RuntimeHost } from "./RuntimeHost";
import StartupScreen from "./StartupScreen";
import { checkStartupWallet } from "./startup";

const DidFlowRoutes = lazy(() => import("../features/did/DidFlowRoutes"));
const MainRoutes = lazy(() => import("./MainRoutes"));
const WebContainer = lazy(() => import("../pages/WebContainer"));
const PhoneActivation = lazy(() => import("../pages/PhoneActivation"));

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

/** The client's own pages; on a phone they go out of sight while an app is in front. */
function OwnPages({ children }: { children: ReactNode }) {
    const { front } = useRuntime();
    return (
        <div className="container" data-covered={front ? true : undefined} aria-hidden={front ? true : undefined}>
            {children}
        </div>
    );
}

/** The main window. What lives as long as it (the wallet, the Zones, the runtime) is above the routes. */
export default function AppRoutes() {
    return (
        <Router>
            <DidProvider>
                <ZoneProvider>
                    <ActivationProvider>
                        <OwnPages>
                            <InitialGate>
                                <Suspense fallback={<StartupScreen />}>
                                    <Routes>
                                        <Route path="/main/*" element={<MainRoutes />} />
                                        <Route path="/web-container" element={<WebContainer />} />
                                        <Route path="/activation" element={<PhoneActivation />} />
                                        <Route path="/*" element={<DidFlowRoutes />} />
                                    </Routes>
                                </Suspense>
                            </InitialGate>
                        </OwnPages>
                        {isMobileShell() ? <AppContainer /> : null}
                        <RuntimeHost />
                    </ActivationProvider>
                </ZoneProvider>
            </DidProvider>
        </Router>
    );
}
