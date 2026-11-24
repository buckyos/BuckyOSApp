import React from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface InputDialogProps {
    open: boolean;
    title: string;
    message?: string;
    value: string;
    onChange: (value: string) => void;
    inputType?: React.HTMLInputTypeAttribute;
    placeholder?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    loading?: boolean;
    error?: string;
    children?: React.ReactNode;
}

const InputDialog: React.FC<InputDialogProps> = ({
    open,
    title,
    message,
    value,
    onChange,
    inputType = "text",
    placeholder,
    confirmText = "OK",
    cancelText = "Cancel",
    onConfirm,
    onCancel,
    loading = false,
    error,
    children,
}) => (
    <Dialog
        open={open}
        title={title}
        message={message}
        locked={loading}
        onClose={onCancel}
        onSubmit={onConfirm}
        actions={
            <>
                <Button onClick={onCancel} disabled={loading}>
                    {cancelText}
                </Button>
                <Button type="submit" variant="primary" busy={loading}>
                    {confirmText}
                </Button>
            </>
        }
    >
        <input
            className="ui-input"
            type={inputType}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder || title}
            disabled={loading}
        />
        {children}
        {error ? (
            <p className="ui-error" role="alert">
                {error}
            </p>
        ) : null}
    </Dialog>
);

export default InputDialog;
