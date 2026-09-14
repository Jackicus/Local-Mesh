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

interface NavItem {
  id: string;
  label: string;
  icon: IconComponent;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { id: 'generate', label: 'Generate', icon: BoxIcon },
  { id: 'pipelines', label: 'Pipelines', icon: WorkflowIcon },
  { id: 'models', label: 'Models', icon: PackageIcon },
];

const FOOTER_NAV_ITEMS: NavItem[] = [
  // Not a view: toggles the bottom dock.
  { id: 'logs', label: 'Logs', icon: ScrollTextIcon },
  { id: 'developer', label: 'Developer', icon: CodeIcon },
  { id: 'help', label: 'Help & Support', icon: HelpIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

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

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, store]);

  const handleResizerMouseDown = (e: React.MouseEvent) => {
    if (!dockState.isOpen) return;
    e.preventDefault();
    setIsResizing(true);
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
        onClick={() => (isLogs ? store.toggleBottom() : store.setActiveItem(item.id))}
      >
        <span className="dock-item-icon">
          <Icon size={20} />
        </span>
        <span className="dock-item-label">{item.label}</span>
        {isLogs && logs.unseenErrors > 0 && (
          <span className="dock-item-badge" title={`${logs.unseenErrors} unseen errors`}>
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
          {MAIN_NAV_ITEMS.map(renderNavItem)}
        </nav>

        <div className="left-dock-footer">
          {FOOTER_NAV_ITEMS.map(renderNavItem)}
        </div>
      </div>

      {/* Resize Handle */}
      {dockState.isOpen && (
        <div
          className={`dock-resizer ${isResizing ? 'resizing' : ''}`}
          onMouseDown={handleResizerMouseDown}
          title="Drag to resize dock"
        />
      )}
    </aside>
  );
};
