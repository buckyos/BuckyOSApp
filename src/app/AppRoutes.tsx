import { HashRouter as Router, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import DidFlowRoutes from "../features/did/DidFlowRoutes";
import MainRoutes from "./MainRoutes";
import { DidProvider } from "../features/did/DidContext";

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

export default function AppRoutes() {
  return (
    <Router>
      <div className="container">
        <InitialGate />
        <Routes>
          <Route
            path="/main/*"
            element={(
              <DidProvider>
                <MainRoutes />
              </DidProvider>
            )}
          />
          <Route path="/*" element={<DidFlowRoutes />} />
        </Routes>
      </div>
    </Router>
  );
}
