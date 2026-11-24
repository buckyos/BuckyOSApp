function allowsNativeMenu(event: Event): boolean {
    return event.composedPath().some((node) => {
        if (!(node instanceof HTMLElement)) return false;
        return (
            node instanceof HTMLInputElement ||
            node instanceof HTMLTextAreaElement ||
            node.isContentEditable ||
            node.classList.contains("selectable")
        );
    });
}

/** Takes the browser's own menu away from this window and its same-origin frames, except where text is edited. */
export function preventContextMenu(): () => void {
    const prevent = (event: Event) => {
        // Development keeps it for "Inspect Element".
        if (import.meta.env.DEV) return;
        if (!allowsNativeMenu(event)) event.preventDefault();
    };

    const attach = (target: Document | null) => target?.addEventListener("contextmenu", prevent, true);
    const detach = (target: Document | null) => target?.removeEventListener("contextmenu", prevent, true);

    const bindFrame = (frame: HTMLIFrameElement) => {
        const onLoad = () => {
            try {
                attach(frame.contentWindow?.document ?? null);
            } catch {
                // Cross-origin frames cannot be reached from here.
            }
        };
        frame.addEventListener("load", onLoad);
        onLoad();
        return () => {
            frame.removeEventListener("load", onLoad);
            try {
                detach(frame.contentWindow?.document ?? null);
            } catch {
                // Ignore cross-origin frames.
            }
        };
    };

    attach(document);
    const cleanups = [...document.querySelectorAll("iframe")].map(bindFrame);
    const observer = new MutationObserver((records) => {
        for (const record of records) {
            record.addedNodes.forEach((node) => {
                if (node instanceof HTMLIFrameElement) cleanups.push(bindFrame(node));
            });
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
        observer.disconnect();
        detach(document);
        cleanups.forEach((cleanup) => cleanup());
    };
}
