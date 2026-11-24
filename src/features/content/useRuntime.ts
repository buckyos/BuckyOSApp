import React from "react";
import { clientRuntime, type RuntimeSnapshot } from "./clientRuntime";

export function useRuntime(): RuntimeSnapshot {
    return React.useSyncExternalStore(clientRuntime.subscribe, clientRuntime.getSnapshot);
}
