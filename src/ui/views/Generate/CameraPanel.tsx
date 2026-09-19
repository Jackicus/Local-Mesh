import React from 'react';
import { Form } from '../../components';
import { AutoRotateIcon, GridIcon, WireframeIcon } from '../../assets/icons';
import { useViewerStore } from './viewerStore';

interface SwitchProps {
  label: string;
  hint: string;
  icon: React.ReactNode;
  checked: boolean;
  onChange: (on: boolean) => void;
}

const Switch: React.FC<SwitchProps> = ({ label, hint, icon, checked, onChange }) => (
  <div className="gen-switch">
    <span className="gen-switch-icon" aria-hidden="true">
      {icon}
    </span>
    <span className="gen-switch-text">
      <span className="gen-switch-label">{label}</span>
      <span className="gen-switch-hint">{hint}</span>
    </span>
    <Form.Toggle size="sm" checked={checked} onChange={onChange} aria-label={label} />
  </div>
);

/** How the scene is drawn, as opposed to where the camera is — that is the gizmo's job. */
export const CameraPanel: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();

  return (
    <div className="gen-switches">
      <Switch
        label="Grid"
        hint="Floor and axes"
        icon={<GridIcon size={14} />}
        checked={viewer.showGrid}
        onChange={viewerActions.setGrid}
      />
      <Switch
        label="Wireframe"
        hint="Edges only"
        icon={<WireframeIcon size={14} />}
        checked={viewer.wireframe}
        onChange={viewerActions.setWireframe}
      />
      <Switch
        label="Auto-rotate"
        hint="Turn the model slowly"
        icon={<AutoRotateIcon size={14} />}
        checked={viewer.autoRotate}
        onChange={viewerActions.setAutoRotate}
      />
    </div>
  );
};
