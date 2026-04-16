import { useEffect } from "react";
import "./App.css";
import AppRoutes from "./app/AppRoutes";
import { initTheme } from "./theme";

function App() {
    useEffect(() => {
        initTheme();

        const allowNativeContextMenu = (event: Event) => {
            const path = "composedPath" in event ? event.composedPath() : [];
            const elements = path.filter((node): node is HTMLElement => node instanceof HTMLElement);

            return elements.some((element) => {
                if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                    return true;
                }

                return element.isContentEditable;
            });
        };

        const preventContextMenu = (event: Event) => {
            if (allowNativeContextMenu(event)) {
                return;
            }

            event.preventDefault();
        };

        const attachToDocument = (target: Document | null) => {
            target?.addEventListener("contextmenu", preventContextMenu, true);
        };

        const detachFromDocument = (target: Document | null) => {
            target?.removeEventListener("contextmenu", preventContextMenu, true);
        };

        const bindIframe = (iframe: HTMLIFrameElement) => {
            const handleLoad = () => {
                try {
                    attachToDocument(iframe.contentWindow?.document ?? null);
                } catch {
                    // Cross-origin iframes cannot be accessed from the host page.
                }
            };

            iframe.addEventListener("load", handleLoad);
            handleLoad();

            return () => {
                iframe.removeEventListener("load", handleLoad);
                try {
                    detachFromDocument(iframe.contentWindow?.document ?? null);
                } catch {
                    // Ignore cleanup failures for cross-origin frames.
                }
            };
        };

        attachToDocument(document);

        const cleanupIframes = Array.from(document.querySelectorAll("iframe")).map(bindIframe);
        const observer = new MutationObserver((records) => {
            records.forEach((record) => {
                record.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLIFrameElement)) {
                        return;
                    }

                    cleanupIframes.push(bindIframe(node));
                });
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });

        return () => {
            observer.disconnect();
            detachFromDocument(document);
            cleanupIframes.forEach((cleanup) => cleanup());
        };
    }, []);

    return <AppRoutes />;
}

export default App;
