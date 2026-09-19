import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { CameraIcon, EditIcon, FolderIcon, LoaderIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { CameraPanel } from './CameraPanel';
import { MeshTools } from './MeshTools';
import { OutputsPanel } from './OutputsPanel';
import { useViewerStore } from './viewerStore';

type PlateId = 'camera' | 'edit' | 'outputs';

const HINTS: Record<PlateId, string> = {
  camera: 'Scene and camera',
  edit: 'Edit the mesh in view',
  outputs: 'Meshes on disk',
};

/**
 * Three plates, bottom right, each a single button that opens one panel.
 * Only one is ever open: they act on the same viewport and would otherwise
 * cover each other as well as the model.
 */
export const ToolPlates: React.FC = () => {
  const [viewer] = useViewerStore();
  const [gen] = useGenerationStore();
  const [open, setOpen] = useState<PlateId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const editing = viewer.toolBusy !== null || gen.processing != null;

  // Dismiss on anything that reads as "elsewhere": a click outside, or Escape.
  // A modal raised from inside a panel (deleting an output) portals to the
  // body, so while one is up the panel behind it stays put and Escape is the
  // modal's to answer.
  useEffect(() => {
    if (open === null) return;
    const modalUp = () => document.querySelector('.ui-modal-backdrop') !== null;
    const onPointerDown = (event: MouseEvent) => {
      if (modalUp()) return;
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !modalUp()) setOpen(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const plate = (id: PlateId, label: string, icon: React.ReactNode, panel: React.ReactNode) => {
    const isOpen = open === id;
    return (
      <div className="gen-toolplate">
        {isOpen && (
          <div className="gen-panel" role="dialog" aria-label={label}>
            {panel}
          </div>
        )}
        <Tooltip content={HINTS[id]} position="top" align="end" disabled={isOpen}>
          <button
            type="button"
            className={`gen-tool-btn ${isOpen ? 'is-active' : ''}`}
            aria-expanded={isOpen}
            aria-haspopup="dialog"
            onClick={() => setOpen((prev) => (prev === id ? null : id))}
          >
            {icon}
            <span>{label}</span>
          </button>
        </Tooltip>
      </div>
    );
  };

  return (
    <div className="gen-plates" ref={rootRef}>
      {plate('camera', 'Camera', <CameraIcon size={14} />, <CameraPanel />)}
      {plate(
        'edit',
        'Edit',
        editing ? <LoaderIcon size={14} className="gen-spin" /> : <EditIcon size={14} />,
        <MeshTools />
      )}
      {plate('outputs', 'Outputs', <FolderIcon size={14} />, <OutputsPanel />)}
    </div>
  );
};
