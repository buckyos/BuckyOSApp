import React from "react";
import { useSearchParams } from "react-router-dom";
import { useIframeBridge, useBuckyIframeActions } from "../bridges/iframeBridge";
import MobileHeader from "../components/ui/MobileHeader";
import { isMobileShell } from "../utils/platform";

const DEFAULT_URL = "/test_api.html";

const WebContainer: React.FC = () => {
    const [searchParams] = useSearchParams();
    const target = decodeURIComponent(searchParams.get("src") || DEFAULT_URL);
    const windowLabel = searchParams.get("label") || "webview_external";
    const title = searchParams.get("title") || windowLabel;
    const embedded = searchParams.get("embedded") === "1";
    const isMobileEmbedded = embedded && isMobileShell();
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [frameLayout, setFrameLayout] = React.useState({ sameOrigin: false, height: "100%" });

    const { iframeRef, defaultActionHandlers } = useBuckyIframeActions();
    useIframeBridge({ iframeRef, handlers: defaultActionHandlers });

    const syncIframeHeight = React.useCallback(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        let frameDocument: Document | null = null;
        try {
            frameDocument = iframe.contentDocument;
        } catch {
            frameDocument = null;
        }

        if (!frameDocument) {
            setFrameLayout((prev) => prev.sameOrigin ? { sameOrigin: false, height: "100%" } : prev);
            return;
        }

        const documentHeight = Math.max(
            frameDocument.documentElement.scrollHeight,
            frameDocument.body?.scrollHeight ?? 0,
            frameDocument.documentElement.offsetHeight,
            frameDocument.body?.offsetHeight ?? 0
        );
        const nextHeight = documentHeight > 0 ? `${Math.ceil(documentHeight)}px` : "100%";
        setFrameLayout((prev) =>
            prev.sameOrigin === true && prev.height === nextHeight
                ? prev
                : { sameOrigin: true, height: nextHeight }
        );
    }, [iframeRef]);

    React.useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        let frameResizeObserver: ResizeObserver | undefined;
        let animationFrame = 0;
        let cleanupFrameListeners: (() => void) | undefined;

        const scheduleSync = () => {
            cancelAnimationFrame(animationFrame);
            animationFrame = requestAnimationFrame(syncIframeHeight);
        };

        const bindFrameDocument = () => {
            cleanupFrameListeners?.();
            frameResizeObserver?.disconnect();
            frameResizeObserver = undefined;

            let frameDocument: Document | null = null;
            try {
                frameDocument = iframe.contentDocument;
            } catch {
                frameDocument = null;
            }

            if (!frameDocument) {
                setFrameLayout((prev) => prev.sameOrigin ? { sameOrigin: false, height: "100%" } : prev);
                return;
            }
            const currentFrameDocument = frameDocument;

            scheduleSync();

            if (typeof ResizeObserver !== "undefined") {
                frameResizeObserver = new ResizeObserver(scheduleSync);
                frameResizeObserver.observe(currentFrameDocument.documentElement);
                if (currentFrameDocument.body) {
                    frameResizeObserver.observe(currentFrameDocument.body);
                }
            }

            let lastTouchY: number | null = null;

            const scrollFrameElementIntoView = (element: Element | null, delay = 120) => {
                const frameWindow = currentFrameDocument.defaultView;
                if (!frameWindow || !(element instanceof frameWindow.HTMLElement)) return;

                window.setTimeout(() => {
                    const scrollContainer = scrollContainerRef.current;
                    if (!scrollContainer) return;

                    const iframeRect = iframe.getBoundingClientRect();
                    const elementRect = element.getBoundingClientRect();
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const keyboardInsetBottom =
                        Number.parseFloat(
                            getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset-bottom")
                        ) || 0;
                    const visibleBottom = Math.min(containerRect.bottom, window.innerHeight - keyboardInsetBottom);
                    const elementTop = iframeRect.top + elementRect.top;
                    const elementBottom = iframeRect.top + elementRect.bottom;
                    const edgePadding = 16;

                    if (elementBottom > visibleBottom - edgePadding) {
                        scrollContainer.scrollTop += elementBottom - (visibleBottom - edgePadding);
                    } else if (elementTop < containerRect.top + edgePadding) {
                        scrollContainer.scrollTop -= (containerRect.top + edgePadding) - elementTop;
                    }
                }, delay);
            };

            const handleTouchStart = (event: TouchEvent) => {
                if (event.touches.length !== 1) {
                    lastTouchY = null;
                    return;
                }
                lastTouchY = event.touches[0].clientY;
            };

            const handleTouchMove = (event: TouchEvent) => {
                const scrollContainer = scrollContainerRef.current;
                if (lastTouchY === null || !scrollContainer || event.touches.length !== 1) {
                    return;
                }

                const currentTouchY = event.touches[0].clientY;
                const deltaY = lastTouchY - currentTouchY;
                if (Math.abs(deltaY) < 1) {
                    return;
                }

                const previousScrollTop = scrollContainer.scrollTop;
                scrollContainer.scrollTop += deltaY;
                lastTouchY = currentTouchY;

                if (scrollContainer.scrollTop !== previousScrollTop) {
                    event.preventDefault();
                }
            };

            const handleTouchEnd = () => {
                lastTouchY = null;
            };

            const handleFocusIn = (event: FocusEvent) => {
                scrollFrameElementIntoView(event.target as Element | null);
            };

            const handleInsetsChange = () => {
                scrollFrameElementIntoView(currentFrameDocument.activeElement);
            };

            currentFrameDocument.addEventListener("touchstart", handleTouchStart);
            currentFrameDocument.addEventListener("touchmove", handleTouchMove, { passive: false });
            currentFrameDocument.addEventListener("touchend", handleTouchEnd);
            currentFrameDocument.addEventListener("touchcancel", handleTouchEnd);
            currentFrameDocument.addEventListener("focusin", handleFocusIn);
            currentFrameDocument.defaultView?.addEventListener("android-window-insets-change", handleInsetsChange);

            cleanupFrameListeners = () => {
                currentFrameDocument.removeEventListener("touchstart", handleTouchStart);
                currentFrameDocument.removeEventListener("touchmove", handleTouchMove);
                currentFrameDocument.removeEventListener("touchend", handleTouchEnd);
                currentFrameDocument.removeEventListener("touchcancel", handleTouchEnd);
                currentFrameDocument.removeEventListener("focusin", handleFocusIn);
                currentFrameDocument.defaultView?.removeEventListener("android-window-insets-change", handleInsetsChange);
            };
        };

        bindFrameDocument();
        iframe.addEventListener("load", bindFrameDocument);
        window.addEventListener("resize", scheduleSync);
        window.visualViewport?.addEventListener("resize", scheduleSync);

        return () => {
            cancelAnimationFrame(animationFrame);
            frameResizeObserver?.disconnect();
            cleanupFrameListeners?.();
            iframe.removeEventListener("load", bindFrameDocument);
            window.removeEventListener("resize", scheduleSync);
            window.visualViewport?.removeEventListener("resize", scheduleSync);
        };
    }, [iframeRef, syncIframeHeight]);

    return (
        <div
            className="App"
            style={{
                width: isMobileEmbedded ? "100%" : "100vw",
                height: isMobileEmbedded ? "100dvh" : "100vh",
                margin: 0,
                padding: isMobileEmbedded
                    ? "0 0 calc(var(--mobile-system-bottom) + var(--keyboard-inset-bottom))"
                    : embedded && !isMobileEmbedded ? "0 16px 16px" : 0,
                display: "flex",
                flexDirection: "column",
                overflow: isMobileEmbedded ? "hidden" : undefined,
                background: isMobileEmbedded ? "var(--app-bg)" : undefined,
            }}
        >
            {isMobileEmbedded ? (
                <div
                    style={{
                        padding: "max(8px, var(--mobile-system-top)) calc(16px + var(--safe-area-inset-right)) 12px calc(16px + var(--safe-area-inset-left))",
                        background: "var(--app-bg)",
                        flexShrink: 0,
                    }}
                >
                    <MobileHeader title={title} showBack safeAreaTop={false} />
                </div>
            ) : embedded ? <MobileHeader title={title} showBack /> : null}
            <div
                ref={scrollContainerRef}
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflowY: frameLayout.sameOrigin ? "auto" : "hidden",
                    paddingBottom: frameLayout.sameOrigin ? 16 : 0,
                    WebkitOverflowScrolling: "touch",
                }}
            >
                <iframe
                    ref={iframeRef}
                    title={title}
                    src={target}
                    scrolling={frameLayout.sameOrigin ? "no" : undefined}
                    style={{
                        width: "100%",
                        height: frameLayout.sameOrigin ? frameLayout.height : "100%",
                        border: "none",
                        flex: frameLayout.sameOrigin ? "0 0 auto" : 1,
                        minHeight: frameLayout.sameOrigin ? undefined : 0,
                        display: "block",
                        background: isMobileEmbedded ? "#fff" : undefined,
                    }}
                />
            </div>
        </div>
    );
};

export default WebContainer;
