const MOBILE_SHELL_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;

let androidKeyboardFocusHandlerAttached = false;
const keyboardBoundDocuments = new WeakSet<Document>();
const keyboardBoundIframes = new WeakSet<HTMLIFrameElement>();

export function isMobileShell() {
    return MOBILE_SHELL_USER_AGENT_RE.test(window.navigator.userAgent);
}

export function isAndroidShell() {
    return /Android/i.test(window.navigator.userAgent);
}

function getKeyboardInsetBottom() {
    return getComputedStyle(document.documentElement)
        .getPropertyValue("--keyboard-inset-bottom")
        .trim() || "0px";
}

function scrollFocusedControlIntoView(targetDocument: Document) {
    const active = targetDocument.activeElement;
    if (
        !(active instanceof HTMLInputElement) &&
        !(active instanceof HTMLTextAreaElement)
    ) {
        return;
    }

    window.setTimeout(() => {
        active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }, 80);
}

function bindKeyboardDocument(targetDocument: Document) {
    if (keyboardBoundDocuments.has(targetDocument)) {
        return;
    }

    keyboardBoundDocuments.add(targetDocument);
    targetDocument.addEventListener("focusin", () => scrollFocusedControlIntoView(targetDocument));
    targetDocument.defaultView?.addEventListener("android-window-insets-change", () => {
        scrollFocusedControlIntoView(targetDocument);
    });
}

function syncKeyboardInsetToIframe(iframe: HTMLIFrameElement) {
    try {
        const frameWindow = iframe.contentWindow;
        const frameDocument = frameWindow?.document;
        if (!frameWindow || !frameDocument) {
            return;
        }

        const keyboardInsetBottom = getKeyboardInsetBottom();
        frameDocument.documentElement.style.setProperty("--keyboard-inset-bottom", keyboardInsetBottom);
        frameDocument.documentElement.style.setProperty("--keyboard-inset", keyboardInsetBottom);
        bindKeyboardDocument(frameDocument);
        frameWindow.dispatchEvent(new CustomEvent("android-window-insets-change", {
            detail: { keyboardInsetBottom },
        }));
    } catch {
        // Cross-origin iframe content cannot be adjusted from the host page.
    }
}

function bindKeyboardIframe(iframe: HTMLIFrameElement) {
    if (keyboardBoundIframes.has(iframe)) {
        return;
    }

    keyboardBoundIframes.add(iframe);
    iframe.addEventListener("load", () => syncKeyboardInsetToIframe(iframe));
    syncKeyboardInsetToIframe(iframe);
}

function syncKeyboardInsetsToIframes() {
    document.querySelectorAll("iframe").forEach(bindKeyboardIframe);
}

export function applyPlatformAttributes() {
    const root = document.documentElement;
    const body = document.body;
    const mobileShell = isMobileShell();
    const androidShell = isAndroidShell();

    root.toggleAttribute("data-mobile-shell", mobileShell);
    body.toggleAttribute("data-mobile-shell", mobileShell);

    if (androidShell && !androidKeyboardFocusHandlerAttached) {
        androidKeyboardFocusHandlerAttached = true;

        bindKeyboardDocument(document);
        syncKeyboardInsetsToIframes();

        const iframeObserver = new MutationObserver((records) => {
            records.forEach((record) => {
                record.addedNodes.forEach((node) => {
                    if (node instanceof HTMLIFrameElement) {
                        bindKeyboardIframe(node);
                        return;
                    }

                    if (node instanceof HTMLElement) {
                        node.querySelectorAll("iframe").forEach(bindKeyboardIframe);
                    }
                });
            });
        });

        iframeObserver.observe(document.body, { childList: true, subtree: true });

        window.addEventListener("android-window-insets-change", () => {
            scrollFocusedControlIntoView(document);
            syncKeyboardInsetsToIframes();
        });
    }
}
