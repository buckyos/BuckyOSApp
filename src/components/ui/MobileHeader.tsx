import React from "react";
import { useNavigate } from "react-router-dom";

interface MobileHeaderProps {
    title: string;
    showBack?: boolean;
    onBack?: () => void;
}

const MobileHeader: React.FC<MobileHeaderProps> = ({ title, showBack = false, onBack }) => {
    const navigate = useNavigate();
    const handleBack = React.useCallback(() => {
        if (onBack) {
            onBack();
        } else {
            navigate(-1);
        }
    }, [navigate, onBack]);
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0 12px",
                minHeight: 44, // ensure consistent header row height
            }}
        >
            {showBack && (
                <button
                    aria-label="Back"
                    onClick={handleBack}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 36,
                        height: 36,
                        padding: 0,
                        border: "none",
                        background: "transparent",
                        lineHeight: 0,
                        color: "var(--header-icon)",
                        cursor: "pointer",
                        boxShadow: "none",
                        borderRadius: 999,
                    }}
                >
                    {/* iOS-like chevron back icon (no circular bg) */}
                    <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        style={{ display: "block", transform: "translateY(-3px)" }}
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
            )}
            {title && (
                <h1
                    style={{
                        fontSize: 20,
                        margin: 0,
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {title}
                </h1>
            )}
        </div>
    );
};

export default MobileHeader;
