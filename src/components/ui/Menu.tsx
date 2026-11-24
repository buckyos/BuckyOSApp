import React from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "../../features/content/useOverlay";

export interface MenuItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    tone?: "danger";
    disabled?: boolean;
    onSelect: () => void;
}

interface MenuProps {
    /** Where it opens, in the window's coordinates; null while closed. */
    at: { x: number; y: number } | null;
    items: MenuItem[];
    label: string;
    onClose: () => void;
}

const EDGE = 8;

/** Keeps a box of this size inside the window. */
export function placeMenu(at: { x: number; y: number }, size: { width: number; height: number }, screen: { width: number; height: number }) {
    return {
        left: Math.max(EDGE, Math.min(at.x, screen.width - size.width - EDGE)),
        top: at.y + size.height + EDGE <= screen.height ? at.y : Math.max(EDGE, at.y - size.height),
    };
}

export const Menu: React.FC<MenuProps> = ({ at, items, label, onClose }) => {
    const ref = React.useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
    const close = React.useRef(onClose);
    close.current = onClose;

    React.useLayoutEffect(() => {
        const panel = ref.current;
        if (!at || !panel) {
            setPosition(null);
            return;
        }
        setPosition(placeMenu(at, panel.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }));
    }, [at]);

    React.useEffect(() => {
        if (position) ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }, [position]);

    React.useEffect(() => {
        if (!at) return;
        const outside = (event: Event) => {
            if (!ref.current?.contains(event.target as Node)) close.current();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") close.current();
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        };
        const onBlur = () => close.current();
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("scroll", outside, true);
        window.addEventListener("keydown", onKey);
        window.addEventListener("blur", onBlur);
        return () => {
            document.removeEventListener("pointerdown", outside, true);
            document.removeEventListener("scroll", outside, true);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("blur", onBlur);
        };
    }, [at]);

    useOverlay(at !== null, onClose);

    if (!at) return null;
    return createPortal(
        <div ref={ref} className="ui-menu" role="menu" aria-label={label} style={position ?? { left: at.x, top: at.y, visibility: "hidden" }}>
            {items.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="ui-menu-item"
                    data-tone={item.tone}
                    disabled={item.disabled}
                    onClick={() => {
                        onClose();
                        item.onSelect();
                    }}
                >
                    {item.icon}
                    {item.label}
                </button>
            ))}
        </div>,
        document.body
    );
};
