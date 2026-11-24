import React from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../../features/content/useOverlay";
import "./BottomSheet.css";

interface SheetProps {
    open: boolean;
    title?: React.ReactNode;
    onClose: () => void;
    children: React.ReactNode;
    testId?: string;
}

/** A panel at the bottom of the window; Escape, back and a touch beside it close it. */
export const Sheet: React.FC<SheetProps> = ({ open, title, onClose, children, testId }) => {
    const titleId = React.useId();
    const close = React.useRef(onClose);
    close.current = onClose;

    React.useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") close.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);
    useOverlay(open, onClose);

    if (!open) return null;
    return createPortal(
        <div
            className="bottom-sheet-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="bottom-sheet ui-scroll" role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} data-testid={testId}>
                {title ? (
                    <div className="bottom-sheet-title" id={titleId}>
                        {title}
                    </div>
                ) : null}
                {children}
            </div>
        </div>,
        document.body
    );
};
