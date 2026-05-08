const MOBILE_SHELL_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;

let androidKeyboardFocusHandlerAttached = false;

export function isMobileShell() {
    return MOBILE_SHELL_USER_AGENT_RE.test(window.navigator.userAgent);
}

export function isAndroidShell() {
    return /Android/i.test(window.navigator.userAgent);
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
        const scrollFocusedControlIntoView = () => {
            const active = document.activeElement;
            if (
                !(active instanceof HTMLInputElement) &&
                !(active instanceof HTMLTextAreaElement)
            ) {
                return;
            }

            window.setTimeout(() => {
                active.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
            }, 80);
        };

        document.addEventListener("focusin", scrollFocusedControlIntoView);
        window.addEventListener("android-window-insets-change", scrollFocusedControlIntoView);
    }
}
