import React from "react";
import { clientRuntime } from "../content/clientRuntime";
import { createRetry, type Retry } from "../zone/retry";
import type { ZoneView } from "../zone/types";
import type { AppCatalog, AppEntry } from "./catalog";
import { appName } from "./catalog";

const noop = () => () => undefined;

export interface CatalogState {
    catalog: AppCatalog | undefined;
    loading: boolean;
    failed: boolean;
    reload: () => void;
}

/** The apps of a Zone: what is known at once, then what the Zone says now; asked again until it says. */
export function useCatalog(zone: ZoneView | null): CatalogState {
    const catalog = React.useSyncExternalStore(zone ? clientRuntime.open.subscribe : noop, () =>
        zone ? clientRuntime.open.cachedCatalog(zone) : undefined
    );
    const [state, setState] = React.useState<{ key: string; loading: boolean; failed: boolean }>({ key: "", loading: false, failed: false });
    const latest = React.useRef(zone);
    latest.current = zone;
    const ready = zone?.session.state === "signed_in";
    const key = zone && ready ? `${zone.did}|${zone.host}|${zone.session.identity?.user_id ?? ""}` : "";

    const retry = React.useRef<Retry | null>(null);

    const read = React.useCallback((forKey: string, maxAge?: number, quiet = false) => {
        const target = latest.current;
        const attempts = retry.current;
        if (!target || !forKey) return;
        if (!quiet) setState({ key: forKey, loading: true, failed: false });
        clientRuntime.open.catalog(target, maxAge).then(
            () => {
                attempts?.succeeded();
                setState((now) => (now.key === forKey ? { key: forKey, loading: false, failed: false } : now));
            },
            (error) => {
                console.warn("[Apps] reading the apps failed", target.host, error);
                // Of an effect that is over, it is stopped by now.
                if (attempts === retry.current) attempts?.failed();
                setState((now) => (now.key === forKey ? { key: forKey, loading: false, failed: true } : now));
            }
        );
    }, []);

    React.useEffect(() => {
        if (!key) return;
        const attempts = createRetry(() => read(key, undefined, true));
        retry.current = attempts;
        read(key);
        return () => {
            attempts.stop();
            if (retry.current === attempts) retry.current = null;
        };
    }, [key, read]);

    const reload = React.useCallback(() => read(key, 0), [key, read]);
    const current = state.key === key;
    return {
        catalog,
        loading: Boolean(key) && !catalog && (!current || state.loading),
        failed: current && state.failed,
        reload,
    };
}

/** The entries a launcher shows, in the catalog's order, or those whose name or id contains the text. */
export function launcherEntries(catalog: AppCatalog, locale: string, search = ""): AppEntry[] {
    const text = search.trim().toLocaleLowerCase();
    return catalog.entries.filter((entry) => {
        if (!entry.launcher) return false;
        if (!text) return true;
        const names = [appName(entry, locale), entry.name, entry.id, ...Object.values(entry.names)];
        return names.some((name) => typeof name === "string" && name.toLocaleLowerCase().includes(text));
    });
}
