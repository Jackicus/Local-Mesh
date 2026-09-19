import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { EyeIcon } from '../../assets/icons';
import { CameraPanel } from './CameraPanel';

/**
 * Grid, wireframe and auto-rotate, docked with the orientation dial.
 *
 * These were a third plate in the bottom-right labelled "Camera", which was
 * both wrong — the camera is the gizmo's business, these draw the scene — and
 * a duplicate signpost pointing at the same idea from two corners of the
 * screen. They belong next to the dial, which leaves the bottom-right to the
 * two plates that are about the mesh itself.
 */
export const ViewOptions: React.FC = () => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="gen-viewopts" ref={rootRef}>
      {open && (
        <div className="gen-viewopts-panel" role="dialog" aria-label="View">
          <CameraPanel />
        </div>
      )}
      <Tooltip content="How the scene is drawn" position="left" disabled={open}>
        <button
          type="button"
          className={`gen-tool gen-viewopts-btn ${open ? 'is-active' : ''}`}
          aria-label="View options"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          <EyeIcon size={16} />
        </button>
      </Tooltip>
    </div>
  );
};
