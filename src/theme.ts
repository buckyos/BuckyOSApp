export type Theme = 'light' | 'dark';
export type ThemePreference = 'system' | Theme;

const STORAGE_KEY = 'buckyos.theme';

declare global {
    interface Window {
        BuckySystemBars?: {
            setTheme?: (theme: ThemePreference) => void;
        };
        webkit?: {
            messageHandlers?: {
                buckyTheme?: { postMessage: (theme: ThemePreference) => void };
            };
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
    syncSystemBars();
}

/** The status bar, the keyboard and the system's dialogs follow the client's theme. */
function syncSystemBars() {
    // Told the theme that comes of it, the system would no longer say when its own changes.
    const preference = getThemePreference();
    try {
        window.BuckySystemBars?.setTheme?.(preference);
        window.webkit?.messageHandlers?.buckyTheme?.postMessage(preference);
    } catch {
        // The native bridges are only there on a phone.
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
    // iOS: the native side came after this page.
    window.addEventListener('native-ready', syncSystemBars);
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY) follow();
    });
}
