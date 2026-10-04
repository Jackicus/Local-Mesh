import React from 'react';
import { Tooltip } from '../../components';
import { AutoRotateIcon, GridIcon, HomeIcon, WireframeIcon } from '../../assets/icons';
import { useViewerStore } from './viewerStore';

interface ToggleProps {
  label: string;
  icon: React.ReactNode;
  on: boolean;
  onChange: (on: boolean) => void;
}

const Toggle: React.FC<ToggleProps> = ({ label, icon, on, onChange }) => (
  <Tooltip content={label} position="bottom" align="end" delay={0}>
    <button
      type="button"
      className={`gen-viewtool ${on ? 'is-on' : ''}`}
      aria-label={label}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      {icon}
    </button>
  </Tooltip>
);

/**
 * Under the dial: the way home, then how the scene is drawn. Four separate
 * squares in a row rather than a menu — three switches behind an eye icon
 * hid the only thing they do, which is change what you are looking at, one
 * click away from seeing it change. Home leads because it is the one you
 * reach for when the others have left the model somewhere odd.
 */
export const ViewTools: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  return (
    <div className="gen-viewtools" role="toolbar" aria-label="View">
      <Tooltip content="Reset camera" position="bottom" align="end" delay={0}>
        <button type="button" className="gen-viewtool" aria-label="Reset camera" onClick={viewerActions.resetCamera}>
          <HomeIcon size={15} />
        </button>
      </Tooltip>
      <Toggle label="Grid" icon={<GridIcon size={15} />} on={viewer.showGrid} onChange={viewerActions.setGrid} />
      <Toggle
        label="Wireframe"
        icon={<WireframeIcon size={15} />}
        on={viewer.wireframe}
        onChange={viewerActions.setWireframe}
      />
      <Toggle
        label="Auto-rotate"
        icon={<AutoRotateIcon size={15} />}
        on={viewer.autoRotate}
        onChange={viewerActions.setAutoRotate}
      />
    </div>
  );
};
