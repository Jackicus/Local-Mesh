import React, { useEffect, useState } from 'react';
import { ChevronUpIcon, ScrollTextIcon } from '../assets/icons';
import { getShortcutKeys } from '../hooks';
import { Tooltip } from '../components';
import {
  useDockStore,
  BOTTOM_DOCK_MIN_HEIGHT,
  BOTTOM_DOCK_MAX_HEIGHT,
  BOTTOM_DOCK_BAR_HEIGHT,
} from '../stores/dockStore';
import { useLogStore } from '../stores/logStore';
import { LogsPanel } from '../views/Logs';

const CHANNELS = [
  { id: 'general', label: 'general' },
  { id: 'errors', label: 'errors' },
  { id: 'generation', label: 'generation' },
] as const;

/**
 * Logs as an overlay pinned to the bottom of the content area rather than a
 * view: it floats over whatever is on screen so full-bleed views (Generate,
 * Pipelines) keep their height when it opens.
 */
export const BottomDock: React.FC = () => {
  const [dockState, store] = useDockStore();
  const [logs] = useLogStore();
  const [isResizing, setIsResizing] = useState(false);
  const { isOpen, height } = dockState.bottom;
  const toggleKey = getShortcutKeys('toggle-logs');

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

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, store]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      store.setBottomOpen(false);
    }
  };

  return (
    <aside
      className={`bottom-dock ${isOpen ? 'expanded' : 'collapsed'} ${isResizing ? 'is-resizing' : ''}`}
      style={{
        left: dockState.isOpen ? `${dockState.width}px` : 0,
        height: isOpen ? `${height}px` : `${BOTTOM_DOCK_BAR_HEIGHT}px`,
      }}
      aria-label="Logs Dock"
      onKeyDown={handleKeyDown}
    >
      {isOpen ? (
        <>
          <div
            className={`bottom-dock-resizer ${isResizing ? 'resizing' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizing(true);
            }}
            title="Drag to resize the log dock"
          />
          <LogsPanel onCollapse={() => store.setBottomOpen(false)} />
        </>
      ) : (
        <Tooltip content="Show logs" shortcut={toggleKey} position="top" align="start">
          <button
            type="button"
            className="bottom-dock-bar"
            onClick={() => store.setBottomOpen(true)}
            aria-expanded={false}
          >
            <span className="bottom-dock-brand">
              <ScrollTextIcon size={13} />
              Logs
            </span>
            {CHANNELS.map((c) => (
              <span key={c.id} className="bottom-dock-stat">
                {c.label}
                <b>{logs.entries[c.id].length}</b>
              </span>
            ))}
            {logs.unseenErrors > 0 && (
              <span className="bottom-dock-stat is-danger">
                unseen
                <b>{logs.unseenErrors}</b>
              </span>
            )}
            <span className="bottom-dock-chevron">
              <ChevronUpIcon size={14} />
            </span>
          </button>
        </Tooltip>
      )}
    </aside>
  );
};
