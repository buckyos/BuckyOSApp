import React from "react";

interface GradientButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    fullWidth?: boolean;
    variant?: "primary" | "secondary";
}

const GradientButton: React.FC<React.PropsWithChildren<GradientButtonProps>> = ({
    children,
    fullWidth = true,
    variant = "primary",
    style,
    ...rest
}) => {
    const base: React.CSSProperties = {
        width: fullWidth ? "100%" : undefined,
        height: 56,
        padding: "0 20px",
        borderRadius: 22,
        border: "none",
        fontSize: 17,
        fontWeight: "normal",
        letterSpacing: 0.2,
        cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.5 : 1,
        transition: "transform .06s ease, opacity .12s ease",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
    };
    const primary: React.CSSProperties = {
        color: "#fff",
        background: "linear-gradient(90deg, #6366f1 0%, #6c5ce7 100%)",
        boxShadow: "none",
    };
    const secondary: React.CSSProperties = {
        color: "#101214",
        background: "#ffffff",
        border: "1px solid #e9ecf5",
        boxShadow: "none",
    };
    return (
        <button
            {...rest}
            style={{ ...(base as any), ...(variant === "primary" ? primary : secondary), ...style }}
            onMouseDown={(e) => {
                rest.onMouseDown?.(e);
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(1px)";
            }}
            onMouseUp={(e) => {
                rest.onMouseUp?.(e);
                (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }}
        >
            {children}
        </button>
    );
};

export default GradientButton;
