import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "./i18n";
import StartupScreen from "./app/StartupScreen";
import { initTheme } from "./theme";

const App = lazy(() => import("./App"));
initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <I18nProvider>
            <Suspense fallback={<StartupScreen />}>
                <App />
            </Suspense>
        </I18nProvider>
    </React.StrictMode>,
);
