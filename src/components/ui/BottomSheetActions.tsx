import React from "react";
import "./BottomSheet.css";

export type BottomSheetAction = {
    label: string;
    onClick: () => void;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    disabled?: boolean;
};

interface BottomSheetActionsProps {
    open: boolean;
    title?: string;
    actions: BottomSheetAction[];
    onClose: () => void;
    closeOnAction?: boolean;
}

const BottomSheetActions: React.FC<BottomSheetActionsProps> = ({
    open,
    title,
    actions,
    onClose,
    closeOnAction = true,
}) => {
    React.useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    const handleAction = (fn: () => void) => () => {
        try { fn(); } finally { if (closeOnAction) onClose(); }
    };

    const classFor = (v?: BottomSheetAction["variant"]) => {
        switch (v) {
            case "primary": return "bs-btn bs-btn-primary";
            case "secondary": return "bs-btn bs-btn-secondary";
            case "danger": return "bs-btn bs-btn-danger";
            case "ghost":
            default: return "bs-btn bs-btn-ghost";
        }
    };

    return (
        <div className="bottom-sheet-overlay" role="dialog" aria-modal onClick={onClose}>
            <div className="bottom-sheet" onClick={(e) => e.stopPropagation()}>
                {title && (
                    <div className="bottom-sheet-title">{title}</div>
                )}
                <div className="bottom-sheet-actions">
                    {actions.map((a, idx) => (
                        <button
                            key={idx}
                            className={classFor(a.variant)}
                            onClick={handleAction(a.onClick)}
                            disabled={a.disabled}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BottomSheetActions;

