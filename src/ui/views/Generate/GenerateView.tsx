import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { HomeIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { CameraGizmo } from './CameraGizmo';
import { QueueStack } from './QueueStack';
import { Scene } from './Scene';
import { ToolPlates } from './ToolPlates';
import { imagePathsFromDrop } from './ImageDrop';
import { useViewerStore } from './viewerStore';

/**
 * Full-bleed: the viewport is the screen and everything else floats over it —
 * the navigator top right, the queue bottom left, the three tool plates bottom
 * right. The negative margins undo `.shell-content`'s padding so the canvas
 * reaches the window edges while the overlays stay clear of the titlebar.
 */
export const GenerateView: React.FC = () => {
  const [, viewerActions] = useViewerStore();
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
      className={`gen-view ${dragging ? 'is-dragging' : ''}`}
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

      {/* Where the camera is, and the way back. */}
      <div className="gen-navigator">
        <CameraGizmo />
        <Tooltip content="Reset camera" position="left">
          <button
            type="button"
            className="gen-tool gen-home"
            aria-label="Reset camera"
            onClick={viewerActions.resetCamera}
          >
            <HomeIcon size={16} />
          </button>
        </Tooltip>
      </div>

      {/* One band, so the queue and the tools can never overlap. */}
      <div className="gen-hud">
        <QueueStack />
        <ToolPlates />
      </div>

      {dragging && (
        <div className="gen-veil">
          <p>Drop to add images</p>
        </div>
      )}
    </div>
  );
};
