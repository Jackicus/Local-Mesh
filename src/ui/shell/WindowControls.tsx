import React from 'react';
import { MinimizeIcon, MaximizeIcon, RestoreIcon, CloseIcon } from '../assets/icons';
import { useWindowControls } from '../hooks/useWindowControls';

export const WindowControls: React.FC = () => {
  const { isMaximized, minimize, maximize, close } = useWindowControls();

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control-btn"
        onClick={minimize}
        title="Minimize"
        aria-label="Minimize Window"
      >
        <MinimizeIcon size={14} />
      </button>
      <button
        type="button"
        className="window-control-btn"
        onClick={maximize}
        title={isMaximized ? 'Restore' : 'Maximize'}
        aria-label={isMaximized ? 'Restore Window' : 'Maximize Window'}
      >
        {isMaximized ? <RestoreIcon size={12} /> : <MaximizeIcon size={12} />}
      </button>
      <button
        type="button"
        className="window-control-btn close"
        onClick={close}
        title="Close"
        aria-label="Close Window"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
};
