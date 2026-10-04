import React, { useEffect, useRef, useState } from 'react';
import { useGenerationStore } from '../../stores/generationStore';
import { CameraGizmo } from './CameraGizmo';
import { MeshStats } from './MeshStats';
import { QueueStack } from './QueueStack';
import { Scene } from './Scene';
import { ToolPlates } from './ToolPlates';
import { ViewTools } from './ViewTools';
import { JobHeader } from './JobHeader';
import { useQueueWidth } from './queueWidth';
import { dragHasFiles, imagePathsFromDrop } from './imageInput';
import { useViewerStore } from './viewerStore';

/**
 * Full-bleed: the viewport is the screen and everything else floats over it —
 * the dial and its view buttons top right; bottom left the queue, with the
 * selected mesh's history and size stacked above it; Start and the tool plates
 * bottom right. The top of the screen is left to the model.
 *
 * Nothing here asks the user to set anything up. A model that is not installed
 * is a problem with one job, and the job says so on its own row; the middle of
 * the screen is the model's, even when there is not one yet.
 */
export const GenerateView: React.FC = () => {
  const [, viewerActions] = useViewerStore();
  const leftRef = useRef<HTMLDivElement>(null);
  const queueWidth = useQueueWidth(leftRef);
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
        <ViewTools />
      </div>

      {/* One band, so the queue and the tools can never overlap. The left of
          it is a column read bottom-up: the queue, the selected mesh's
          history above it, and its size above that — so the top of the
          screen belongs to the model. The column's width is the user's,
          dragged from its right edge. */}
      <div className="gen-hud">
        <div
          className={`gen-left ${queueWidth.resizing ? 'is-resizing' : ''}`}
          ref={leftRef}
          style={{ '--gen-queue-width': `${queueWidth.width}px` } as React.CSSProperties}
        >
          <MeshStats />
          <JobHeader />
          <QueueStack />
          <div
            className="gen-queue-resizer"
            title="Drag to resize · double-click to reset"
            {...queueWidth.handleProps}
          />
        </div>
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
