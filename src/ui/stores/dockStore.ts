import { useSyncExternalStore } from 'react';

/** The log dock pinned to the bottom of the content area; closed it renders nothing. */
export interface BottomDockState {
  isOpen: boolean;
  height: number;
}

/**
 * Interface representing the state of the left dock, width, and active navigation.
 */
export interface DockState {
  isOpen: boolean;
  width: number;
  activeItem: string;
  bottom: BottomDockState;
  /**
   * Show the advanced tools — today, the Pipelines node editor. Off for a new
   * install: a beginner clicking the second item in the nav should not land on
   * a graph of wires, octree resolutions and guidance scales. It turns itself
   * on the first time a mesh finishes, so the editor appears once the app has
   * actually worked, and Settings has a switch for it either way.
   */
  advanced: boolean;
}

export const DOCK_MIN_WIDTH = 180;
export const DOCK_MAX_WIDTH = 360;
export const DOCK_DEFAULT_WIDTH = 240;

export const BOTTOM_DOCK_MIN_HEIGHT = 200;
export const BOTTOM_DOCK_MAX_HEIGHT = 600;
export const BOTTOM_DOCK_DEFAULT_HEIGHT = 300;

const BOTTOM_STORAGE_KEY = 'local-mesh.bottom-dock';
const ADVANCED_KEY = 'local-mesh.advanced';

const clampBottomHeight = (height: number): number =>
  Math.max(BOTTOM_DOCK_MIN_HEIGHT, Math.min(BOTTOM_DOCK_MAX_HEIGHT, Math.round(height)));

function readBottom(): BottomDockState {
  const fallback: BottomDockState = { isOpen: false, height: BOTTOM_DOCK_DEFAULT_HEIGHT };
  try {
    const raw = localStorage.getItem(BOTTOM_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<BottomDockState>;
    return {
      isOpen: parsed.isOpen === true,
      height: typeof parsed.height === 'number' ? clampBottomHeight(parsed.height) : fallback.height,
    };
  } catch {
    return fallback;
  }
}

function readAdvanced(): boolean {
  try {
    return localStorage.getItem(ADVANCED_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistBottom(bottom: BottomDockState) {
  try {
    localStorage.setItem(BOTTOM_STORAGE_KEY, JSON.stringify(bottom));
  } catch {
    /* private mode / no storage — the dock just forgets between runs */
  }
}

// Initial state on app start: always 240px expanded
let state: DockState = {
  isOpen: true,
  width: DOCK_DEFAULT_WIDTH,
  activeItem: 'generate',
  bottom: readBottom(),
  advanced: readAdvanced(),
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

  setBottomOpen: (isOpen: boolean) => {
    if (state.bottom.isOpen === isOpen) return;
    const bottom = { ...state.bottom, isOpen };
    state = { ...state, bottom };
    persistBottom(bottom);
    notify();
  },

  setBottomHeight: (height: number) => {
    const bottom = { ...state.bottom, height: clampBottomHeight(height) };
    state = { ...state, bottom };
    persistBottom(bottom);
    notify();
  },

  toggleBottom: () => {
    dockStore.setBottomOpen(!state.bottom.isOpen);
  },

  setAdvanced: (advanced: boolean) => {
    if (state.advanced === advanced) return;
    state = { ...state, advanced };
    try {
      localStorage.setItem(ADVANCED_KEY, String(advanced));
    } catch {
      /* private mode — the switch just forgets between runs */
    }
    // Leaving the user on a view that is about to vanish strands them.
    if (!advanced && state.activeItem === 'pipelines') state = { ...state, activeItem: 'generate' };
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
