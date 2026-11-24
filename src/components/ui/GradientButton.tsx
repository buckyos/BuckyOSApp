import React from "react";
import { Button, type ButtonProps } from "./Button";

interface GradientButtonProps extends Omit<ButtonProps, "variant" | "size"> {
    variant?: "primary" | "secondary";
}

/** The main action at the bottom of an account page. */
const GradientButton: React.FC<React.PropsWithChildren<GradientButtonProps>> = ({ fullWidth = true, variant = "primary", ...rest }) => (
    <Button {...rest} variant={variant} size="lg" fullWidth={fullWidth} />
);

export default GradientButton;
