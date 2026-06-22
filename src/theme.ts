export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'buckyos.theme';

declare global {
    interface Window {
        BuckySystemBars?: {
            setTheme?: (theme: Theme) => void;
        };
    }
}

export function getTheme(): Theme {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null);
    if (saved === 'light' || saved === 'dark') return saved;
    // Fallback to system preference
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
    const root = document.documentElement;
    const body = document.body;
    root.setAttribute('data-theme', theme);
    body.setAttribute('data-theme', theme);
    if (theme === 'dark') {
        root.style.colorScheme = 'dark';
    } else {
        root.style.colorScheme = 'light';
    }
    syncAndroidSystemBars(theme);
}

function syncAndroidSystemBars(theme: Theme) {
    try {
        window.BuckySystemBars?.setTheme?.(theme);
    } catch {
        // The native bridge is only present inside the Android shell.
    }
}

export function toggleTheme(): Theme {
    const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    return next;
}

export function initTheme() {
    applyTheme(getTheme());
}
