import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'danger' | 'error';

export interface ToastItem {
  id: string;
  message: ReactNode;
  title?: string;
  type: 'info' | 'success' | 'warning' | 'danger';
  duration?: number; // ms, default 3500
  exiting?: boolean; // true while the exit animation plays, before removal
}

// Must match the toastSlideOut animation duration in overlays.css
const EXIT_ANIMATION_MS = 200;

export interface ToastOptions {
  title?: string;
  type?: ToastType;
  duration?: number;
}

class ToastStore {
  private toasts: ToastItem[] = [];
  private listeners: Set<() => void> = new Set();
  private nextId = 1;

  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = () => {
    return this.toasts;
  };

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public show(message: ReactNode, options: ToastOptions = {}) {
    const id = `toast-${this.nextId++}`;
    const duration = options.duration ?? 3500;
    const type: 'info' | 'success' | 'warning' | 'danger' =
      options.type === 'error' ? 'danger' : (options.type ?? 'info');

    const item: ToastItem = {
      id,
      message,
      title: options.title,
      type,
      duration,
    };

    this.toasts = [...this.toasts, item];
    this.notify();

    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }

    return id;
  }

  public success(message: ReactNode, options?: Omit<ToastOptions, 'type'>) {
    return this.show(message, { ...options, type: 'success' });
  }

  public error(message: ReactNode, options?: Omit<ToastOptions, 'type'>) {
    return this.show(message, { ...options, type: 'danger' });
  }

  public warning(message: ReactNode, options?: Omit<ToastOptions, 'type'>) {
    return this.show(message, { ...options, type: 'warning' });
  }

  public info(message: ReactNode, options?: Omit<ToastOptions, 'type'>) {
    return this.show(message, { ...options, type: 'info' });
  }

  public dismiss(id: string) {
    const item = this.toasts.find((t) => t.id === id);
    if (!item || item.exiting) return;
    this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, exiting: true } : t));
    this.notify();

    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.notify();
    }, EXIT_ANIMATION_MS);
  }

  public clearAll() {
    if (this.toasts.length === 0) return;
    this.toasts.forEach((t) => this.dismiss(t.id));
  }
}

export const toastStore = new ToastStore();

/**
 * Hook to read active toasts for the container
 */
export function useToastStore(): [ToastItem[], ToastStore] {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot);
  return [toasts, toastStore];
}

/**
 * Imperative global toast API
 */
export const toast = {
  show: (message: ReactNode, options?: ToastOptions) => toastStore.show(message, options),
  success: (message: ReactNode, options?: Omit<ToastOptions, 'type'>) =>
    toastStore.success(message, options),
  error: (message: ReactNode, options?: Omit<ToastOptions, 'type'>) =>
    toastStore.error(message, options),
  warning: (message: ReactNode, options?: Omit<ToastOptions, 'type'>) =>
    toastStore.warning(message, options),
  info: (message: ReactNode, options?: Omit<ToastOptions, 'type'>) =>
    toastStore.info(message, options),
  dismiss: (id: string) => toastStore.dismiss(id),
  clearAll: () => toastStore.clearAll(),
};
