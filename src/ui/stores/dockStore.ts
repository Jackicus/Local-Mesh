import { useSyncExternalStore } from 'react';

/**
 * Interface representing the state of the left dock, width, and active navigation.
 */
export interface DockState {
  isOpen: boolean;
  width: number;
  activeItem: string;
}

export const DOCK_MIN_WIDTH = 180;
export const DOCK_MAX_WIDTH = 360;
export const DOCK_DEFAULT_WIDTH = 240;

// Initial state on app start: always 240px expanded
let state: DockState = {
  isOpen: true,
  width: DOCK_DEFAULT_WIDTH,
  activeItem: 'home',
};

// Set of component listeners
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

/**
 * Simple global store for dock navigation and resizing.
 * Always initializes to 240px expanded on startup.
 */
export const dockStore = {
  getState: (): DockState => state,

  setIsOpen: (isOpen: boolean) => {
    state = { ...state, isOpen };
    notify();
  },

  setWidth: (width: number) => {
    const clamped = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, Math.round(width)));
    state = { ...state, width: clamped };
    notify();
  },

  toggle: () => {
    dockStore.setIsOpen(!state.isOpen);
  },

  setActiveItem: (activeItem: string) => {
    state = { ...state, activeItem };
    notify();
  },

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useDockStore(): [DockState, typeof dockStore] {
  const currentDockState = useSyncExternalStore(
    dockStore.subscribe,
    dockStore.getState,
    dockStore.getState
  );

  return [currentDockState, dockStore];
}
