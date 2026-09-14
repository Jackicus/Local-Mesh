import React from 'react';
import { Tooltip } from '../../components';
import { PanelRightCloseIcon } from '../../assets/icons';
import { useViewerStore } from './viewerStore';
import { PipelinePicker } from './PipelinePicker';
import { ImageDrop } from './ImageDrop';
import { GenerateButton } from './GenerateButton';
import { QueueList } from './QueueList';
import { EnginePanel } from './EnginePanel';
import { OutputList } from './OutputList';

/** The control surface: everything that isn't the model itself. */
export const DockPanel: React.FC = () => {
  const [, viewerActions] = useViewerStore();

  return (
    <aside className="gen-dock" aria-label="Generation controls">
      <header className="gen-dock-head">
        <span className="gen-dock-title">Generate</span>
        <Tooltip content="Hide panel" position="left">
          <button
            type="button"
            className="gen-tool"
            aria-label="Hide panel"
            onClick={() => viewerActions.setDockOpen(false)}
          >
            <PanelRightCloseIcon size={16} />
          </button>
        </Tooltip>
      </header>

      <div className="gen-dock-body">
        <PipelinePicker />
        <ImageDrop />
        <GenerateButton />
        <QueueList />
        <EnginePanel />
        <OutputList />
      </div>
    </aside>
  );
};
