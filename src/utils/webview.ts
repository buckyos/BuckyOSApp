/**
 * A local page in a frame of the client: the test page. Pages of others get a WebView of their own
 * (`activation_open`, `content_open`).
 */
export function openEmbeddedPage(target: string, title: string): void {
    window.location.hash = `#/web-container?embedded=1&src=${encodeURIComponent(target)}&title=${encodeURIComponent(title)}`;
}

/** Whether a frame may show that address. */
export function mayEmbed(target: string): boolean {
    return target.startsWith("/") && !target.startsWith("//");
}
