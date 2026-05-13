const MOBILE_SHELL_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;

let androidKeyboardFocusHandlerAttached = false;
const keyboardBoundDocuments = new WeakSet<Document>();
const keyboardBoundIframes = new WeakSet<HTMLIFrameElement>();
const keyboardScrollTimers = new WeakMap<Document, number>();

export function isMobileShell() {
    return MOBILE_SHELL_USER_AGENT_RE.test(window.navigator.userAgent);
}

export function isAndroidShell() {
    return /Android/i.test(window.navigator.userAgent);
}

function getKeyboardInsetBottom(targetDocument: Document = document) {
    return getComputedStyle(targetDocument.documentElement)
        .getPropertyValue("--keyboard-inset-bottom")
        .trim() || "0px";
}

function parseCssPixelValue(value: string) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function scrollFocusedControlIntoView(targetDocument: Document, delay = 120) {
    const targetWindow = targetDocument.defaultView ?? window;
    const active = targetDocument.activeElement;
    if (
        !(active instanceof HTMLInputElement) &&
        !(active instanceof HTMLTextAreaElement)
    ) {
        return;
    }

    const pendingTimer = keyboardScrollTimers.get(targetDocument);
    if (pendingTimer !== undefined) {
        targetWindow.clearTimeout(pendingTimer);
    }

    const timer = targetWindow.setTimeout(() => {
        if (targetDocument.activeElement !== active) {
            return;
        }

        active.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    }, delay);

    keyboardScrollTimers.set(targetDocument, timer);
}

function bindKeyboardDocument(targetDocument: Document, listenForInsetChanges = true) {
    if (keyboardBoundDocuments.has(targetDocument)) {
        return;
    }

    keyboardBoundDocuments.add(targetDocument);
    targetDocument.addEventListener("focusin", () => scrollFocusedControlIntoView(targetDocument, 160));

    if (listenForInsetChanges) {
        targetDocument.defaultView?.addEventListener("android-window-insets-change", () => {
            if (parseCssPixelValue(getKeyboardInsetBottom(targetDocument)) > 0) {
                scrollFocusedControlIntoView(targetDocument);
            }
        });
    }
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

        bindKeyboardDocument(document, false);
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
            syncKeyboardInsetsToIframes();
            if (parseCssPixelValue(getKeyboardInsetBottom()) > 0) {
                scrollFocusedControlIntoView(document);
            }
        });
    }
}
