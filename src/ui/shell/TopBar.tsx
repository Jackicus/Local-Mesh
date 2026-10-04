import React, { useEffect, useRef, useState } from 'react';
import { PanelLeftCloseIcon, PanelLeftIcon } from '../assets/icons';
import { useDockStore } from '../stores/dockStore';
import { getShortcutKeys } from '../hooks';
import { Tooltip } from '../components';
import { WindowControls } from './WindowControls';

interface TopBarProps {
  title?: string;
  /** Receive the view slots' elements; Shell hands them on through TopBarSlotContext. */
  startSlotRef?: (el: HTMLDivElement | null) => void;
  centerSlotRef?: (el: HTMLDivElement | null) => void;
}

/** Gap between the slot and whatever it starts after: the dock's edge or the title. */
const SLOT_GAP = 12;

export const TopBar: React.FC<TopBarProps> = ({ title = 'Local Mesh', startSlotRef, centerSlotRef }) => {
  const [dockState, store] = useDockStore();
  const toggleDockKey = getShortcutKeys('toggle-dock');
  const leftRef = useRef<HTMLDivElement>(null);
  const [slotLeft, setSlotLeft] = useState(0);

  // The view slot starts at the content's left edge, which is the dock's edge
  // while it is open; collapsed, the toggle and title sit over the content, so
  // it starts after them instead.
  useEffect(() => {
    const left = leftRef.current;
    if (!left) return;
    const place = () => {
      const after = dockState.isOpen ? dockState.width : left.getBoundingClientRect().right;
      setSlotLeft(Math.ceil(after) + SLOT_GAP);
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(left);
    return () => observer.disconnect();
  }, [dockState.isOpen, dockState.width]);

  return (
    <header className="top-bar">
      <div className="top-bar-left" ref={leftRef}>
        <Tooltip
          content={dockState.isOpen ? 'Collapse Left Dock' : 'Expand Left Dock'}
          shortcut={toggleDockKey}
          position="bottom"
          align="start"
        >
          <button
            type="button"
            className={`icon-btn ${dockState.isOpen ? 'active' : ''}`}
            onClick={() => store.toggle()}
            aria-label="Toggle Left Dock"
          >
            {dockState.isOpen ? <PanelLeftCloseIcon size={16} /> : <PanelLeftIcon size={16} />}
          </button>
        </Tooltip>

        <div className="app-title-group">
          <span className="app-title">{title}</span>
        </div>
      </div>

      <div className="top-bar-slot" ref={startSlotRef} style={{ left: slotLeft }} />
      <div className="top-bar-slot top-bar-slot-center" ref={centerSlotRef} />

      {/* Empty flexible region — doubles as the window drag area */}
      <div className="top-bar-center" />

      <div className="top-bar-right">
        <WindowControls />
      </div>
    </header>
  );
};
