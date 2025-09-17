import React from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import Home from "../pages/main/Home";
import Apps from "../pages/main/Apps";
import Setting from "../pages/main/Setting";
import LanguageSelect from "../pages/main/LanguageSelect";
import "./MainRoutes.css";
import { useI18n } from "../i18n";

function TabBar() {
  const { t } = useI18n();
  return (
    <nav className="tabbar">
      <NavLink to="/main/home" className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>
        {t("tabs.home")}
      </NavLink>
      <NavLink to="/main/apps" className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>
        {t("tabs.apps")}
      </NavLink>
      <NavLink to="/main/setting" className={({ isActive }) => `tab ${isActive ? "active" : ""}`}>
        {t("tabs.setting")}
      </NavLink>
    </nav>
  );
}

const MainRoutes: React.FC = () => {
  const navigate = useNavigate();
  React.useEffect(() => {
    if (location.hash === "#/main" || location.hash === "#/main/") {
      navigate("/main/home", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="App">
      <div className="content">
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/setting" element={<Setting />} />
          <Route path="/setting/language" element={<LanguageSelect />} />
        </Routes>
      </div>
      <TabBar />
    </div>
  );
};

export default MainRoutes;
