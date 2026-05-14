import React from "react";
import MobileHeader from "../../components/ui/MobileHeader";
import { useI18n } from "../../i18n";
import { useIframeBridge, useBuckyIframeActions } from "../../bridges/iframeBridge";

const EmbeddedWebView: React.FC = () => {
    const { t } = useI18n();
    const { iframeRef, defaultActionHandlers } = useBuckyIframeActions();
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [iframeHeight, setIframeHeight] = React.useState("100%");

    const syncIframeHeight = React.useCallback(() => {
        const iframe = iframeRef.current;
        const frameDocument = iframe?.contentDocument;
        if (!iframe || !frameDocument) return;

        const documentHeight = Math.max(
            frameDocument.documentElement.scrollHeight,
            frameDocument.body?.scrollHeight ?? 0,
            frameDocument.documentElement.offsetHeight,
            frameDocument.body?.offsetHeight ?? 0
        );

        if (documentHeight > 0) {
            setIframeHeight(`${Math.ceil(documentHeight)}px`);
        }
    }, [iframeRef]);

    useIframeBridge({ iframeRef, handlers: defaultActionHandlers });

    React.useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe) return;

        let frameResizeObserver: ResizeObserver | undefined;
        let animationFrame = 0;
        let cleanupFrameTouchScroll: (() => void) | undefined;

        const scheduleSync = () => {
            cancelAnimationFrame(animationFrame);
            animationFrame = requestAnimationFrame(syncIframeHeight);
        };

        const bindFrameDocument = () => {
            scheduleSync();

            const frameDocument = iframe.contentDocument;
            if (!frameDocument || typeof ResizeObserver === "undefined") return;

            frameResizeObserver?.disconnect();
            frameResizeObserver = new ResizeObserver(scheduleSync);
            frameResizeObserver.observe(frameDocument.documentElement);
            if (frameDocument.body) {
                frameResizeObserver.observe(frameDocument.body);
            }

            cleanupFrameTouchScroll?.();

            let lastTouchY: number | null = null;

            const scrollFrameElementIntoView = (element: Element | null, delay = 120) => {
                if (!(element instanceof HTMLElement)) return;

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
                scrollFrameElementIntoView(event.target instanceof Element ? event.target : null);
            };

            const handleInsetsChange = () => {
                scrollFrameElementIntoView(frameDocument.activeElement);
            };

            frameDocument.addEventListener("touchstart", handleTouchStart);
            frameDocument.addEventListener("touchmove", handleTouchMove, { passive: false });
            frameDocument.addEventListener("touchend", handleTouchEnd);
            frameDocument.addEventListener("touchcancel", handleTouchEnd);
            frameDocument.addEventListener("focusin", handleFocusIn);
            frameDocument.defaultView?.addEventListener("android-window-insets-change", handleInsetsChange);

            cleanupFrameTouchScroll = () => {
                frameDocument.removeEventListener("touchstart", handleTouchStart);
                frameDocument.removeEventListener("touchmove", handleTouchMove);
                frameDocument.removeEventListener("touchend", handleTouchEnd);
                frameDocument.removeEventListener("touchcancel", handleTouchEnd);
                frameDocument.removeEventListener("focusin", handleFocusIn);
                frameDocument.defaultView?.removeEventListener("android-window-insets-change", handleInsetsChange);
            };
        };

        bindFrameDocument();
        iframe.addEventListener("load", bindFrameDocument);
        window.addEventListener("resize", scheduleSync);
        window.visualViewport?.addEventListener("resize", scheduleSync);

        return () => {
            cancelAnimationFrame(animationFrame);
            frameResizeObserver?.disconnect();
            cleanupFrameTouchScroll?.();
            iframe.removeEventListener("load", bindFrameDocument);
            window.removeEventListener("resize", scheduleSync);
            window.visualViewport?.removeEventListener("resize", scheduleSync);
        };
    }, [iframeRef, syncIframeHeight]);

    return (
        <div className="mobile-page">
            <MobileHeader title={t("settings.embedded_webview_title")} showBack safeAreaTop />
            <div
                ref={scrollContainerRef}
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    paddingBottom: "calc(16px + var(--keyboard-inset-bottom))",
                }}
            >
                <div
                    style={{
                        width: "100%",
                        borderRadius: 16,
                        border: "1px solid var(--border)",
                        overflow: "hidden",
                        background: "#fff",
                    }}
                >
                    <iframe
                        ref={iframeRef}
                        title="embedded-webview"
                        src="/test_api.html"
                        scrolling="no"
                        style={{ width: "100%", height: iframeHeight, border: "none", display: "block" }}
                    />
                </div>
            </div>
        </div>
    );
};

export default EmbeddedWebView;
