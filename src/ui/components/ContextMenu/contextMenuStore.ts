import { useSyncExternalStore } from 'react';

export interface ContextMenuItem {
  id?: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const initialState: ContextMenuState = {
  isOpen: false,
  x: 0,
  y: 0,
  items: [],
};

class ContextMenuStore {
  private state: ContextMenuState = initialState;
  private listeners: Set<() => void> = new Set();

  public subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = () => {
    return this.state;
  };

  private notify() {
    this.listeners.forEach((l) => l());
  }

  public open(
    event: React.MouseEvent | MouseEvent,
    items: ContextMenuItem[]
  ) {
    event.preventDefault();
    event.stopPropagation();

    // Clamp coordinates so menu doesn't spawn outside viewport
    const menuWidth = 200;
    const menuHeight = items.length * 36 + 16;
    const padding = 12;

    const x = Math.min(event.clientX, window.innerWidth - menuWidth - padding);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - padding);

    this.state = {
      isOpen: true,
      x: Math.max(padding, x),
      y: Math.max(padding, y),
      items,
    };
    this.notify();
  }

  public close() {
    if (!this.state.isOpen) return;
    this.state = initialState;
    this.notify();
  }
}

export const contextMenuStore = new ContextMenuStore();

export function useContextMenuStore(): [ContextMenuState, ContextMenuStore] {
  const state = useSyncExternalStore(
    contextMenuStore.subscribe,
    contextMenuStore.getSnapshot
  );
  return [state, contextMenuStore];
}

export const contextMenu = {
  open: (event: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) =>
    contextMenuStore.open(event, items),
  close: () => contextMenuStore.close(),
};
