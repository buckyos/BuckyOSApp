export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'buckyos.theme';

export function getTheme(): Theme {
  const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null);
  if (saved === 'light' || saved === 'dark') return saved;
  // Fallback to system preference
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
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

