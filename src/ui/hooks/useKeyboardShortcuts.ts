import { useEffect } from 'react';
import { dockStore } from '../stores/dockStore';

export interface ShortcutDefinition {
  id: string;
  description: string;
  keys: string;
  type: 'registered' | 'default'; // 'registered' = custom app actions, 'default' = system/window defaults
  category?: 'Navigation' | 'Window' | 'Theme' | 'General';
  key?: string;
  ctrlOrMeta?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  handler?: () => void;
}

export const isMacOS = (): boolean => {
  if (typeof navigator !== 'undefined') {
    return /Mac|iPod|iPhone|iPad/.test(navigator.userAgent || navigator.platform);
  }
  return false;
};

export const formatShortcutKeys = (config: {
  key?: string;
  ctrlOrMeta?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  customLabel?: string;
}): string => {
  if (config.customLabel) return config.customLabel;
  const isMac = isMacOS();
  const parts: string[] = [];

  if (config.ctrlOrMeta) {
    parts.push(isMac ? 'Cmd' : 'Ctrl');
  }
  if (config.altKey) {
    parts.push(isMac ? 'Option' : 'Alt');
  }
  if (config.shiftKey) {
    parts.push('Shift');
  }
  if (config.key) {
    parts.push(config.key.toUpperCase());
  }

  return parts.join(' + ');
};

/**
 * Centralized registry of application keyboard shortcuts.
 * All global shortcuts, OS-detected key labels, and event bindings are managed here.
 */
export const APP_SHORTCUTS: ShortcutDefinition[] = [
  // 1. Registered Custom Actions (Bound via application handlers)
  {
    id: 'toggle-dock',
    description: 'Toggle Left Navigation Dock',
    key: 'b',
    ctrlOrMeta: true,
    keys: formatShortcutKeys({ key: 'b', ctrlOrMeta: true }),
    type: 'registered',
    category: 'Navigation',
    handler: () => dockStore.toggle(),
  },
  {
    id: 'toggle-logs',
    description: 'Toggle Log Dock',
    key: 'j',
    ctrlOrMeta: true,
    keys: formatShortcutKeys({ key: 'j', ctrlOrMeta: true }),
    type: 'registered',
    category: 'Navigation',
    handler: () => dockStore.toggleBottom(),
  },

  // 2. System & Window Defaults (Runtime & desktop chrome defaults)
  {
    id: 'reload-window',
    description: 'Reload Application Window',
    key: 'r',
    ctrlOrMeta: true,
    keys: formatShortcutKeys({ key: 'r', ctrlOrMeta: true }),
    type: 'default',
    category: 'Window',
  },
  {
    id: 'toggle-fullscreen',
    description: 'Toggle Fullscreen Mode',
    key: 'f11',
    keys: 'F11',
    type: 'default',
    category: 'Window',
  },
];

/**
 * Helper to retrieve a shortcut definition by ID from the central index.
 */
export const getShortcut = (id: string): ShortcutDefinition | undefined =>
  APP_SHORTCUTS.find((s) => s.id === id);

/**
 * Helper to retrieve OS-formatted shortcut keys by ID.
 */
export const getShortcutKeys = (id: string): string =>
  getShortcut(id)?.keys ?? '';

/**
 * Global keyboard shortcuts hook.
 * Automatically executes handlers defined in APP_SHORTCUTS.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const hasModifier = event.ctrlKey || event.metaKey;
      const keyLower = event.key.toLowerCase();

      // Don't intercept typing in inputs/textareas for unmodified keys
      const target = event.target as HTMLElement | null;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isInput && !hasModifier) return;

      for (const shortcut of APP_SHORTCUTS) {
        if (!shortcut.handler || !shortcut.key) continue;

        const modifierMatch = Boolean(shortcut.ctrlOrMeta) === hasModifier;
        const shiftMatch = Boolean(shortcut.shiftKey) === event.shiftKey;
        const altMatch = Boolean(shortcut.altKey) === event.altKey;

        if (modifierMatch && shiftMatch && altMatch && keyLower === shortcut.key.toLowerCase()) {
          event.preventDefault();
          shortcut.handler();
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
