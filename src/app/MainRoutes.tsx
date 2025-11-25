import React from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Home as HomeIcon, PanelsTopLeft, Settings } from "lucide-react";
import Home from "../pages/main/Home";
import Apps from "../pages/main/Apps";
import Setting from "../pages/main/Setting";
import LanguageSelect from "../pages/main/LanguageSelect";
import IdentityList from "../pages/main/IdentityList";
import BackupIdentity from "../pages/main/BackupIdentity";
import EmbeddedWebView from "../pages/main/EmbeddedWebView";
import "./MainRoutes.css";
import { useI18n } from "../i18n";
import { useDidContext } from "../features/did/DidContext";

function TabBar() {
    const { t } = useI18n();

    const tabs = React.useMemo(
        () => [
            { to: "/main/home", label: t("tabs.home"), Icon: HomeIcon },
            { to: "/main/apps", label: t("tabs.apps"), Icon: PanelsTopLeft },
            { to: "/main/setting", label: t("tabs.setting"), Icon: Settings },
        ],
        [t]
    );

    return (
        <nav className="tabbar" aria-label="Main navigation">
            {tabs.map(({ to, label, Icon }) => (
                <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => `tab ${isActive ? "active" : ""}`}
                >
                    <Icon className="tab-icon" strokeWidth={1.8} aria-hidden="true" />
                    <span className="tab-label">{label}</span>
                </NavLink>
            ))}
        </nav>
    );
}

const MainRoutes: React.FC = () => {
    const navigate = useNavigate();
    const { t } = useI18n();
    const { activeDid, dids, setActiveDid, loading } = useDidContext();
    const routerLocation = useLocation();
    const normalizedPath = React.useMemo(() => {
        const path = routerLocation.pathname;
        if (path.endsWith("/") && path.length > 1) {
            return path.replace(/\/+$/, "");
        }
        return path;
    }, [routerLocation.pathname]);
    const tabRoutes = React.useMemo(
        () => new Set(["/main/home", "/main/apps", "/main/setting", "/main"]),
        []
    );
    const showTabBar = tabRoutes.has(normalizedPath);
    React.useEffect(() => {
        if (window.location.hash === "#/main" || window.location.hash === "#/main/") {
            navigate("/main/home", { replace: true });
        }
    }, [navigate]);

    const displayName = activeDid && activeDid.nickname.trim().length > 0
        ? activeDid.nickname
        : t("common.account.unnamed");

    const accountLabel = t("common.account.current");
    const avatarInitial = displayName.trim().charAt(0).toUpperCase() || "?";
    const hideAccountHeader =
        normalizedPath.startsWith("/main/setting/backup") ||
        normalizedPath.startsWith("/main/setting/identities") ||
        normalizedPath.startsWith("/main/setting/language") ||
        normalizedPath.startsWith("/main/setting/embedded-webview");

    return (
        <div className={showTabBar ? "App app-tabbed" : "App"}>
            <div className="content">
                {!hideAccountHeader && (
                    <div className="account-header">
                        <div className="account-avatar" aria-hidden="true">{avatarInitial}</div>
                        <div className="account-info">
                            <span className="account-label">{accountLabel}</span>
                            <span className="account-name">{displayName}</span>
                        </div>
                        {/* Identity switching dropdown removed. Use IdentityList page instead. */}
                    </div>
                )}
                <div className="content-body">
                    <Routes>
                        <Route path="/home" element={<Home />} />
                        <Route path="/apps" element={<Apps />} />
                        <Route path="/setting" element={<Setting />} />
                        <Route path="/setting/identities" element={<IdentityList />} />
                        <Route path="/setting/backup" element={<BackupIdentity />} />
                        <Route path="/setting/language" element={<LanguageSelect />} />
                        <Route path="/setting/embedded-webview" element={<EmbeddedWebView />} />
                    </Routes>
                </div>
            </div>
            {showTabBar && <TabBar />}
        </div>
    );
};

export default MainRoutes;
