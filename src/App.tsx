import { useEffect } from "react";
import AppRoutes from "./app/AppRoutes";
import TrayController from "./features/tray/TrayController";
import { applyPlatformAttributes } from "./utils/platform";
import { preventContextMenu } from "./utils/contextMenu";

function App() {
    useEffect(() => {
        applyPlatformAttributes();
        return preventContextMenu();
    }, []);

    return (
        <>
            <AppRoutes />
            <TrayController />
        </>
    );
}

export default App;
