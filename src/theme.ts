export type Theme = 'light' | 'dark';
export type ThemePreference = 'system' | Theme;

const STORAGE_KEY = 'buckyos.theme';

declare global {
    interface Window {
        BuckySystemBars?: {
            setTheme?: (theme: Theme) => void;
        };
    }
}

const listeners = new Set<() => void>();
let watching = false;

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

export function getThemePreference(): ThemePreference {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
    } catch {
        // Fall back to the system's.
    }
    return 'system';
}

export function getTheme(): Theme {
    const preference = getThemePreference();
    if (preference !== 'system') return preference;
    return systemDark()?.matches ? 'dark' : 'light';
}

const notify = () => listeners.forEach((listener) => listener());

export function applyTheme(theme: Theme) {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    syncAndroidSystemBars(theme);
}

function syncAndroidSystemBars(theme: Theme) {
    try {
        window.BuckySystemBars?.setTheme?.(theme);
    } catch {
        // The native bridge is only present inside the Android shell.
    }
}

export function setThemePreference(preference: ThemePreference) {
    try {
        if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
        // Applies until the window closes.
    }
    applyTheme(preference === 'system' ? getTheme() : preference);
    notify();
}

export function toggleTheme(): Theme {
    const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
    setThemePreference(next);
    return next;
}

/** Theme or preference changes, here or in another window of the client. */
export function subscribeTheme(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function initTheme() {
    applyTheme(getTheme());
    if (watching) return;
    watching = true;
    const follow = () => {
        applyTheme(getTheme());
        notify();
    };
    systemDark()?.addEventListener?.('change', follow);
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) follow();
    });
}
