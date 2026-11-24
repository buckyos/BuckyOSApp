import React from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    showCancel?: boolean;
    confirmVariant?: "primary" | "danger";
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    open,
    title,
    message,
    confirmText = "OK",
    cancelText = "Cancel",
    showCancel = true,
    confirmVariant = "primary",
    busy = false,
    onConfirm,
    onCancel,
}) => (
    <Dialog
        open={open}
        title={title}
        message={message}
        locked={busy}
        onClose={onCancel}
        onSubmit={onConfirm}
        actions={
            <>
                {showCancel ? (
                    <Button onClick={onCancel} disabled={busy}>
                        {cancelText}
                    </Button>
                ) : null}
                <Button type="submit" variant={confirmVariant === "danger" ? "danger-solid" : "primary"} busy={busy} data-autofocus>
                    {confirmText}
                </Button>
            </>
        }
    />
);

export default ConfirmDialog;
