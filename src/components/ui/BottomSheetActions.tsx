import React from "react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

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

const BottomSheetActions: React.FC<BottomSheetActionsProps> = ({ open, title, actions, onClose, closeOnAction = true }) => (
    <Sheet open={open} title={title} onClose={onClose}>
        <div className="bottom-sheet-actions">
            {actions.map((action) => (
                <Button
                    key={action.label}
                    size="lg"
                    fullWidth
                    variant={action.variant === "danger" ? "danger-solid" : action.variant}
                    onClick={() => {
                        try {
                            action.onClick();
                        } finally {
                            if (closeOnAction) onClose();
                        }
                    }}
                    disabled={action.disabled}
                >
                    {action.label}
                </Button>
            ))}
        </div>
    </Sheet>
);

export default BottomSheetActions;
