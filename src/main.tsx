import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "@buckyos-desktop/tokens.css";
import "./App.css";
import "./components/ui/ui.css";
import { I18nProvider } from "./i18n";
import StartupScreen from "./app/StartupScreen";
import { initTheme } from "./theme";
import { applyPlatformAttributes } from "./utils/platform";
import { currentWindowKind } from "./windows/windowKind";

const kind = currentWindowKind();
const Root = lazy(async () => {
    if (kind === "main") return import("./App");
    const { default: SmallWindow } = await import("./windows/SmallWindow");
    return { default: () => <SmallWindow kind={kind} /> };
});

initTheme();
applyPlatformAttributes();
document.documentElement.dataset.window = kind;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <I18nProvider>
            <Suspense fallback={kind === "main" ? <StartupScreen /> : null}>
                <Root />
            </Suspense>
        </I18nProvider>
    </React.StrictMode>,
);
