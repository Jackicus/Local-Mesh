import React, { useState, useEffect } from 'react';
import {
  HomeIcon,
  FileTextIcon,
  CodeIcon,
  SettingsIcon,
  HelpIcon,
  IconComponent,
} from '../assets/icons';
import { useDockStore, DOCK_MIN_WIDTH, DOCK_MAX_WIDTH } from '../stores/dockStore';

interface NavItem {
  id: string;
  label: string;
  icon: IconComponent;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'notes', label: 'Notes', icon: FileTextIcon },
];

const FOOTER_NAV_ITEMS: NavItem[] = [
  { id: 'developer', label: 'Developer', icon: CodeIcon },
  { id: 'help', label: 'Help & Support', icon: HelpIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export const LeftDock: React.FC = () => {
  const [dockState, store] = useDockStore();
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
    const isActive = dockState.activeItem === item.id;

    return (
      <button
        key={item.id}
        type="button"
        className={`dock-item ${isActive ? 'active' : ''}`}
        onClick={() => store.setActiveItem(item.id)}
      >
        <span className="dock-item-icon">
          <Icon size={20} />
        </span>
        <span className="dock-item-label">{item.label}</span>
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
