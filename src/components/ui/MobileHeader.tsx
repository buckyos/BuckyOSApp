import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useI18n } from "../../i18n";
import { IconButton } from "./Button";

interface MobileHeaderProps {
    title: string;
    showBack?: boolean;
    onBack?: () => void;
    rightSlot?: React.ReactNode;
    safeAreaTop?: boolean;
}

/** The header of a page opened from another one. */
const MobileHeader: React.FC<MobileHeaderProps> = ({ title, showBack = false, onBack, rightSlot, safeAreaTop = true }) => {
    const navigate = useNavigate();
    const { t } = useI18n();
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                flex: "none",
                gap: 4,
                paddingTop: safeAreaTop ? "var(--mobile-system-top)" : 0,
                height: safeAreaTop ? "calc(var(--mobile-system-top) + 44px)" : 44,
                width: "100%",
            }}
        >
            {showBack && (
                <IconButton label={t("common.back")} onClick={() => (onBack ? onBack() : navigate(-1))}>
                    <ChevronLeft size={20} />
                </IconButton>
            )}
            {title && (
                <h1
                    style={{
                        fontSize: 17,
                        fontWeight: 600,
                        lineHeight: 1.3,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        flex: 1,
                        minWidth: 0,
                    }}
                >
                    {title}
                </h1>
            )}
            {rightSlot ? <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>{rightSlot}</div> : null}
        </div>
    );
};

export default MobileHeader;
