/**
 * A page in a frame of the client: the local test page, and on iOS a device's activation page.
 * Everywhere else pages of others get a WebView of their own (`activation_open`, `content_open`).
 */
export function openEmbeddedPage(target: string, title: string): void {
    window.location.hash = `#/web-container?embedded=1&src=${encodeURIComponent(target)}&title=${encodeURIComponent(title)}`;
}

/** Whether a frame may show that address. */
export function mayEmbed(target: string, ios: boolean): boolean {
    if (target.startsWith("/") && !target.startsWith("//")) return true;
    return ios && /^https?:\/\//i.test(target);
}
