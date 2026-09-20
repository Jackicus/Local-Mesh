import React, { useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { HomeIcon } from '../../assets/icons';
import { useGenerationStore } from '../../stores/generationStore';
import { CameraGizmo } from './CameraGizmo';
import { QueueStack } from './QueueStack';
import { Scene } from './Scene';
import { ToolPlates } from './ToolPlates';
import { ViewOptions } from './ViewOptions';
import { dragHasFiles, imagePathsFromDrop } from './imageInput';
import { useViewerStore } from './viewerStore';

/**
 * Full-bleed: the viewport is the screen and everything else floats over it —
 * the navigator top right, the queue bottom left, the Start control and the
 * tool plates bottom right. The negative margins undo `.shell-content`'s
 * padding so the canvas reaches the window edges while the overlays stay clear
 * of the titlebar.
 *
 * Nothing here asks the user to set anything up. A model that is not installed
 * is a problem with one job, and the job says so on its own row; the middle of
 * the screen is the model's, even when there is not one yet.
 */
export const GenerateView: React.FC = () => {
  const [, viewerActions] = useViewerStore();
  const [gen, generation] = useGenerationStore();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire for every child; count them so crossing an
  // inner element doesn't flicker the veil off.
  const dragDepth = useRef(0);

  // One place decides what the viewport shows: the selection, reconciled
  // against every queue push, so a finished job, a stepped revision and a
  // deleted job all land in the viewport without anyone asking.
  useEffect(() => {
    if (gen.hydrated) viewerActions.syncFromJobs(gen.jobs);
  }, [gen.hydrated, gen.jobs, viewerActions]);

  return (
    <div
      className={`gen-view ${dragging ? 'is-dragging' : ''}`}
      onDragEnter={(event) => {
        if (!dragHasFiles(event)) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (dragHasFiles(event)) event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        // A drop onto a job row is that row's; this is everything else, and it
        // means one new job per picture.
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const paths = imagePathsFromDrop(event);
        if (paths.length > 0) void generation.addJobs(paths);
      }}
    >
      <Scene />

      {/* Where the camera is, the way back, and how the scene is drawn. */}
      <div className="gen-navigator">
        <CameraGizmo />
        <div className="gen-navtools">
          <ViewOptions />
          <Tooltip content="Reset camera" position="bottom" align="end">
            <button
              type="button"
              className="gen-tool gen-home"
              aria-label="Reset camera"
              onClick={viewerActions.resetCamera}
            >
              <HomeIcon size={15} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* One band, so the queue and the tools can never overlap. */}
      <div className="gen-hud">
        <QueueStack />
        <ToolPlates />
      </div>

      {dragging && (
        <div className="gen-veil">
          <p>Drop to add a job</p>
        </div>
      )}
    </div>
  );
};
