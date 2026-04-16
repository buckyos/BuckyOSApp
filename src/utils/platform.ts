const MOBILE_SHELL_USER_AGENT_RE = /Android|iPhone|iPad|iPod/i;

export function isMobileShell() {
    return MOBILE_SHELL_USER_AGENT_RE.test(window.navigator.userAgent);
}

export function isAndroidShell() {
    return /Android/i.test(window.navigator.userAgent);
}
