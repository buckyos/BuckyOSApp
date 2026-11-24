import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
    size?: "sm" | "md" | "lg";
    fullWidth?: boolean;
    busy?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, React.PropsWithChildren<ButtonProps>>(function Button(
    { variant = "secondary", size = "md", fullWidth = false, busy = false, className, children, type = "button", disabled, ...rest },
    ref
) {
    return (
        <button
            {...rest}
            ref={ref}
            type={type}
            disabled={disabled || busy}
            aria-busy={busy || undefined}
            className={className ? `ui-button ${className}` : "ui-button"}
            data-variant={variant}
            data-size={size}
            data-full={fullWidth || undefined}
        >
            {busy ? <span className="ui-spinner" aria-hidden="true" /> : null}
            {children}
        </button>
    );
});

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, React.PropsWithChildren<IconButtonProps>>(function IconButton(
    { label, className, children, type = "button", ...rest },
    ref
) {
    return (
        <button
            {...rest}
            ref={ref}
            type={type}
            aria-label={label}
            title={label}
            className={className ? `ui-icon-button ${className}` : "ui-icon-button"}
        >
            {children}
        </button>
    );
});
