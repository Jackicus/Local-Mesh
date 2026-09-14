import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { PanelRightIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { Scene } from './Scene';
import { DockPanel } from './DockPanel';
import { StatusStrip } from './StatusStrip';
import { ViewerTools } from './ViewerTools';
import { MeshTools } from './MeshTools';
import { imagePathsFromDrop } from './ImageDrop';
import { useViewerStore } from './viewerStore';

/**
 * Full-bleed: the viewport is the screen and everything else floats over it.
 * The negative margins undo `.shell-content`'s padding so the canvas reaches
 * the window edges while the overlays stay clear of the titlebar.
 */
export const GenerateView: React.FC = () => {
  const [viewer, viewerActions] = useViewerStore();
  const [gen] = useGenerationStore();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child; count them so crossing an
  // inner element doesn't flicker the veil off.
  const dragDepth = useRef(0);

  useEffect(() => {
    if (gen.hydrated) viewerActions.autoLoadFrom(gen.jobs);
  }, [gen.hydrated, gen.jobs, viewerActions]);

  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files');

  return (
    <div
      className={`gen-view ${viewer.dockOpen ? 'is-docked' : ''} ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        viewerActions.addImages(imagePathsFromDrop(event));
      }}
    >
      <Scene />

      {/* One band, so the readout and the tools can never overlap — nor the
          dock, which the band makes room for when it is open. */}
      <div className="gen-hud">
        <StatusStrip />
        <div className="gen-hud-tools">
          <MeshTools />
          <ViewerTools />
        </div>
      </div>

      {viewer.dockOpen ? (
        <DockPanel />
      ) : (
        <div className="gen-dock-open-wrap">
          <Tooltip content="Show panel" position="left">
            <button
              type="button"
              className="gen-tool gen-dock-open"
              aria-label="Show panel"
              onClick={() => viewerActions.setDockOpen(true)}
            >
              <PanelRightIcon size={16} />
            </button>
          </Tooltip>
        </div>
      )}

      {dragging && (
        <div className="gen-veil">
          <p>Drop to add images</p>
        </div>
      )}
    </div>
  );
};
