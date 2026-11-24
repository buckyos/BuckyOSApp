import React from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useDidContext } from "../features/did/DidContext";
import { useZones } from "../features/zone/ZoneContext";
import Home from "../pages/main/Home";
import { isMobileShell } from "../utils/platform";
import StartupScreen from "./StartupScreen";
import { TabBar } from "./TabBar";
import "./shell.css";

const PhoneHome = React.lazy(() => import("./phone/PhoneHome"));
const PhoneTabPage = React.lazy(() => import("./phone/PhoneTabPage").then(({ PhoneTabPage: page }) => ({ default: page })));
const FeedPage = React.lazy(() => import("./phone/FeedPage"));
const PhoneNav = React.lazy(() => import("./phone/PhoneNav").then(({ PhoneNav: nav }) => ({ default: nav })));
const Apps = React.lazy(() => import("../pages/main/Apps"));
const Activity = React.lazy(() => import("../pages/main/Activity"));
const Setting = React.lazy(() => import("../pages/main/Setting"));
const ZoneList = React.lazy(() => import("../pages/main/ZoneList"));
const ZoneDetail = React.lazy(() => import("../pages/main/ZoneDetail"));
const AddZone = React.lazy(() => import("../pages/main/AddZone"));
const IdentityList = React.lazy(() => import("../pages/main/IdentityList"));
const BackupIdentity = React.lazy(() => import("../pages/main/BackupIdentity"));
const ScanDevice = React.lazy(() => import("../pages/main/ScanDevice"));
const AboutApp = React.lazy(() => import("../pages/main/AboutApp"));

const DESKTOP_TABS = new Set(["/main", "/main/home", "/main/apps", "/main/activity", "/main/setting"]);
const PHONE_TABS = new Set(["/main", "/main/home", "/main/messagehub", "/main/feed", "/main/setting"]);

const MainRoutes: React.FC = () => {
    const navigate = useNavigate();
    const { activeDid, dids, loading } = useDidContext();
    const { current } = useZones();
    const phone = isMobileShell();
    const location = useLocation();
    const path = location.pathname.replace(/\/+$/, "") || "/";

    React.useEffect(() => {
        if (loading) return;
        if (dids.length === 0) {
            navigate("/", { replace: true });
            return;
        }
        if (!activeDid && path !== "/main/setting/identities") {
            navigate("/main/setting/identities", { replace: true });
        }
    }, [loading, dids.length, activeDid, path, navigate]);

    if (loading && dids.length === 0) return <StartupScreen />;

    return (
        <div className="shell" style={current?.accent ? ({ "--zone-accent": current.accent } as React.CSSProperties) : undefined}>
            <div className="shell-content">
                <React.Suspense fallback={null}>
                    <Routes>
                        <Route path="/" element={<Navigate to="/main/home" replace />} />
                        <Route path="/home" element={phone ? <PhoneHome /> : <Home />} />
                        <Route path="/home/ood-scan" element={<ScanDevice />} />
                        {phone ? (
                            <>
                                <Route path="/messagehub" element={<PhoneTabPage tab="messagehub" />} />
                                <Route path="/feed" element={<FeedPage />} />
                            </>
                        ) : (
                            <>
                                <Route path="/apps" element={<Apps />} />
                                <Route path="/activity" element={<Activity />} />
                            </>
                        )}
                        <Route path="/setting" element={<Setting />} />
                        <Route path="/setting/zones" element={<ZoneList />} />
                        <Route path="/setting/zones/add" element={<AddZone />} />
                        <Route path="/setting/zones/:zone" element={<ZoneDetail />} />
                        <Route path="/setting/identities" element={<IdentityList />} />
                        <Route path="/setting/backup" element={<BackupIdentity />} />
                        <Route path="/setting/about" element={<AboutApp />} />
                        <Route path="*" element={<Navigate to="/main/home" replace />} />
                    </Routes>
                </React.Suspense>
            </div>
            {phone ? (
                PHONE_TABS.has(path) ? (
                    <React.Suspense fallback={null}>
                        <PhoneNav />
                    </React.Suspense>
                ) : null
            ) : DESKTOP_TABS.has(path) ? (
                <TabBar />
            ) : null}
        </div>
    );
};

export default MainRoutes;
