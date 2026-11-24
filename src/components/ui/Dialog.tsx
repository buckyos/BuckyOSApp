import React from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../../features/content/useOverlay";

interface DialogProps {
    open: boolean;
    title: string;
    message?: React.ReactNode;
    /** Enter submits when given. */
    onSubmit?: () => void;
    onClose: () => void;
    /** Nothing closes the dialog while it works. */
    locked?: boolean;
    children?: React.ReactNode;
    actions?: React.ReactNode;
    testId?: string;
}

/** A dialog in the middle of the window; Escape and a click beside it close it. */
export const Dialog: React.FC<DialogProps> = ({ open, title, message, onSubmit, onClose, locked = false, children, actions, testId }) => {
    const titleId = React.useId();
    const panelRef = React.useRef<HTMLFormElement | null>(null);
    const close = React.useRef(onClose);
    close.current = onClose;
    const pressedOutside = React.useRef(false);

    React.useEffect(() => {
        if (!open) return;
        const panel = panelRef.current;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const target =
            panel?.querySelector<HTMLElement>("[data-autofocus]") ??
            panel?.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled)") ??
            panel?.querySelector<HTMLElement>("button[type='submit'], button:not(:disabled)");
        target?.focus();
        return () => previous?.focus?.();
    }, [open]);

    React.useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !locked) close.current();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, locked]);

    useOverlay(open, () => {
        if (!locked) onClose();
    });

    if (!open) return null;
    return createPortal(
        <div
            className="ui-scrim"
            // A drag that starts inside the panel and ends outside is not a click beside it.
            onPointerDown={(event) => {
                pressedOutside.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget && pressedOutside.current && !locked) onClose();
            }}
        >
            <form
                ref={panelRef}
                className="ui-dialog ui-scroll"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-testid={testId}
                noValidate
                onSubmit={(event) => {
                    event.preventDefault();
                    if (!locked) onSubmit?.();
                }}
            >
                <div className="ui-dialog-title" id={titleId}>
                    {title}
                </div>
                {message ? <div className="ui-dialog-message">{message}</div> : null}
                {children}
                {actions ? <div className="ui-dialog-actions">{actions}</div> : null}
            </form>
        </div>,
        document.body
    );
};
