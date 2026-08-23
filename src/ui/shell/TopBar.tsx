import React from 'react';
import { PanelLeftCloseIcon, PanelLeftIcon } from '../assets/icons';
import { useDockStore } from '../stores/dockStore';
import { getShortcutKeys } from '../hooks';
import { Tooltip } from '../components';
import { WindowControls } from './WindowControls';

interface TopBarProps {
  title?: string;
}

export const TopBar: React.FC<TopBarProps> = ({ title = 'Desktop Application' }) => {
  const [dockState, store] = useDockStore();
  const toggleDockKey = getShortcutKeys('toggle-dock');

  return (
    <header className="top-bar">
      <div className="top-bar-left">
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

      {/* Empty flexible region — doubles as the window drag area */}
      <div className="top-bar-center" />

      <div className="top-bar-right">
        <WindowControls />
      </div>
    </header>
  );
};
