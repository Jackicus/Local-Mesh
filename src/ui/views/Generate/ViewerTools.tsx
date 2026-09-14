import React from 'react';
import { Tooltip } from '../../components';
import { AutoRotateIcon, FocusIcon, FolderOpenIcon, GridIcon, WireframeIcon } from '../../assets/icons';
import { useEnvStore } from '../../stores/envStore';
import { api } from '../../stores/createStore';
import { useViewerStore } from './viewerStore';

interface ToolProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const Tool: React.FC<ToolProps> = ({ label, active = false, disabled = false, onClick, children }) => (
  <Tooltip content={label} position="top">
    <button
      type="button"
      className={`gen-tool ${active ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  </Tooltip>
);

/** Viewport controls, kept out of the dock so they stay with what they act on. */
export const ViewerTools: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  const [env] = useEnvStore();
  const outputs = env.paths?.outputs;

  return (
    <div className="gen-viewer-tools">
      <Tool label="Reset camera" onClick={viewerActions.resetCamera}>
        <FocusIcon size={16} />
      </Tool>
      <Tool label="Grid" active={viewer.showGrid} onClick={() => viewerActions.setGrid(!viewer.showGrid)}>
        <GridIcon size={16} />
      </Tool>
      <Tool
        label="Wireframe"
        active={viewer.wireframe}
        onClick={() => viewerActions.setWireframe(!viewer.wireframe)}
      >
        <WireframeIcon size={16} />
      </Tool>
      <Tool
        label="Auto-rotate"
        active={viewer.autoRotate}
        onClick={() => viewerActions.setAutoRotate(!viewer.autoRotate)}
      >
        <AutoRotateIcon size={16} />
      </Tool>
      <span className="gen-tool-divider" />
      <Tool label="Open outputs folder" disabled={!outputs} onClick={() => outputs && api()?.openPath(outputs)}>
        <FolderOpenIcon size={16} />
      </Tool>
    </div>
  );
};
