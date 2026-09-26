import React, { useState, useEffect } from 'react';
import {
  BoxIcon,
  WorkflowIcon,
  PackageIcon,
  ScrollTextIcon,
  CodeIcon,
  SettingsIcon,
  HelpIcon,
  IconComponent,
} from '../assets/icons';
import { useDockStore, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH } from '../stores/dockStore';
import { useLogStore } from '../stores/logStore';
import { EngineItem } from './EngineItem';

interface NavItem {
  id: string;
  label: string;
  icon: IconComponent;
  /** Hidden until the user has made a mesh, or turned advanced tools on. */
  advanced?: boolean;
  /** Only in `npm run dev`: the view edits source files that a built app does not ship. */
  devOnly?: boolean;
}

// Models before Pipelines: installing one is the thing a new user has to do
// first, and the node editor is the most advanced screen in the app.
const MAIN_NAV_ITEMS: NavItem[] = [
  { id: 'generate', label: 'Generate', icon: BoxIcon },
  { id: 'models', label: 'Models', icon: PackageIcon },
  { id: 'pipelines', label: 'Pipelines', icon: WorkflowIcon, advanced: true },
];

const FOOTER_NAV_ITEMS: NavItem[] = [
  // Not a view: toggles the bottom dock.
  { id: 'logs', label: 'Logs', icon: ScrollTextIcon },
  { id: 'developer', label: 'Developer', icon: CodeIcon, devOnly: true },
  { id: 'help', label: 'Help', icon: HelpIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

const showItem = (item: NavItem, advanced: boolean): boolean =>
  (!item.advanced || advanced) && (!item.devOnly || import.meta.env.DEV);

export const LeftDock: React.FC = () => {
  const [dockState, store] = useDockStore();
  const [logs] = useLogStore();
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, e.clientX));
      store.setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    // Releasing the button outside the window never delivers mouseup, which
    // would otherwise leave the dock stuck in a drag it can't get out of
    window.addEventListener('blur', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, store]);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    if (!dockState.isOpen || e.button !== 0) return;
    e.preventDefault();
    setIsResizing(true);
  };

  // The handle is a real separator widget: arrows nudge, Home/End jump to the
  // bounds, so the dock width isn't a mouse-only setting
  const handleResizerKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 32 : 8;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = dockState.width - step;
    else if (e.key === 'ArrowRight') next = dockState.width + step;
    else if (e.key === 'Home') next = DOCK_MIN_WIDTH;
    else if (e.key === 'End') next = DOCK_MAX_WIDTH;
    if (next === null) return;
    e.preventDefault();
    store.setWidth(Math.max(DOCK_MIN_WIDTH, Math.min(DOCK_MAX_WIDTH, next)));
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isLogs = item.id === 'logs';
    const isActive = isLogs ? dockState.bottom.isOpen : dockState.activeItem === item.id;

    return (
      <button
        key={item.id}
        type="button"
        className={`dock-item ${isActive ? 'active' : ''}`}
        aria-expanded={isLogs ? dockState.bottom.isOpen : undefined}
        aria-current={!isLogs && isActive ? 'page' : undefined}
        onClick={() => (isLogs ? store.toggleBottom() : store.setActiveItem(item.id))}
      >
        <span className="dock-item-icon">
          <Icon size={20} />
        </span>
        <span className="dock-item-label">{item.label}</span>
        {isLogs && logs.unseenErrors > 0 && (
          <span
            className="dock-item-badge"
            title={`${logs.unseenErrors} unseen errors`}
            aria-label={`${logs.unseenErrors} unseen errors`}
          >
            {logs.unseenErrors > 99 ? '99+' : logs.unseenErrors}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside
      className={`left-dock ${dockState.isOpen ? 'expanded' : 'collapsed'} ${
        isResizing ? 'is-resizing' : ''
      }`}
      style={dockState.isOpen ? { width: `${dockState.width}px` } : undefined}
      aria-label="Navigation Dock"
      aria-hidden={!dockState.isOpen}
    >
      {/* Fixed width so the content doesn't reflow while the dock animates closed */}
      <div className="left-dock-inner" style={{ width: `${dockState.width}px` }}>
        <nav className="left-dock-nav">
          {MAIN_NAV_ITEMS.filter((item) => showItem(item, dockState.advanced)).map(renderNavItem)}
        </nav>

        <div className="left-dock-footer">
          <EngineItem />
          {FOOTER_NAV_ITEMS.filter((item) => showItem(item, dockState.advanced)).map(renderNavItem)}
        </div>
      </div>

      {/* Resize Handle */}
      {dockState.isOpen && (
        <div
          className={`dock-resizer ${isResizing ? 'resizing' : ''}`}
          onMouseDown={handleResizerMouseDown}
          onKeyDown={handleResizerKeyDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize navigation dock"
          aria-valuenow={dockState.width}
          aria-valuemin={DOCK_MIN_WIDTH}
          aria-valuemax={DOCK_MAX_WIDTH}
          tabIndex={0}
          title="Drag to resize dock"
        />
      )}
    </aside>
  );
};
