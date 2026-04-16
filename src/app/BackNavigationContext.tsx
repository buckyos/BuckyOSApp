import React from "react";

type BackHandler = (() => void) | null;

interface BackNavigationContextValue {
    setBackHandler: (handler: BackHandler) => void;
    backHandler: BackHandler;
}

const BackNavigationContext = React.createContext<BackNavigationContextValue | null>(null);

export const BackNavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [backHandler, setBackHandler] = React.useState<BackHandler>(null);

    const value = React.useMemo(
        () => ({
            backHandler,
            setBackHandler,
        }),
        [backHandler]
    );

    return (
        <BackNavigationContext.Provider value={value}>
            {children}
        </BackNavigationContext.Provider>
    );
};

export function useBackNavigation() {
    const context = React.useContext(BackNavigationContext);
    if (!context) {
        throw new Error("useBackNavigation must be used within BackNavigationProvider");
    }
    return context;
}
