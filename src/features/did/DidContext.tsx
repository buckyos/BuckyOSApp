import React from "react";
import { listDids, fetchActiveDid, setActiveDid as setActiveDidOnBackend } from "./api";
import type { DidInfo } from "./types";

interface DidContextValue {
    dids: DidInfo[];
    activeDid: DidInfo | null;
    loading: boolean;
    refresh: () => Promise<void>;
    setActiveDid: (id: string) => Promise<void>;
}

const DidContext = React.createContext<DidContextValue | undefined>(undefined);

async function loadSnapshot(): Promise<{ dids: DidInfo[]; activeDid: DidInfo | null; }> {
    const [dids, activeDid] = await Promise.all([listDids(), fetchActiveDid()]);
    return { dids, activeDid };
}

export const DidProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [dids, setDids] = React.useState<DidInfo[]>([]);
    const [activeDid, setActiveDid] = React.useState<DidInfo | null>(null);
    const [loading, setLoading] = React.useState(true);

    const refresh = React.useCallback(async () => {
        setLoading(true);
        try {
            const snapshot = await loadSnapshot();
            setDids(snapshot.dids);
            setActiveDid(snapshot.activeDid);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refresh().catch((err) => {
            console.error("Failed to load DID snapshot", err);
            setLoading(false);
        });
    }, [refresh]);

    const setActiveDidHandler = React.useCallback(async (id: string) => {
        try {
            const updated = await setActiveDidOnBackend(id);
            setActiveDid(updated);
            setDids((prev) => {
                const index = prev.findIndex((item) => item.id === id);
                if (index === -1) {
                    return prev;
                }
                const next = prev.slice();
                next[index] = updated;
                return next;
            });
        } catch (err) {
            console.error("Failed to set active DID", err);
            throw err;
        }
    }, []);

    const value = React.useMemo<DidContextValue>(() => ({
        dids,
        activeDid,
        loading,
        refresh,
        setActiveDid: setActiveDidHandler,
    }), [dids, activeDid, loading, refresh, setActiveDidHandler]);

    return <DidContext.Provider value={value}>{children}</DidContext.Provider>;
};

export function useDidContext(): DidContextValue {
    const context = React.useContext(DidContext);
    if (!context) {
        throw new Error("useDidContext must be used within a DidProvider");
    }
    return context;
}
