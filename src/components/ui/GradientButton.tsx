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
    height: 52,
    padding: "0 18px",
    borderRadius: 20,
    border: "none",
    fontSize: 16,
    cursor: rest.disabled ? "not-allowed" : "pointer",
    opacity: rest.disabled ? 0.5 : 1,
    transition: "transform .06s ease, box-shadow .12s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };
  const primary: React.CSSProperties = {
    color: "#fff",
    background: "#6a6ff3",
    boxShadow: "0 8px 16px rgba(16, 18, 20, 0.08)",
  };
  const secondary: React.CSSProperties = {
    color: "#101214",
    background: "#fff",
    border: "1px solid #e7e9f2",
    boxShadow: "0 6px 14px rgba(16, 18, 20, 0.06)",
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
