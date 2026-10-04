import { createContext, useContext } from 'react';

/**
 * Places in the top bar a view can portal its own controls into: `start`, just
 * right of the dock (or of the dock toggle and title, when the dock is
 * collapsed), and `center`, the middle of the bar, for a title.
 *
 * The bar is a window drag region and comes after the content in the DOM, so
 * a control merely positioned over it from inside a view loses its clicks to
 * the drag; one rendered inside the bar does not.
 */
export interface TopBarSlots {
  start: HTMLElement | null;
  center: HTMLElement | null;
}

export const TopBarSlotContext = createContext<TopBarSlots>({ start: null, center: null });

export const useTopBarSlot = (which: keyof TopBarSlots = 'start'): HTMLElement | null =>
  useContext(TopBarSlotContext)[which];
