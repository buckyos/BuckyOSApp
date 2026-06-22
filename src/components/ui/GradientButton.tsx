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
    const [pressed, setPressed] = React.useState(false);
    const isDisabled = Boolean(rest.disabled);
    const base: React.CSSProperties = {
        width: fullWidth ? "100%" : undefined,
        height: 56,
        padding: "0 20px",
        borderRadius: 22,
        border: "none",
        fontSize: 17,
        fontWeight: "normal",
        letterSpacing: 0.2,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.5 : pressed ? 0.82 : 1,
        transition: "opacity .12s ease",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
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
            onPointerDown={(e) => {
                rest.onPointerDown?.(e);
                if (!isDisabled) setPressed(true);
            }}
            onPointerUp={(e) => {
                rest.onPointerUp?.(e);
                setPressed(false);
            }}
            onPointerCancel={(e) => {
                rest.onPointerCancel?.(e);
                setPressed(false);
            }}
            onPointerLeave={(e) => {
                rest.onPointerLeave?.(e);
                setPressed(false);
            }}
        >
            {children}
        </button>
    );
};

export default GradientButton;
