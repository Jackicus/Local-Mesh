import { useSyncExternalStore } from 'react';

/**
 * The dockStore shape, generalised: plain module state, a listener set, and a
 * hook. Stores that talk to the main process add async actions on top and a
 * `bind()` that subscribes to push events once (called from App on mount).
 */
export interface Store<T> {
  getState: () => T;
  setState: (patch: Partial<T> | ((prev: T) => Partial<T>)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState: (patch) => {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** window.electronAPI, or undefined in a plain browser (stores must degrade). */
export const api = () => (typeof window !== 'undefined' ? window.electronAPI : undefined);
