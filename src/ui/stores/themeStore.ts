import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentColor = 'blue' | 'emerald' | 'violet' | 'rose' | 'amber';
export type FontFamily = 'system' | 'inter' | 'mono';
export type FontSize = 'sm' | 'md' | 'lg';

export interface AccentOption {
  id: AccentColor;
  name: string;
  color: string;
}

// Values mirror the [data-accent] tokens in variables.css; hover/subtle
// shades derive from the accent in CSS, so one value per entry is enough
export const AVAILABLE_ACCENTS: AccentOption[] = [
  { id: 'blue', name: 'Indigo (Default)', color: '#6366f1' },
  { id: 'emerald', name: 'Emerald', color: '#10b981' },
  { id: 'violet', name: 'Violet', color: '#8b5cf6' },
  { id: 'rose', name: 'Rose', color: '#f43f5e' },
  { id: 'amber', name: 'Amber', color: '#f59e0b' },
];

export interface ThemeState {
  mode: ThemeMode;
  effectiveTheme: 'dark' | 'light';
  accent: AccentColor;
  fontFamily: FontFamily;
  fontSize: FontSize;
}

const STORAGE_KEY_MODE = 'app_theme_mode';
const STORAGE_KEY_ACCENT = 'app_theme_accent';
const STORAGE_KEY_FONT = 'app_theme_font';
const STORAGE_KEY_FONT_SIZE = 'app_theme_font_size';

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function getInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MODE) as ThemeMode;
    if (saved === 'system' || saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {}
  return 'system';
}

function getInitialAccent(): AccentColor {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACCENT) as AccentColor;
    if (saved && AVAILABLE_ACCENTS.some((a) => a.id === saved)) {
      return saved;
    }
  } catch {}
  return 'blue';
}

function getInitialFont(): FontFamily {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_FONT) as FontFamily;
    if (saved === 'system' || saved === 'inter' || saved === 'mono') {
      return saved;
    }
  } catch {}
  return 'system';
}

function getInitialFontSize(): FontSize {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_FONT_SIZE) as FontSize;
    if (saved === 'sm' || saved === 'md' || saved === 'lg') {
      return saved;
    }
  } catch {}
  return 'md';
}

function applyDOMTheme(
  mode: ThemeMode,
  accent: AccentColor,
  fontFamily: FontFamily,
  fontSize: FontSize
): 'dark' | 'light' {
  const effective: 'dark' | 'light' = mode === 'system' ? getSystemTheme() : mode;
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', effective);
    document.documentElement.setAttribute('data-mode-pref', mode);
    document.documentElement.setAttribute('data-accent', accent);
    document.documentElement.setAttribute('data-font', fontFamily);
    document.documentElement.setAttribute('data-font-size', fontSize);
  }
  return effective;
}

const initialMode = getInitialMode();
const initialAccent = getInitialAccent();
const initialFont = getInitialFont();
const initialFontSize = getInitialFontSize();
const initialEffective = applyDOMTheme(
  initialMode,
  initialAccent,
  initialFont,
  initialFontSize
);

let state: ThemeState = {
  mode: initialMode,
  effectiveTheme: initialEffective,
  accent: initialAccent,
  fontFamily: initialFont,
  fontSize: initialFontSize,
};

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function updateTheme(partial: Partial<Omit<ThemeState, 'effectiveTheme'>>) {
  const nextMode = partial.mode ?? state.mode;
  const nextAccent = partial.accent ?? state.accent;
  const nextFont = partial.fontFamily ?? state.fontFamily;
  const nextFontSize = partial.fontSize ?? state.fontSize;

  const effectiveTheme = applyDOMTheme(nextMode, nextAccent, nextFont, nextFontSize);

  state = {
    mode: nextMode,
    accent: nextAccent,
    fontFamily: nextFont,
    fontSize: nextFontSize,
    effectiveTheme,
  };

  try {
    if (partial.mode !== undefined) localStorage.setItem(STORAGE_KEY_MODE, partial.mode);
    if (partial.accent !== undefined) localStorage.setItem(STORAGE_KEY_ACCENT, partial.accent);
    if (partial.fontFamily !== undefined) localStorage.setItem(STORAGE_KEY_FONT, partial.fontFamily);
    if (partial.fontSize !== undefined) localStorage.setItem(STORAGE_KEY_FONT_SIZE, partial.fontSize);
  } catch {}

  notify();
}

// OS color scheme listener
if (typeof window !== 'undefined' && window.matchMedia) {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', () => {
    if (state.mode === 'system') {
      const effective = applyDOMTheme(
        'system',
        state.accent,
        state.fontFamily,
        state.fontSize
      );
      state = { ...state, effectiveTheme: effective };
      notify();
    }
  });
}

export const themeStore = {
  getState: (): ThemeState => state,

  setMode: (mode: ThemeMode) => updateTheme({ mode }),
  setAccent: (accent: AccentColor) => updateTheme({ accent }),
  setFontFamily: (fontFamily: FontFamily) => updateTheme({ fontFamily }),
  setFontSize: (fontSize: FontSize) => updateTheme({ fontSize }),

  reset: () => {
    const effective = applyDOMTheme('system', 'blue', 'system', 'md');
    state = {
      mode: 'system',
      effectiveTheme: effective,
      accent: 'blue',
      fontFamily: 'system',
      fontSize: 'md',
    };
    try {
      localStorage.removeItem(STORAGE_KEY_MODE);
      localStorage.removeItem(STORAGE_KEY_ACCENT);
      localStorage.removeItem(STORAGE_KEY_FONT);
      localStorage.removeItem(STORAGE_KEY_FONT_SIZE);
    } catch {}
    notify();
  },

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useTheme(): [ThemeState, typeof themeStore] {
  const currentThemeState = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getState,
    themeStore.getState
  );

  return [currentThemeState, themeStore];
}
