import React from "react";

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    showCancel?: boolean;
    confirmVariant?: "primary" | "danger";
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
    onConfirm,
    onCancel,
}) => {
    if (!open) return null;
    return (
        <div
            role="dialog"
            aria-modal
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
                zIndex: 1000,
            }}
            onClick={onCancel}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "100%",
                    maxWidth: 420,
                    background: "var(--app-bg)",
                    color: "var(--app-text)",
                    border: "1px solid var(--border)",
                    borderRadius: 16,
                    padding: 16,
                    boxShadow: "none",
                }}
            >
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</div>
                {message && (
                    <div
                        style={{ fontSize: 14, color: "var(--muted-text)", marginBottom: 16, whiteSpace: "pre-wrap" }}
                    >
                        {message}
                    </div>
                )}
                <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                    {showCancel && (
                        <button
                            className="soft-btn"
                            style={{
                                borderRadius: 12,
                                height: 40,
                                padding: "0 16px",
                                minWidth: 96,
                                background: "#a9b1bbff",
                                color: "#fff",
                                boxShadow: "none",
                            }}
                            onClick={onCancel}
                        >
                            {cancelText}
                        </button>
                    )}
                    <button
                        style={{
                            borderRadius: 12,
                            height: 40,
                            padding: "0 16px",
                            minWidth: 96,
                            background:
                                confirmVariant === "danger"
                                    ? "linear-gradient(90deg, #ef4444 0%, #f97316 100%)"
                                    : "linear-gradient(90deg, #6366f1 0%, #6c5ce7 100%)",
                            color: "#fff",
                            border: "none",
                            boxShadow: "none",
                        }}
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
