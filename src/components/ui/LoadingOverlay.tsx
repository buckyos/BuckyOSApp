import React from "react";
import { useI18n } from "../../i18n";
import { useOverlay } from "../../features/content/useOverlay";
import { Spinner } from "./States";

interface LoadingOverlayProps {
    visible: boolean;
    textKey?: string; // i18n key
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ visible, textKey = "common.creating" }) => {
    const { t } = useI18n();
    useOverlay(visible, () => undefined);
    if (!visible) return null;
    return (
        <div className="ui-scrim" role="status">
            <div className="ui-dialog" style={{ width: "auto", minWidth: 220, flexDirection: "row", alignItems: "center", gap: 12, fontSize: 14 }}>
                <Spinner />
                <span>{t(textKey)}</span>
            </div>
        </div>
    );
};

export default LoadingOverlay;
