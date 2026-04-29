const MOBILE_SHELL_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;

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

    root.toggleAttribute("data-mobile-shell", mobileShell);
    body.toggleAttribute("data-mobile-shell", mobileShell);
}
