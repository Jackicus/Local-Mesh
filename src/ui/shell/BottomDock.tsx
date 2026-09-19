import React, { useEffect, useState } from 'react';
import { useDockStore, BOTTOM_DOCK_MIN_HEIGHT, BOTTOM_DOCK_MAX_HEIGHT } from '../stores/dockStore';
import { LogsPanel } from '../views/Logs';

/**
 * Logs as an overlay pinned to the bottom of the content area rather than a
 * view: it floats over whatever is on screen so full-bleed views (Generate,
 * Pipelines) keep their height when it opens.
 *
 * Closed, it renders nothing — no strip, no reserved height. The ways in are
 * the Logs item in the left dock and `Ctrl/Cmd + J`.
 */
export const BottomDock: React.FC = () => {
  const [dockState, store] = useDockStore();
  const [isResizing, setIsResizing] = useState(false);
  const { isOpen, height } = dockState.bottom;

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const next = window.innerHeight - e.clientY;
      store.setBottomHeight(Math.max(BOTTOM_DOCK_MIN_HEIGHT, Math.min(BOTTOM_DOCK_MAX_HEIGHT, next)));
    };
    const handleMouseUp = () => setIsResizing(false);

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    // A button released outside the window delivers no mouseup, which would
    // otherwise leave the dock stuck mid-drag
    window.addEventListener('blur', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, store]);

  // Dropping the resize drag when the dock closes mid-drag
  useEffect(() => {
    if (!isOpen) setIsResizing(false);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <aside
      className={`bottom-dock ${isResizing ? 'is-resizing' : ''}`}
      style={{ left: dockState.isOpen ? `${dockState.width}px` : 0, height: `${height}px` }}
      aria-label="Logs"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          store.setBottomOpen(false);
        }
      }}
    >
      <div
        className={`bottom-dock-resizer ${isResizing ? 'resizing' : ''}`}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          setIsResizing(true);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 48 : 16;
          let next: number | null = null;
          if (e.key === 'ArrowUp') next = height + step;
          else if (e.key === 'ArrowDown') next = height - step;
          else if (e.key === 'Home') next = BOTTOM_DOCK_MIN_HEIGHT;
          else if (e.key === 'End') next = BOTTOM_DOCK_MAX_HEIGHT;
          if (next === null) return;
          e.preventDefault();
          store.setBottomHeight(
            Math.max(BOTTOM_DOCK_MIN_HEIGHT, Math.min(BOTTOM_DOCK_MAX_HEIGHT, next))
          );
        }}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize log dock"
        aria-valuenow={height}
        aria-valuemin={BOTTOM_DOCK_MIN_HEIGHT}
        aria-valuemax={BOTTOM_DOCK_MAX_HEIGHT}
        tabIndex={0}
        title="Drag to resize the log dock"
      />
      <LogsPanel onCollapse={() => store.setBottomOpen(false)} />
    </aside>
  );
};
