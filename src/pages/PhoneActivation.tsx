import React from "react";
import { Navigate } from "react-router-dom";
import MobileHeader from "../components/ui/MobileHeader";
import { Button } from "../components/ui/Button";
import { useStage } from "../features/container/stage";
import { useActivation } from "../features/devices/ActivationContext";
import { useI18n } from "../i18n";
import "../features/container/container.css";

/** A device's activation page on a phone: a native view below this page's header. */
const PhoneActivation: React.FC = () => {
    const { t } = useI18n();
    const activation = useActivation();
    const stageRef = React.useRef<HTMLDivElement | null>(null);
    const page = activation?.page ?? null;
    useStage(stageRef, page?.id ?? null);
    if (!page) return <Navigate to="/main/home" replace />;
    return (
        <div className="phone-tab" data-testid="phone-activation">
            <div style={{ background: "var(--cp-bg)" }}>
                <MobileHeader
                    title={page.title}
                    showBack
                    rightSlot={
                        activation?.finished ? (
                            <Button size="sm" variant="primary" onClick={activation.leave}>
                                {t("start.go_home")}
                            </Button>
                        ) : null
                    }
                />
            </div>
            <div className="phone-stage" ref={stageRef} />
        </div>
    );
};

export default PhoneActivation;
